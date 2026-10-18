import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { describe, expect, it } from "vitest";
import worker from "./index";

const TOKEN = "ingest-test-token";

const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  analysis_query TEXT NOT NULL,
  aliases_json TEXT NOT NULL DEFAULT '[]',
  source_config_json TEXT NOT NULL DEFAULT '{}',
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  lifecycle_status TEXT NOT NULL DEFAULT 'active'
    CHECK (lifecycle_status IN ('draft', 'ready', 'active', 'archived')),
  next_analysis_at TEXT,
  last_analyzed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE analysis_runs (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  request_key TEXT NOT NULL UNIQUE,
  trigger_type TEXT NOT NULL CHECK (
    trigger_type IN ('scheduled', 'admin_product', 'admin_all')
  ),
  status TEXT NOT NULL CHECK (
    status IN ('pending', 'dispatched', 'collecting', 'synthesizing', 'completed', 'failed')
  ),
  requested_at TEXT NOT NULL,
  dispatched_at TEXT,
  started_at TEXT,
  completed_at TEXT,
  github_run_url TEXT,
  collector_version TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  raw_evidence_count INTEGER NOT NULL DEFAULT 0,
  source_status_json TEXT NOT NULL DEFAULT '{}',
  error_code TEXT,
  error_message TEXT
);

CREATE TABLE sentiment_snapshots (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  analysis_run_id TEXT NOT NULL UNIQUE REFERENCES analysis_runs(id),
  analyzed_at TEXT NOT NULL,
  window_start TEXT NOT NULL,
  window_end TEXT NOT NULL,
  barometer_score INTEGER NOT NULL CHECK (barometer_score BETWEEN 0 AND 100),
  temperature TEXT NOT NULL CHECK (
    temperature IN ('Hot', 'Warming', 'Stable', 'Cooling', 'Cold')
  ),
  momentum INTEGER NOT NULL,
  confidence TEXT NOT NULL CHECK (
    confidence IN ('Very High', 'High', 'Medium', 'Low')
  ),
  discussion_volume TEXT NOT NULL CHECK (
    discussion_volume IN ('Very High', 'High', 'Medium', 'Low')
  ),
  summary TEXT NOT NULL,
  positive_signals_json TEXT NOT NULL,
  negative_signals_json TEXT NOT NULL,
  source_breakdown_json TEXT NOT NULL,
  source_status_json TEXT NOT NULL,
  classified_evidence_count INTEGER NOT NULL,
  ai_model TEXT NOT NULL
);

CREATE TABLE source_mentions (
  id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL REFERENCES sentiment_snapshots(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  source_title TEXT NOT NULL,
  source_url TEXT,
  sentiment TEXT NOT NULL CHECK (
    sentiment IN ('positive', 'neutral', 'negative')
  ),
  excerpt TEXT NOT NULL,
  published_at TEXT,
  source_rank INTEGER NOT NULL
);
`;

type ProductSeed = {
  id: string;
  slug: string;
  name: string;
  isActive?: number;
  lifecycle?: string;
  nextAnalysisAt?: string | null;
};

function createDatabase() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(SCHEMA);

  const statement = (sql: string, params: SQLInputValue[] = []) => ({
    bind(...values: SQLInputValue[]) {
      return statement(sql, values);
    },
    async first<T>() {
      const row = sqlite.prepare(sql).get(...params) as T | undefined;
      return row ?? null;
    },
    async all<T>() {
      return { results: sqlite.prepare(sql).all(...params) as T[] };
    },
    async run() {
      sqlite.prepare(sql).run(...params);
      return { success: true };
    },
  });

  const db = {
    prepare(sql: string) {
      return statement(sql);
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const entry of statements) results.push(await entry.run());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };

  return { sqlite, db: db as unknown as D1Database };
}

function insertProduct(sqlite: DatabaseSync, product: ProductSeed) {
  sqlite.prepare(`
    INSERT INTO products (
      id, slug, name, description, analysis_query, aliases_json, source_config_json,
      is_active, lifecycle_status, next_analysis_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `).run(
    product.id,
    product.slug,
    product.name,
    `${product.name} description`,
    `${product.name} query`,
    JSON.stringify([`${product.name} alias`]),
    JSON.stringify({ subreddits: ["Microsoft365"] }),
    product.isActive ?? 1,
    product.lifecycle ?? "active",
    product.nextAnalysisAt === undefined ? "2020-01-01 00:00:00" : product.nextAnalysisAt,
  );
}

function seedCatalog(sqlite: DatabaseSync) {
  insertProduct(sqlite, { id: "prod-null", slug: "never-scheduled", name: "Never Scheduled", nextAnalysisAt: null });
  insertProduct(sqlite, { id: "prod-old", slug: "oldest-due", name: "Oldest Due", nextAnalysisAt: "2020-01-01 00:00:00" });
  insertProduct(sqlite, { id: "prod-newer", slug: "newer-due", name: "Newer Due", nextAnalysisAt: "2020-06-01 00:00:00" });
  insertProduct(sqlite, { id: "prod-future", slug: "future-product", name: "Future Product", nextAnalysisAt: "2999-01-01 00:00:00" });
  insertProduct(sqlite, {
    id: "prod-draft", slug: "draft-product", name: "Draft Product", lifecycle: "draft", nextAnalysisAt: "2020-01-01 00:00:00",
  });
  insertProduct(sqlite, {
    id: "prod-archived", slug: "archived-product", name: "Archived Product",
    isActive: 0, lifecycle: "archived", nextAnalysisAt: "2020-01-01 00:00:00",
  });
  insertProduct(sqlite, {
    id: "prod-inactive", slug: "inactive-product", name: "Inactive Product", isActive: 0, nextAnalysisAt: "2020-01-01 00:00:00",
  });
}

function createEnv(db: D1Database, ai?: () => Promise<unknown> | unknown): Env {
  return {
    DB: db,
    INGEST_TOKEN: TOKEN,
    AI_MODEL: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    ASSETS: {} as Fetcher,
    AI: { run: async () => (ai ? ai() : { response: null }) } as unknown as Env["AI"],
    PUBLIC_API_RATE_LIMITER: { limit: async () => ({ success: true }) },
  } as Env;
}

async function api(env: Env, path: string, init: RequestInit = {}, token: string | null = TOKEN) {
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return worker.fetch(new Request(`http://localhost${path}`, { ...init, headers }), env);
}

async function runCron(env: Env) {
  let pending: Promise<void> = Promise.resolve();
  await worker.scheduled(
    { cron: "15 6 * * *", scheduledTime: Date.now(), noRetry() {} } as ScheduledController,
    env,
    {
      waitUntil(promise: Promise<void>) { pending = promise; },
      passThroughOnException() {},
      props: {},
    } as ExecutionContext,
  );
  await pending;
}

function productRow(sqlite: DatabaseSync, id: string) {
  return sqlite.prepare(`
    SELECT next_analysis_at AS nextAnalysisAt,
      next_analysis_at >= datetime('now', '+23 hours')
        AND next_analysis_at < datetime('now', '+25 hours') AS deferredDay,
      next_analysis_at >= datetime('now', '+6 days')
        AND next_analysis_at < datetime('now', '+8 days') AS deferredWeek
    FROM products WHERE id = ?
  `).get(id) as { nextAnalysisAt: string | null; deferredDay: number; deferredWeek: number };
}

function runRow(sqlite: DatabaseSync, id: string) {
  return sqlite.prepare(`
    SELECT status, trigger_type AS triggerType, error_code AS errorCode, error_message AS errorMessage
    FROM analysis_runs WHERE id = ?
  `).get(id) as { status: string; triggerType: string; errorCode: string | null; errorMessage: string | null };
}

const evidence = [
  { id: "1", source: "reddit", title: "Useful", excerpt: "It helped.", rank: 1 },
  { id: "2", source: "reddit", title: "Fine", excerpt: "It works.", rank: 2 },
  { id: "3", source: "hackernews", title: "Slow", excerpt: "It stalled.", rank: 3 },
];

const ingestBody = {
  collectorVersion: "bot-1",
  windowStart: "2026-09-01T00:00:00.000Z",
  windowEnd: "2026-10-01T00:00:00.000Z",
  sourceStatus: { reddit: "available", hackernews: "available" },
  evidence,
};

const aiAnalysis = {
  classifications: [
    { id: "1", sentiment: "positive" },
    { id: "2", sentiment: "neutral" },
    { id: "3", sentiment: "negative" },
  ],
  summary: "Mixed recent discussion.",
  positiveSignals: ["Useful"],
  negativeSignals: ["Slow"],
};

describe("internal analysis bot API", () => {
  it("requires the ingest token", async () => {
    const { db } = createDatabase();
    const env = createEnv(db);
    expect((await api(env, "/api/internal/analysis-runs/due", {}, null)).status).toBe(401);
    expect((await api(env, "/api/internal/analysis-runs", { method: "POST" }, "wrong")).status).toBe(401);
  });

  it("lists due active products oldest first and claims the oldest", async () => {
    const { sqlite, db } = createDatabase();
    seedCatalog(sqlite);
    const env = createEnv(db);

    const due = await api(env, "/api/internal/analysis-runs/due");
    expect(due.status).toBe(200);
    expect(await due.json()).toEqual({ slugs: ["never-scheduled", "oldest-due", "newer-due"] });

    const created = await api(env, "/api/internal/analysis-runs", { method: "POST" });
    expect(created.status).toBe(200);
    const body = await created.json() as { runId: string; context: { runId: string; product: { id: string; name: string } } };
    expect(body.context.product).toMatchObject({ id: "prod-null", name: "Never Scheduled" });
    expect(body.context.runId).toBe(body.runId);
    expect(runRow(sqlite, body.runId)).toMatchObject({ status: "pending", triggerType: "scheduled" });

    const context = await api(env, `/api/internal/analysis-runs/${body.runId}/context`);
    expect(await context.json()).toEqual(body.context);

    const draft = await api(env, "/api/internal/analysis-runs", {
      method: "POST",
      body: JSON.stringify({ productSlug: "draft-product" }),
    });
    expect(draft.status).toBe(404);
  });

  it("creates a run for an explicit slug and returns 204 when nothing is due", async () => {
    const { sqlite, db } = createDatabase();
    insertProduct(sqlite, {
      id: "prod-future", slug: "future-product", name: "Future Product", nextAnalysisAt: "2999-01-01 00:00:00",
    });
    const env = createEnv(db);

    const empty = await api(env, "/api/internal/analysis-runs", { method: "POST", body: "{}" });
    expect(empty.status).toBe(204);
    expect(await empty.text()).toBe("");

    const created = await api(env, "/api/internal/analysis-runs", {
      method: "POST",
      body: JSON.stringify({ productSlug: "future-product" }),
    });
    expect(created.status).toBe(200);
    const body = await created.json() as { context: { product: { slug?: string; name: string }; subreddits: string[] } };
    expect(body.context.product.name).toBe("Future Product");
    expect(body.context.subreddits).toEqual(["Microsoft365"]);

    const missing = await api(env, "/api/internal/analysis-runs", {
      method: "POST",
      body: JSON.stringify({ productSlug: "archived-product" }),
    });
    expect(missing.status).toBe(404);
  });

  it("starts, ingests, and schedules the next analysis seven days out", async () => {
    const { sqlite, db } = createDatabase();
    insertProduct(sqlite, { id: "prod-old", slug: "oldest-due", name: "Oldest Due" });
    const env = createEnv(db, async () => ({ response: aiAnalysis }));

    const created = await api(env, "/api/internal/analysis-runs", { method: "POST", body: "{}" });
    const { runId } = await created.json() as { runId: string };
    expect((await api(env, `/api/internal/analysis-runs/${runId}/start`, { method: "POST", body: "{}" })).status).toBe(200);
    expect(runRow(sqlite, runId).status).toBe("collecting");

    const ingested = await api(env, `/api/internal/analysis-runs/${runId}/ingest`, {
      method: "POST",
      body: JSON.stringify(ingestBody),
    });
    expect(ingested.status).toBe(200);
    const result = await ingested.json() as { snapshotId: string; score: number };
    expect(result.snapshotId).toEqual(expect.any(String));
    expect(result.score).toBe(50);
    expect(runRow(sqlite, runId).status).toBe("completed");
    expect(productRow(sqlite, "prod-old").deferredWeek).toBe(1);
  });

  it("returns an AI scoring error and defers the product for one day", async () => {
    const { sqlite, db } = createDatabase();
    insertProduct(sqlite, { id: "prod-old", slug: "oldest-due", name: "Oldest Due" });
    const env = createEnv(db, async () => {
      throw new Error("model overloaded");
    });

    const created = await api(env, "/api/internal/analysis-runs", { method: "POST", body: "{}" });
    const { runId } = await created.json() as { runId: string };
    const failed = await api(env, `/api/internal/analysis-runs/${runId}/ingest`, {
      method: "POST",
      body: JSON.stringify(ingestBody),
    });
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ errorCode: "AI_SCORING_FAILED", message: "model overloaded" });
    expect(runRow(sqlite, runId)).toMatchObject({
      status: "failed",
      errorCode: "AI_SCORING_FAILED",
      errorMessage: "model overloaded",
    });
    expect(productRow(sqlite, "prod-old").deferredDay).toBe(1);
    expect(await (await api(env, "/api/internal/analysis-runs/due")).json()).toEqual({ slugs: [] });
  });

  it("defers a product for one day when the bot reports failure", async () => {
    const { sqlite, db } = createDatabase();
    insertProduct(sqlite, { id: "prod-old", slug: "oldest-due", name: "Oldest Due" });
    insertProduct(sqlite, { id: "prod-newer", slug: "newer-due", name: "Newer Due", nextAnalysisAt: "2020-06-01 00:00:00" });
    const env = createEnv(db);

    const created = await api(env, "/api/internal/analysis-runs", {
      method: "POST",
      body: JSON.stringify({ productSlug: "oldest-due" }),
    });
    const { runId } = await created.json() as { runId: string };
    const failed = await api(env, `/api/internal/analysis-runs/${runId}/fail`, {
      method: "POST",
      body: JSON.stringify({ errorCode: "COLLECTOR_FAILED", errorMessage: "no evidence" }),
    });
    expect(failed.status).toBe(200);
    expect(runRow(sqlite, runId)).toMatchObject({ status: "failed", errorCode: "COLLECTOR_FAILED", errorMessage: "no evidence" });
    expect(productRow(sqlite, "prod-old").deferredDay).toBe(1);
    expect(await (await api(env, "/api/internal/analysis-runs/due")).json()).toEqual({ slugs: ["newer-due"] });
  });

  it("times out stuck runs on the cron without dispatching GitHub", async () => {
    const { sqlite, db } = createDatabase();
    insertProduct(sqlite, { id: "prod-old", slug: "oldest-due", name: "Oldest Due" });
    insertProduct(sqlite, { id: "prod-newer", slug: "newer-due", name: "Newer Due", nextAnalysisAt: "2999-01-01 00:00:00" });
    sqlite.prepare(`
      INSERT INTO analysis_runs (id, product_id, request_key, trigger_type, status, requested_at)
      VALUES ('run-old', 'prod-old', 'old-key', 'scheduled', 'collecting', '2020-01-01T00:00:00.000Z')
    `).run();
    sqlite.prepare(`
      INSERT INTO analysis_runs (id, product_id, request_key, trigger_type, status, requested_at)
      VALUES ('run-fresh', 'prod-newer', 'fresh-key', 'scheduled', 'pending', datetime('now'))
    `).run();
    sqlite.prepare(`
      INSERT INTO analysis_runs (id, product_id, request_key, trigger_type, status, requested_at, completed_at)
      VALUES ('run-done', 'prod-newer', 'done-key', 'scheduled', 'completed', '2020-01-01T00:00:00.000Z', datetime('now'))
    `).run();

    const env = createEnv(db);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("cron must not dispatch GitHub");
    }) as typeof fetch;
    try {
      await runCron(env);
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(runRow(sqlite, "run-old")).toMatchObject({
      status: "failed",
      errorCode: "RUN_TIMEOUT",
      errorMessage: "Run exceeded the 30 minute timeout",
    });
    expect(productRow(sqlite, "prod-old").deferredDay).toBe(1);
    expect(runRow(sqlite, "run-fresh").status).toBe("pending");
    expect(runRow(sqlite, "run-done").status).toBe("completed");
    expect(productRow(sqlite, "prod-newer").nextAnalysisAt).toBe("2999-01-01 00:00:00");
  });
});
