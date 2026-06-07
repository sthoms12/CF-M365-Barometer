import { aiAnalysisSchema, type AiAnalysis, type EvidenceItem, type IngestPayload, type Sentiment } from "../shared/contracts";
import {
  calculateConfidence,
  calculateScore,
  calculateTemperature,
  calculateVolume,
  selectSampleMentions,
  sourceBreakdown,
  sourceCategory,
} from "./metrics";
import { getPreviousScore, getProductRow } from "./db";

type AiTextResponse = { response?: unknown };

export function parseAiAnalysisResponse(response: unknown): AiAnalysis {
  if (!response) throw new Error("Workers AI returned no response");
  return aiAnalysisSchema.parse(typeof response === "string" ? JSON.parse(response) : response);
}

async function runAi(env: Env, productName: string, evidence: EvidenceItem[]): Promise<AiAnalysis> {
  const prompt = [
    `Analyze public discussion sentiment about ${productName}.`,
    "Classify every supplied evidence item as positive, neutral, or negative.",
    "Write a factual summary under 800 characters and 3-5 concise positive and negative signals.",
    "Return only JSON matching the requested schema. Do not invent evidence.",
    JSON.stringify(evidence),
  ].join("\n\n");

  const result = await env.AI.run(env.AI_MODEL, {
    messages: [{ role: "user", content: prompt }],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "m365_barometer_analysis",
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["classifications", "summary", "positiveSignals", "negativeSignals"],
          properties: {
            classifications: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["id", "sentiment"],
                properties: {
                  id: { type: "string" },
                  sentiment: { type: "string", enum: ["positive", "neutral", "negative"] },
                },
              },
            },
            summary: { type: "string" },
            positiveSignals: { type: "array", items: { type: "string" }, maxItems: 5 },
            negativeSignals: { type: "array", items: { type: "string" }, maxItems: 5 },
          },
        },
      },
    },
  }) as AiTextResponse;

  return parseAiAnalysisResponse(result.response);
}

async function analyzeWithRetry(env: Env, productName: string, evidence: EvidenceItem[]) {
  try {
    return await runAi(env, productName, evidence);
  } catch (error) {
    console.warn(JSON.stringify({ event: "ai_retry", message: error instanceof Error ? error.message : "unknown" }));
    return runAi(env, productName, evidence.slice(0, 30));
  }
}

export async function ingestAnalysis(
  env: Env,
  runId: string,
  payload: IngestPayload,
): Promise<{ snapshotId: string; score: number }> {
  const run = await env.DB.prepare(`
    SELECT id, product_id, status FROM analysis_runs WHERE id = ?
  `).bind(runId).first<{ id: string; product_id: string; status: string }>();
  if (!run) throw new Error("Analysis run not found");

  const completed = await env.DB.prepare(
    "SELECT id, barometer_score FROM sentiment_snapshots WHERE analysis_run_id = ?",
  ).bind(runId).first<{ id: string; barometer_score: number }>();
  if (completed) return { snapshotId: completed.id, score: completed.barometer_score };

  const product = await getProductRow(env.DB, run.product_id);
  if (!product) throw new Error("Product not found");
  await env.DB.prepare("UPDATE analysis_runs SET status = 'synthesizing' WHERE id = ?").bind(runId).run();

  const ai = await analyzeWithRetry(env, product.name, payload.evidence);
  const sentimentById = new Map(ai.classifications.map((item) => [item.id, item.sentiment]));
  const classified = payload.evidence
    .filter((item) => sentimentById.has(item.id))
    .map((item) => ({ ...item, sentiment: sentimentById.get(item.id) as Sentiment }));
  if (classified.length < 3) throw new Error("INSUFFICIENT_EVIDENCE");

  const score = calculateScore(classified.map((item) => item.sentiment));
  const previousScore = await getPreviousScore(env.DB, product.id);
  const momentum = previousScore === null ? 0 : score - previousScore;
  const breakdown = sourceBreakdown(classified);
  const categoryCount = Object.values(breakdown).filter((count) => count > 0).length;
  const failedSources = Object.values(payload.sourceStatus).filter((status) => status === "failed").length;
  const samples = selectSampleMentions(classified);
  const snapshotId = crypto.randomUUID();
  const now = new Date().toISOString();

  const statements = [
    env.DB.prepare(`
      INSERT INTO sentiment_snapshots (
        id, product_id, analysis_run_id, analyzed_at, window_start, window_end,
        barometer_score, temperature, momentum, confidence, discussion_volume,
        summary, positive_signals_json, negative_signals_json, source_breakdown_json,
        source_status_json, classified_evidence_count, ai_model
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      snapshotId, product.id, runId, now, payload.windowStart, payload.windowEnd,
      score, calculateTemperature(score, momentum), momentum,
      calculateConfidence(classified.length, categoryCount, failedSources),
      calculateVolume(classified.length), ai.summary, JSON.stringify(ai.positiveSignals),
      JSON.stringify(ai.negativeSignals), JSON.stringify(breakdown),
      JSON.stringify(payload.sourceStatus), classified.length, env.AI_MODEL,
    ),
    ...samples.map((item, index) => env.DB.prepare(`
      INSERT INTO source_mentions (
        id, snapshot_id, source_type, source_title, source_url, sentiment,
        excerpt, published_at, source_rank
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      crypto.randomUUID(), snapshotId, sourceCategory(item.source), item.title,
      item.url ?? null, item.sentiment, item.excerpt.slice(0, 500), item.publishedAt ?? null, index + 1,
    )),
    env.DB.prepare(`
      UPDATE analysis_runs SET status = 'completed', completed_at = ?, collector_version = ?,
        raw_evidence_count = ?, source_status_json = ?, error_code = NULL, error_message = NULL
      WHERE id = ?
    `).bind(now, payload.collectorVersion, payload.evidence.length, JSON.stringify(payload.sourceStatus), runId),
    env.DB.prepare(`
      UPDATE products SET last_analyzed_at = ?, next_analysis_at = datetime(?, '+7 days'),
        updated_at = ? WHERE id = ?
    `).bind(now, now, now, product.id),
  ];

  await env.DB.batch(statements);
  return { snapshotId, score };
}
