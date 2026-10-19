import { getDueProducts, getProductBySlug, getProductRow } from "./db";
import { collectWeeklySignals } from "./signals";

type TriggerType = "scheduled";

export async function createAnalysisRun(
  db: D1Database,
  productId: string,
  triggerType: TriggerType,
  requestKey?: string,
): Promise<string> {
  const key = requestKey ?? `${triggerType}:${productId}:${crypto.randomUUID()}`;
  const existing = await db.prepare(
    "SELECT id FROM analysis_runs WHERE request_key = ?",
  ).bind(key).first<{ id: string }>();
  if (existing) return existing.id;

  const runId = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO analysis_runs (
      id, product_id, request_key, trigger_type, status, requested_at, attempt_count
    ) VALUES (?, ?, ?, ?, 'pending', ?, 0)
  `).bind(runId, productId, key, triggerType, new Date().toISOString()).run();
  return runId;
}

export async function createBotAnalysisRun(db: D1Database, productSlug?: string) {
  const product = productSlug
    ? await getProductBySlug(db, productSlug)
    : (await getDueProducts(db, 1))[0];
  if (!product) return productSlug ? { status: "not_found" as const } : { status: "none_due" as const };

  const runId = await createAnalysisRun(db, product.id, "scheduled");
  const context = await runnerContext(db, runId);
  if (!context) throw new Error("Analysis run context was not created");
  return { status: "created" as const, runId, context };
}

export async function runScheduledMonitoring(env: Env): Promise<void> {
  // The external bot claims due products. Cron times out stuck runs, enforces retention,
  // and collects the free weekly supply and demand signals.
  await reconcileRuns(env.DB);
  await cleanupRetention(env.DB);
  try {
    await collectWeeklySignals(env);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Signal collection failed";
    console.error(JSON.stringify({ event: "signal_collection_failed", message }));
  }
}

export async function reconcileRuns(db: D1Database): Promise<void> {
  const timedOut = `
    status IN ('pending', 'dispatched', 'collecting', 'synthesizing')
    AND requested_at < datetime('now', '-30 minutes')
  `;
  await db.batch([
    db.prepare(`
      UPDATE products
      SET next_analysis_at = datetime('now', '+1 day'), updated_at = datetime('now')
      WHERE id IN (SELECT product_id FROM analysis_runs WHERE ${timedOut})
    `),
    db.prepare(`
      UPDATE analysis_runs
      SET status = 'failed', completed_at = datetime('now'),
        error_code = 'RUN_TIMEOUT', error_message = 'Run exceeded the 30 minute timeout'
      WHERE ${timedOut}
    `),
  ]);
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
  const run = await db.prepare(
    "SELECT product_id FROM analysis_runs WHERE id = ?",
  ).bind(runId).first<{ product_id: string }>();
  const statements = [
    db.prepare(`
      UPDATE analysis_runs SET status = 'failed', completed_at = ?,
        error_code = ?, error_message = ? WHERE id = ?
    `).bind(new Date().toISOString(), errorCode.slice(0, 80), errorMessage.slice(0, 1000), runId),
  ];
  if (run) {
    statements.push(db.prepare(`
      UPDATE products
      SET next_analysis_at = datetime('now', '+1 day'), updated_at = datetime('now')
      WHERE id = ?
    `).bind(run.product_id));
  }
  await db.batch(statements);
}

export async function runnerContext(db: D1Database, runId: string) {
  const run = await db.prepare(`
    SELECT id, product_id, status FROM analysis_runs WHERE id = ?
  `).bind(runId).first<{ id: string; product_id: string; status: string }>();
  if (!run) return null;
  return productContext(db, run.product_id, runId);
}

async function productContext(db: D1Database, productId: string, contextId: string) {
  const product = await getProductRow(db, productId);
  if (!product) return null;
  const sourceConfig = JSON.parse(product.source_config_json) as { subreddits?: string[] };

  return {
    runId: contextId,
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

