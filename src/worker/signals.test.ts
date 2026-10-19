import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { describe, expect, it } from "vitest";
import worker from "./index";
import {
  itemMatches,
  lastCompletedWeek,
  resolveSignalProfile,
  MIN_SOURCE_WEEKS,
  scoreSupplyDemand,
  sumPageviewsByWeek,
  weekSequence,
  type CatalogItem,
} from "./signal-catalog";
import { collectWeeklySignals, backfillSignalHistory } from "./signals";

const TOKEN = "ingest-test-token";
const NOW = new Date("2026-10-14T15:00:00.000Z");

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
  is_active INTEGER NOT NULL DEFAULT 1,
  lifecycle_status TEXT NOT NULL DEFAULT 'active',
  next_analysis_at TEXT,
  last_analyzed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE signals (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  week TEXT NOT NULL,
  source TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('supply', 'demand')),
  value REAL NOT NULL,
  meta_json TEXT NOT NULL DEFAULT '{}',
  collected_at TEXT NOT NULL,
  UNIQUE (product_id, week, source)
);
`;

function createDatabase() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(SCHEMA);
  const statement = (sql: string, params: SQLInputValue[] = []) => ({
    bind(...values: SQLInputValue[]) {
      return statement(sql, values);
    },
    async first<T>() {
      return (sqlite.prepare(sql).get(...params) as T | undefined) ?? null;
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
        for (const entry of statements) await entry.run();
        sqlite.exec("COMMIT");
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return { sqlite, db: db as unknown as D1Database };
}

function insertProduct(sqlite: DatabaseSync, slug: string, active = 1) {
  sqlite.prepare(`
    INSERT INTO products (
      id, slug, name, description, analysis_query, aliases_json, source_config_json,
      is_active, lifecycle_status, created_at, updated_at
    ) VALUES (?, ?, ?, '', 'query', '[]', '{}', ?, 'active', '2026-01-01', '2026-01-01')
  `).run(`prod-${slug}`, slug, slug, active);
}

function signalRows(sqlite: DatabaseSync) {
  return sqlite.prepare(`
    SELECT p.slug, s.source, s.week, s.kind, s.value, s.meta_json AS metaJson
    FROM signals s JOIN products p ON p.id = s.product_id
    ORDER BY p.slug, s.source, s.week
  `).all() as Array<{ slug: string; source: string; week: string; kind: string; value: number; metaJson: string }>;
}

function env(db: D1Database): Env {
  return {
    DB: db,
    INGEST_TOKEN: TOKEN,
    AI_MODEL: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    ASSETS: { fetch: async () => new Response("missing", { status: 404 }) } as unknown as Fetcher,
    AI: { run: async () => ({ response: null }) } as unknown as Env["AI"],
    PUBLIC_API_RATE_LIMITER: { limit: async () => ({ success: true }) },
  } as Env;
}

async function api(database: D1Database, path: string, body?: unknown, token: string | null = TOKEN) {
  const headers = new Headers();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (body !== undefined) headers.set("Content-Type", "application/json");
  return worker.fetch(new Request(`http://localhost${path}`, {
    method: "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }), env(database));
}

describe("signal matching", () => {
  const teamsPhone = resolveSignalProfile({
    slug: "teams-phone",
    name: "Teams Phone",
    aliases: ["Microsoft Teams Phone", "Teams Calling"],
    sourceConfig: {},
  });

  it("does not treat the Microsoft Teams service as Teams Phone", () => {
    const parent: CatalogItem = {
      id: "MC1",
      title: "Microsoft Teams: new meeting theme",
      services: ["Microsoft Teams"],
      at: "2026-10-06T00:00:00Z",
    };
    const phone: CatalogItem = {
      id: "MC2",
      title: "Microsoft Teams: Teams Phone Call Transfer Improvements",
      services: ["Microsoft Teams"],
      at: "2026-10-06T00:00:00Z",
    };
    expect(itemMatches(parent, teamsPhone)).toBe(false);
    expect(itemMatches(phone, teamsPhone)).toBe(true);
  });

  it("matches Microsoft 365 Copilot by the message center service name", () => {
    const profile = resolveSignalProfile({
      slug: "microsoft-365-copilot",
      name: "Microsoft 365 Copilot",
      aliases: ["M365 Copilot"],
      sourceConfig: {},
    });
    expect(itemMatches({
      id: "MC3",
      title: "Admin change",
      services: ["Microsoft Copilot (Microsoft 365)"],
      at: "2026-10-06T00:00:00Z",
    }, profile)).toBe(true);
    expect(profile.wikipediaTitle).toBe("Microsoft_Copilot");
    expect(profile.wikipediaEstimated).toBe(true);
  });
});

describe("supply versus demand score", () => {
  it("returns not enough data when nothing has been collected", () => {
    expect(scoreSupplyDemand([], NOW)).toMatchObject({
      status: "not_enough_data",
      label: null,
      confidence: "not enough data",
      supply: null,
      demand: null,
      gap: null,
    });
  });

  it("withholds every source until it has four non-null weeks", () => {
    const score = scoreSupplyDemand([
      { week: "2026-10-05", source: "wikipedia", kind: "demand", value: 10, estimated: true },
      { week: "2026-10-05", source: "hacker_news", kind: "demand", value: 1 },
      { week: "2026-10-05", source: "message_center", kind: "supply", value: 2 },
    ], NOW);
    expect(MIN_SOURCE_WEEKS).toBe(4);
    expect(score.label).toBeNull();
    expect(score.status).toBe("not_enough_data");
    expect(score.supply).toBeNull();
    expect(score.demand).toBeNull();
    expect(score.momentum).toBeNull();
    expect(score.sources).toBe(0);
    expect(score.confidence).toBe("not enough data");
    expect(score.pendingSources).toEqual([
      { source: "hacker_news", weeks: 1 },
      { source: "message_center", weeks: 1 },
      { source: "wikipedia", weeks: 1 },
    ]);
  });

  it("does not let a one-week X source change the index", () => {
    const weeks = ["2026-09-14", "2026-09-21", "2026-09-28", "2026-10-05"];
    const established = weeks.flatMap((week) => [
      { week, source: "wikipedia", kind: "demand" as const, value: 10 },
      { week, source: "hacker_news", kind: "demand" as const, value: 2 },
      { week, source: "message_center", kind: "supply" as const, value: 5 },
    ]);
    const baseline = scoreSupplyDemand(established, NOW);
    const withOneWeek = scoreSupplyDemand([
      ...established,
      { week: "2026-10-05", source: "x", kind: "demand", value: 5000 },
    ], NOW);

    expect(withOneWeek.demand?.index).toBe(baseline.demand?.index);
    expect(withOneWeek.supply?.index).toBe(baseline.supply?.index);
    expect(withOneWeek.momentum).toBe(baseline.momentum);
    expect(withOneWeek.sources).toBe(baseline.sources);
    expect(withOneWeek.confidence).toBe(baseline.confidence);
    expect(withOneWeek.status).toBe(baseline.status);
    expect(withOneWeek.label).toBe(baseline.label);
    expect(withOneWeek.pendingSources).toEqual([{ source: "x", weeks: 1 }]);
    expect(baseline.demand?.index).toBe(50);
    expect(baseline.sources).toBe(3);
  });

  it("counts an X source once it reaches four weeks", () => {
    const weeks = ["2026-09-14", "2026-09-21", "2026-09-28", "2026-10-05"];
    const established = weeks.flatMap((week) => [
      { week, source: "wikipedia", kind: "demand" as const, value: 10 },
      { week, source: "hacker_news", kind: "demand" as const, value: 2 },
      { week, source: "message_center", kind: "supply" as const, value: 5 },
    ]);
    const baseline = scoreSupplyDemand(established, NOW);
    const withFourWeeks = scoreSupplyDemand([
      ...established,
      ...weeks.map((week) => ({
        week,
        source: "x",
        kind: "demand" as const,
        value: week === "2026-10-05" ? 5000 : 1,
      })),
    ], NOW);

    expect(withFourWeeks.pendingSources).toEqual([]);
    expect(withFourWeeks.sources).toBe(4);
    expect(withFourWeeks.demand?.index).not.toBe(baseline.demand?.index);
    expect(withFourWeeks.demand?.index).toBe(88);
    expect(withFourWeeks.momentum).not.toBe(baseline.momentum);
    expect(withFourWeeks.confidence).toBe("Medium");
  });

  it("labels a four-week demand spike Hot against the product's own history", () => {
    const weeks = ["2026-09-14", "2026-09-21", "2026-09-28", "2026-10-05"];
    const signals = weeks.flatMap((week) => {
      const demand = week === "2026-10-05" ? 10 : 1;
      return [
        { week, source: "wikipedia", kind: "demand" as const, value: demand },
        { week, source: "hacker_news", kind: "demand" as const, value: 0 },
        { week, source: "x", kind: "demand" as const, value: 0 },
        { week, source: "message_center", kind: "supply" as const, value: 5 },
      ];
    });
    const score = scoreSupplyDemand(signals, NOW);
    expect(score).toMatchObject({
      week: "2026-10-05",
      label: "Hot",
      status: "ok",
      confidence: "Medium",
      estimated: false,
    });
    expect(score.demand?.index).toBeGreaterThanOrEqual(70);
    expect(score.momentum).toBeGreaterThan(0);
    expect(score.gap).toBe((score.demand?.index ?? 0) - (score.supply?.index ?? 0));
  });

  it("labels a falling series Cold", () => {
    const weeks = ["2026-09-14", "2026-09-21", "2026-09-28", "2026-10-05"];
    const signals = weeks.flatMap((week) => [
      { week, source: "wikipedia", kind: "demand" as const, value: week === "2026-10-05" ? 1 : 10 },
      { week, source: "hacker_news", kind: "demand" as const, value: 0 },
      { week, source: "x", kind: "demand" as const, value: 0 },
      { week, source: "message_center", kind: "supply" as const, value: 1 },
    ]);
    const score = scoreSupplyDemand(signals, NOW);
    expect(score.label).toBe("Cold");
    expect(score.demand?.index).toBeLessThanOrEqual(30);
    expect(score.momentum).toBeLessThan(0);
  });
});

describe("weekly collectors", () => {
  it("keeps a failed source from blocking the others", async () => {
    const { sqlite, db } = createDatabase();
    insertProduct(sqlite, "microsoft-365-copilot");
    insertProduct(sqlite, "microsoft-lists");
    const fetcher = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("messages-index")) {
        return Response.json([{
          Id: "MC1",
          Title: "Microsoft 365 Copilot change",
          Services: ["Microsoft Copilot (Microsoft 365)"],
          LastModifiedDateTime: "2026-10-06T12:00:00Z",
          IsMajorChange: true,
        }]);
      }
      if (url.includes("releasecommunications")) throw new Error("roadmap down");
      if (url.includes("wikimedia.org")) {
        return Response.json({ items: [{ timestamp: "2026100600", views: 10 }] });
      }
      if (url.includes("hn.algolia.com")) return Response.json({ nbHits: 2, exhaustiveNbHits: true });
      throw new Error(`unexpected ${url}`);
    };

    const result = await collectWeeklySignals({ DB: db } as Env, { fetch: fetcher, now: NOW });
    expect(lastCompletedWeek(NOW)).toBe("2026-10-05");
    expect(result.errors.map((error) => error.source)).toEqual(["roadmap"]);
    expect(result.skipped).toEqual([{ slug: "microsoft-lists", source: "wikipedia", reason: "no dedicated article" }]);
    const rows = signalRows(sqlite);
    expect(rows.find((row) => row.slug === "microsoft-365-copilot" && row.source === "message_center")).toMatchObject({
      week: "2026-10-05",
      value: 1,
    });
    expect(rows.some((row) => row.source === "roadmap")).toBe(false);
    const wikipedia = rows.find((row) => row.source === "wikipedia");
    expect(wikipedia).toMatchObject({ slug: "microsoft-365-copilot", week: "2026-10-05", kind: "demand", value: 10 });
    expect(JSON.parse(wikipedia?.metaJson ?? "{}").estimated).toBe(true);
    expect(rows.find((row) => row.slug === "microsoft-365-copilot" && row.source === "hacker_news")?.value).toBe(2);
  });

  it("backfills Wikipedia and Hacker News history without splitting a truncated search", async () => {
    const { sqlite, db } = createDatabase();
    insertProduct(sqlite, "microsoft-loop");
    const weeks = weekSequence("2026-10-05", 2);
    const fetcher = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("wikimedia.org")) {
        return Response.json({
          items: [
            { timestamp: "2026092800", views: 4 },
            { timestamp: "2026100500", views: 6 },
          ],
        });
      }
      if (url.includes("hitsPerPage=100")) {
        return Response.json({
          nbHits: 1,
          exhaustiveNbHits: true,
          hits: [{ created_at_i: Math.floor(Date.parse("2026-10-06T00:00:00Z") / 1000) }],
        });
      }
      throw new Error(url);
    };
    const result = await backfillSignalHistory({ DB: db } as Env, {
      fetch: fetcher,
      now: NOW,
      weeks: 2,
      sources: ["wikipedia", "hacker_news"],
    });
    expect(result.errors).toEqual([]);
    expect(result.wrote).toBe(4);
    const rows = signalRows(sqlite);
    expect(rows.filter((row) => row.source === "wikipedia").map((row) => [row.week, row.value])).toEqual([
      [weeks[0], 4],
      [weeks[1], 6],
    ]);
    expect(sumPageviewsByWeek([{ timestamp: "2026100500", views: 6 }], weeks).get("2026-10-05")).toBe(6);
  });
});

describe("internal signal endpoints", () => {
  it("requires the ingest token and stores bot counts on the ISO week", async () => {
    const { sqlite, db } = createDatabase();
    insertProduct(sqlite, "microsoft-365-copilot");
    const signal = {
      productSlug: "microsoft-365-copilot",
      week: "2026-10-07",
      source: "x",
      kind: "demand",
      value: 832,
    };

    expect((await api(db, "/api/internal/signals", { signals: [signal] }, null)).status).toBe(401);
    expect((await api(db, "/api/internal/signals", {
      signals: [{ ...signal, source: "youtube", kind: "demand" }],
    })).status).toBe(400);

    const stored = await api(db, "/api/internal/signals", { signals: [signal] });
    expect(stored.status).toBe(200);
    expect(await stored.json()).toEqual({ stored: 1 });
    expect(signalRows(sqlite)[0]).toMatchObject({ source: "x", week: "2026-10-05", kind: "demand", value: 832 });

    const replaced = await api(db, "/api/internal/signals", { signals: [{ ...signal, value: 10 }] });
    expect(replaced.status).toBe(200);
    expect(signalRows(sqlite)).toHaveLength(1);
    expect(signalRows(sqlite)[0]?.value).toBe(10);

    const missing = await api(db, "/api/internal/signals", {
      signals: [{ ...signal, productSlug: "missing-product" }],
    });
    expect(missing.status).toBe(404);
  });

  it("rejects a backfill source that has no free history", async () => {
    const { db } = createDatabase();
    const response = await api(db, "/api/internal/signals/backfill", { sources: ["reddit"] });
    expect(response.status).toBe(400);
  });
});
