import { getDueProducts, getProductRow } from "./db";

type TriggerType = "scheduled" | "admin_product" | "admin_all";

function isoWeek(date = new Date()): string {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((target.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export async function dispatchGithubRun(env: Env, runId: string): Promise<void> {
  const response = await fetch(
    `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/actions/workflows/${env.GITHUB_WORKFLOW}/dispatches`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        "Content-Type": "application/json",
        "User-Agent": "m365-barometer-worker",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({
        ref: "main",
        inputs: {
          analysis_run_id: runId,
        },
      }),
    },
  );
  if (!response.ok) throw new Error(`GitHub dispatch failed: ${response.status}`);
}

export async function createAndDispatchRun(
  env: Env,
  productId: string,
  triggerType: TriggerType,
  requestKey?: string,
): Promise<string> {
  const key = requestKey ?? `${triggerType}:${productId}:${crypto.randomUUID()}`;
  const existing = await env.DB.prepare(
    "SELECT id, status, attempt_count FROM analysis_runs WHERE request_key = ?",
  ).bind(key).first<{ id: string; status: string; attempt_count: number }>();

  const runId = existing?.id ?? crypto.randomUUID();
  if (!existing) {
    await env.DB.prepare(`
      INSERT INTO analysis_runs (
        id, product_id, request_key, trigger_type, status, requested_at, attempt_count
      ) VALUES (?, ?, ?, ?, 'pending', ?, 0)
    `).bind(runId, productId, key, triggerType, new Date().toISOString()).run();
  } else if (existing.status === "completed" || existing.attempt_count >= 3) {
    return runId;
  }

  try {
    await dispatchGithubRun(env, runId);
    await env.DB.prepare(`
      UPDATE analysis_runs SET status = 'dispatched', dispatched_at = ?,
        attempt_count = attempt_count + 1, error_code = NULL, error_message = NULL
      WHERE id = ?
    `).bind(new Date().toISOString(), runId).run();
  } catch (error) {
    await markRunFailed(
      env.DB,
      runId,
      "DISPATCH_FAILED",
      error instanceof Error ? error.message : "GitHub dispatch failed",
    );
    throw error;
  }
  return runId;
}

export async function runScheduledMonitoring(env: Env): Promise<void> {
  await reconcileRuns(env.DB);
  await cleanupRetention(env.DB);
  const dueProducts = await getDueProducts(env.DB, 3);
  for (const product of dueProducts) {
    const requestKey = `scheduled:${product.id}:${isoWeek()}`;
    try {
      await createAndDispatchRun(env, product.id, "scheduled", requestKey);
    } catch (error) {
      console.error(JSON.stringify({
        event: "scheduled_dispatch_failed",
        productId: product.id,
        message: error instanceof Error ? error.message : "unknown",
      }));
    }
  }
}

export async function reconcileRuns(db: D1Database): Promise<void> {
  await db.prepare(`
    UPDATE analysis_runs
    SET status = 'failed', completed_at = datetime('now'),
      error_code = 'RUN_TIMEOUT', error_message = 'Run exceeded the 30 minute timeout'
    WHERE status IN ('pending', 'dispatched', 'collecting', 'synthesizing')
      AND requested_at < datetime('now', '-30 minutes')
  `).run();
}

export async function cleanupRetention(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare(`
      DELETE FROM source_mentions
      WHERE snapshot_id IN (
        SELECT id FROM sentiment_snapshots
        WHERE analyzed_at < datetime('now', '-12 months')
          AND id NOT IN (
            SELECT id FROM sentiment_snapshots latest
            WHERE latest.id = (
              SELECT id FROM sentiment_snapshots current
              WHERE current.product_id = latest.product_id
              ORDER BY current.analyzed_at DESC LIMIT 1
            )
          )
      )
    `),
    db.prepare(`
      DELETE FROM sentiment_snapshots
      WHERE analyzed_at < datetime('now', '-12 months')
        AND id NOT IN (
          SELECT id FROM sentiment_snapshots latest
          WHERE latest.id = (
            SELECT id FROM sentiment_snapshots current
            WHERE current.product_id = latest.product_id
            ORDER BY current.analyzed_at DESC LIMIT 1
          )
        )
    `),
  ]);
}

export async function markRunFailed(
  db: D1Database,
  runId: string,
  errorCode: string,
  errorMessage: string,
): Promise<void> {
  await db.prepare(`
    UPDATE analysis_runs SET status = 'failed', completed_at = ?,
      error_code = ?, error_message = ? WHERE id = ?
  `).bind(new Date().toISOString(), errorCode.slice(0, 80), errorMessage.slice(0, 1000), runId).run();
}

export async function runnerContext(db: D1Database, runId: string) {
  const run = await db.prepare(`
    SELECT id, product_id, status FROM analysis_runs WHERE id = ?
  `).bind(runId).first<{ id: string; product_id: string; status: string }>();
  if (!run) return null;
  const product = await getProductRow(db, run.product_id);
  if (!product) return null;
  const sourceConfig = JSON.parse(product.source_config_json) as { subreddits?: string[] };

  return {
    runId,
    product: {
      id: product.id,
      name: product.name,
      analysisQuery: product.analysis_query,
      aliases: JSON.parse(product.aliases_json) as string[],
    },
    queryPlan: {
      intent: `Measure recent public sentiment around ${product.name}`,
      freshness_mode: "strict",
      cluster_mode: "topic",
      raw_topic: product.analysis_query,
      subqueries: [
        {
          label: "product experience",
          search_query: `${product.analysis_query} experience OR review OR issue`,
          ranking_query: `Real user experiences and opinions about ${product.name}`,
          sources: ["reddit", "youtube", "hackernews", "github", "web"],
          weight: 1.0,
        },
        {
          label: "positive signals",
          search_query: `${product.analysis_query} useful OR improved OR love OR recommend`,
          ranking_query: `Positive community signals about ${product.name}`,
          sources: ["reddit", "youtube", "web"],
          weight: 0.9,
        },
        {
          label: "negative signals",
          search_query: `${product.analysis_query} problem OR broken OR frustrating OR dislike`,
          ranking_query: `Negative community signals about ${product.name}`,
          sources: ["reddit", "youtube", "hackernews", "github", "web"],
          weight: 0.9,
        },
      ],
      source_weights: {
        reddit: 1.0,
        youtube: 0.9,
        hackernews: 0.7,
        github: 0.8,
        web: 0.7,
      },
      notes: [`Prefer Microsoft 365 context. Target subreddits: ${(sourceConfig.subreddits ?? []).join(", ")}`],
    },
    subreddits: sourceConfig.subreddits ?? [],
  };
}
