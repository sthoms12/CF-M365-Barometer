import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const baseUrl = process.env.API_BASE_URL?.replace(/\/$/, "");
const runId = process.env.ANALYSIS_RUN_ID;
const token = process.env.INGEST_TOKEN;

const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

async function request(route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, { ...options, headers: { ...headers, ...options.headers } });
  if (!response.ok) throw new Error(`${route} failed with ${response.status}: ${await response.text()}`);
  return response.json();
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(`${command} exited ${code}: ${stderr.slice(-3000)}`)));
  });
}

export function normalize(report) {
  const evidence = [];
  const sourceStatus = {};
  const itemsBySource = report.items_by_source ?? {};
  const errorsBySource = report.errors_by_source ?? {};

  for (const [source, items] of Object.entries(itemsBySource)) {
    sourceStatus[source] = Array.isArray(items) && items.length > 0 ? "available" : "returned_zero";
    for (const item of items ?? []) {
      if (!item?.title || !(item.snippet || item.body)) continue;
      evidence.push({
        id: `${source}:${item.item_id ?? evidence.length}`,
        source,
        title: String(item.title).slice(0, 300),
        ...(item.url ? { url: item.url } : {}),
        excerpt: String(item.snippet || item.body).replace(/\s+/g, " ").slice(0, 700),
        ...(item.published_at ? { publishedAt: new Date(item.published_at).toISOString() } : {}),
        rank: Number(item.local_rank_score ?? item.relevance_hint ?? evidence.length + 1),
      });
    }
  }
  for (const source of Object.keys(errorsBySource)) sourceStatus[source] = "failed";

  const ranked = evidence
    .sort((a, b) => b.rank - a.rank)
    .slice(0, 60)
    .map((item, index) => ({ ...item, rank: index + 1 }));

  return {
    collectorVersion: "last30days-v3.3.1",
    windowStart: new Date(report.range_from).toISOString(),
    windowEnd: new Date(report.range_to).toISOString(),
    sourceStatus,
    evidence: ranked,
  };
}

export function buildEngineArgs(engine, context, planPath, env = process.env) {
  const args = [
    engine,
    context.product.analysisQuery,
    "--emit=json",
    "--days=30",
    "--plan", planPath,
    "--web-backend", env.BRAVE_API_KEY ? "brave" : "none",
  ];
  if (context.subreddits?.length) args.push("--subreddits", context.subreddits.join(","));
  return args;
}

export function sourceDiagnostics(report, payload) {
  const raw = Object.fromEntries(
    Object.entries(report.items_by_source ?? {}).map(([source, items]) => [source, Array.isArray(items) ? items.length : 0]),
  );
  const accepted = payload.evidence.reduce((counts, item) => {
    counts[item.source] = (counts[item.source] ?? 0) + 1;
    return counts;
  }, {});
  return {
    raw,
    accepted,
    errors: report.errors_by_source ?? {},
    acceptedTotal: payload.evidence.length,
  };
}

async function main() {
  if (!baseUrl || !runId || !token) throw new Error("API_BASE_URL, ANALYSIS_RUN_ID, and INGEST_TOKEN are required");
  const context = await request(`/api/internal/analysis-runs/${runId}/context`);
  await request(`/api/internal/analysis-runs/${runId}/start`, { method: "POST", body: "{}" });

  const tempDir = process.env.RUNNER_TEMP ?? ".collector-temp";
  await mkdir(tempDir, { recursive: true });
  const planPath = path.join(tempDir, `query-plan-${runId}.json`);
  await writeFile(planPath, JSON.stringify(context.queryPlan), "utf8");

  const engine = path.resolve("vendor/last30days/skills/last30days/scripts/last30days.py");
  const args = buildEngineArgs(engine, context, planPath);

  const stdout = await run("python", args);
  const report = JSON.parse(stdout);
  const payload = normalize(report);
  console.log("Collector source diagnostics:", JSON.stringify(sourceDiagnostics(report, payload)));
  if (payload.evidence.length < 3) throw new Error("INSUFFICIENT_EVIDENCE: collector returned fewer than three usable items");
  await request(`/api/internal/analysis-runs/${runId}/ingest`, { method: "POST", body: JSON.stringify(payload) });
  console.log(`Analysis ${runId} ingested with ${payload.evidence.length} evidence items.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(async (error) => {
    console.error(error);
    try {
      await request(`/api/internal/analysis-runs/${runId}/fail`, {
        method: "POST",
        body: JSON.stringify({ errorCode: "COLLECTOR_FAILED", errorMessage: error instanceof Error ? error.message : String(error) }),
      });
    } catch (reportError) {
      console.error("Could not report failure:", reportError);
    }
    process.exitCode = 1;
  });
}
