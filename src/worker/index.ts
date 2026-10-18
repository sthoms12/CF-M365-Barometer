import { Hono } from "hono";
import { ingestPayloadSchema } from "../shared/contracts";
import { ingestAnalysis } from "./analysis";
import {
  publicOrigin,
  renderHomePage,
  renderNotFoundPage,
  renderProductPage,
  renderProductsPage,
  renderRobotsTxt,
  renderSitemap,
} from "./crawl";
import {
  getHistory,
  getMentions,
  getProductBySlug,
  getProducts,
} from "./db";
import { servePage } from "./html";
import {
  markRunFailed,
  runScheduledMonitoring,
  runnerContext,
} from "./automation";
import { apiRateLimitResponse } from "./rate-limit";
import { bearerAuth } from "./security";

const app = new Hono<{ Bindings: Env }>();

app.use("/api/*", async (context, next) => {
  const limited = await apiRateLimitResponse(context.env.API_RATE_LIMITER, context.req.raw);
  if (limited) return limited;
  await next();
});

app.onError((error, context) => {
  console.error(JSON.stringify({ event: "request_error", message: error.message, path: context.req.path }));
  return context.json({ error: "Internal server error" }, 500);
});

app.get("/robots.txt", (context) => {
  const origin = publicOrigin(context.req.url, context.env.PUBLIC_BASE_URL);
  return new Response(renderRobotsTxt(origin), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600",
      "x-content-type-options": "nosniff",
    },
  });
});

app.get("/sitemap.xml", async (context) => {
  const origin = publicOrigin(context.req.url, context.env.PUBLIC_BASE_URL);
  const products = await getProducts(context.env.DB);
  return new Response(renderSitemap(origin, products), {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=300",
      "x-content-type-options": "nosniff",
    },
  });
});

app.get("/", async (context) => {
  const origin = publicOrigin(context.req.url, context.env.PUBLIC_BASE_URL);
  const products = await getProducts(context.env.DB);
  return servePage(context.req.url, context.env.ASSETS, renderHomePage(origin, products), 200);
});

app.get("/products", async (context) => {
  const origin = publicOrigin(context.req.url, context.env.PUBLIC_BASE_URL);
  const products = await getProducts(context.env.DB);
  return servePage(context.req.url, context.env.ASSETS, renderProductsPage(origin, products), 200);
});

app.get("/products/:slug", async (context) => {
  const origin = publicOrigin(context.req.url, context.env.PUBLIC_BASE_URL);
  const slug = context.req.param("slug");
  const product = await getProductBySlug(context.env.DB, slug);
  if (!product) return servePage(context.req.url, context.env.ASSETS, renderNotFoundPage(origin), 404);
  return servePage(context.req.url, context.env.ASSETS, renderProductPage(origin, product), 200);
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

// Token-protected endpoints used by the GitHub Actions collector workflow.
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

app.notFound((context) => {
  if (context.req.path.startsWith("/api/")) return context.text("404 Not Found", 404);
  return context.env.ASSETS.fetch(context.req.raw);
});

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env, context: ExecutionContext) {
    context.waitUntil(runScheduledMonitoring(env));
  },
} satisfies ExportedHandler<Env>;
