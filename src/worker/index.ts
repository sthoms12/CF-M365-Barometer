import { Hono } from "hono";
import { ingestPayloadSchema, productInputSchema } from "../shared/contracts";
import { ingestAnalysis } from "./analysis";
import {
  createProduct,
  getAdminProducts,
  getHistory,
  getMentions,
  getProductBySlug,
  getProducts,
  setProductActive,
  updateProduct,
} from "./db";
import {
  createAndDispatchRun,
  markRunFailed,
  runScheduledMonitoring,
  runnerContext,
} from "./automation";
import { accessAuth, bearerAuth } from "./security";
import { getAiQuotaStatus } from "./aiQuota";

const app = new Hono<{ Bindings: Env }>();

app.onError((error, context) => {
  console.error(JSON.stringify({ event: "request_error", message: error.message, path: context.req.path }));
  return context.json({ error: "Internal server error" }, 500);
});

app.get("/api/health", (context) => context.json({ ok: true }));

app.get("/api/products", async (context) => context.json({ products: await getProducts(context.env.DB) }));

app.get("/api/home", async (context) => {
  const products = (await getProducts(context.env.DB)).filter((product) => product.snapshot);
  const byScore = [...products].sort((a, b) => (b.snapshot?.barometerScore ?? 0) - (a.snapshot?.barometerScore ?? 0));
  const byMomentum = [...products].sort((a, b) => (b.snapshot?.momentum ?? 0) - (a.snapshot?.momentum ?? 0));
  const volumeRank = { "Very High": 4, High: 3, Medium: 2, Low: 1 };
  const byVolume = [...products].sort((a, b) =>
    volumeRank[b.snapshot?.discussionVolume ?? "Low"] - volumeRank[a.snapshot?.discussionVolume ?? "Low"],
  );
  const recentlyAnalyzed = [...products].sort((a, b) =>
    new Date(b.lastAnalyzedAt ?? 0).getTime() - new Date(a.lastAnalyzedAt ?? 0).getTime(),
  );

  return context.json({
    sections: {
      heatingUp: byMomentum.filter((product) => (product.snapshot?.momentum ?? 0) > 0).slice(0, 5),
      coolingOff: [...byMomentum].reverse().filter((product) => (product.snapshot?.momentum ?? 0) < 0).slice(0, 5),
      highestScores: byScore.slice(0, 5),
      lowestScores: [...byScore].reverse().slice(0, 5),
      mostDiscussed: byVolume.slice(0, 5),
      recentlyAnalyzed: recentlyAnalyzed.slice(0, 5),
    },
  });
});

app.get("/api/products/:slug", async (context) => {
  const product = await getProductBySlug(context.env.DB, context.req.param("slug"));
  if (!product) return context.json({ error: "Product not found" }, 404);
  const mentions = product.snapshot ? await getMentions(context.env.DB, product.snapshot.id) : [];
  return context.json({ product, mentions });
});

app.get("/api/products/:slug/history", async (context) => {
  const product = await getProductBySlug(context.env.DB, context.req.param("slug"));
  if (!product) return context.json({ error: "Product not found" }, 404);
  const days = Math.min(3650, Math.max(30, Number(context.req.query("days") ?? 365)));
  return context.json({ history: await getHistory(context.env.DB, product.id, days) });
});

app.use("/admin/api/*", accessAuth());
app.get("/admin/api/products", async (context) =>
  context.json({ products: await getAdminProducts(context.env.DB) }),
);
app.post("/admin/api/products", async (context) => {
  const input = productInputSchema.parse(await context.req.json());
  return context.json({ id: await createProduct(context.env.DB, input) }, 201);
});
app.patch("/admin/api/products/:id", async (context) => {
  const input = productInputSchema.parse(await context.req.json());
  await updateProduct(context.env.DB, context.req.param("id"), input);
  return context.json({ ok: true });
});
app.post("/admin/api/products/:id/disable", async (context) => {
  await setProductActive(context.env.DB, context.req.param("id"), false);
  return context.json({ ok: true });
});
app.post("/admin/api/products/:id/enable", async (context) => {
  await setProductActive(context.env.DB, context.req.param("id"), true);
  return context.json({ ok: true });
});
app.post("/admin/api/products/:id/analyze", async (context) => {
  const id = await createAndDispatchRun(context.env, context.req.param("id"), "admin_product");
  return context.json({ runId: id }, 202);
});
app.post("/admin/api/analysis-runs/all", async (context) => {
  const products = (await getProducts(context.env.DB, true)).filter((product) => product.isActive);
  const runIds: string[] = [];
  for (const product of products) {
    runIds.push(await createAndDispatchRun(context.env, product.id, "admin_all"));
  }
  return context.json({ runIds }, 202);
});
app.get("/admin/api/analysis-runs", async (context) => {
  const { results } = await context.env.DB.prepare(`
    SELECT r.*, p.name AS product_name FROM analysis_runs r
    JOIN products p ON p.id = r.product_id ORDER BY r.requested_at DESC LIMIT 200
  `).all();
  return context.json({ runs: results });
});
app.get("/admin/api/ai-status", async (context) =>
  context.json(await getAiQuotaStatus(context.env.DB)),
);
app.get("/admin/api/analysis-runs/:id", async (context) => {
  const run = await context.env.DB.prepare(`
    SELECT r.*, p.name AS product_name FROM analysis_runs r
    JOIN products p ON p.id = r.product_id WHERE r.id = ?
  `).bind(context.req.param("id")).first();
  return run ? context.json({ run }) : context.json({ error: "Run not found" }, 404);
});

app.use("/api/internal/*", bearerAuth("INGEST_TOKEN"));
app.get("/api/internal/analysis-runs/:id/context", async (context) => {
  const result = await runnerContext(context.env.DB, context.req.param("id"));
  return result ? context.json(result) : context.json({ error: "Run not found" }, 404);
});
app.post("/api/internal/analysis-runs/:id/start", async (context) => {
  await context.env.DB.prepare(`
    UPDATE analysis_runs SET status = 'collecting', started_at = ? WHERE id = ?
  `).bind(new Date().toISOString(), context.req.param("id")).run();
  return context.json({ ok: true });
});
app.post("/api/internal/analysis-runs/:id/ingest", async (context) => {
  const payload = ingestPayloadSchema.parse(await context.req.json());
  return context.json(await ingestAnalysis(context.env, context.req.param("id"), payload));
});
app.post("/api/internal/analysis-runs/:id/fail", async (context) => {
  const body = await context.req.json<{ errorCode?: string; errorMessage?: string }>();
  await markRunFailed(
    context.env.DB,
    context.req.param("id"),
    body.errorCode ?? "COLLECTOR_FAILED",
    body.errorMessage ?? "Collector failed",
  );
  return context.json({ ok: true });
});

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env, context: ExecutionContext) {
    context.waitUntil(runScheduledMonitoring(env));
  },
} satisfies ExportedHandler<Env>;
