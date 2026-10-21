import { Hono } from "hono";
import { ingestPayloadSchema } from "../shared/contracts";
import { buildHomeSections } from "../shared/home";
import { AiScoringError, ingestAnalysis } from "./analysis";
import {
  getHistory,
  getMentions,
  getProductBySlug,
  getProducts,
  listDueProductSlugs,
  listSitemapProducts,
} from "./db";
import {
  createBotAnalysisRun,
  markRunFailed,
  runScheduledMonitoring,
  runnerContext,
} from "./automation";
import { rateLimitPublicApi } from "./rate-limit";
import { bearerAuth } from "./security";
import { backfillSignalHistory, ingestExternalSignals, readSupplyDemand } from "./signals";
import {
  applySeoToShell,
  buildHomePage,
  buildProductPage,
  buildProductsPage,
  isStaticAssetPath,
  renderNotFoundHtml,
  renderRobotsTxt,
  renderSitemap,
  sitemapEntries,
  type PublicMention,
  type PublicPage,
} from "./seo";

const app = new Hono<{ Bindings: Env }>();

const HTML_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "public, max-age=300",
};

app.onError((error, context) => {
  console.error(JSON.stringify({ event: "request_error", message: error.message, path: context.req.path }));
  return context.json({ error: "Internal server error" }, 500);
});

app.use("*", async (context, next) => {
  const path = context.req.path;
  const method = context.req.method;
  if ((method === "GET" || method === "HEAD") && path.length > 1 && path.endsWith("/") && !isApiPath(path)) {
    const url = new URL(context.req.url);
    url.pathname = path.replace(/\/+$/, "") || "/";
    return context.redirect(`${url.pathname}${url.search}`, 301);
  }
  await next();
});

app.use("/api/*", rateLimitPublicApi());

app.get("/api/health", (context) => context.json({ ok: true }));

app.get("/api/products", async (context) => context.json({ products: await getProducts(context.env.DB) }));

app.get("/api/home", async (context) => {
  return context.json({ sections: buildHomeSections(await getProducts(context.env.DB)) });
});

app.get("/api/products/:slug", async (context) => {
  const product = await getProductBySlug(context.env.DB, context.req.param("slug"));
  if (!product) return context.json({ error: "Product not found" }, 404);
  const mentions = product.snapshot ? await getMentions(context.env.DB, product.snapshot.id) : [];
  const supplyDemand = await readSupplyDemand(context.env.DB, product.id);
  return context.json({ product: { ...product, supplyDemand }, mentions });
});

app.get("/api/products/:slug/history", async (context) => {
  const product = await getProductBySlug(context.env.DB, context.req.param("slug"));
  if (!product) return context.json({ error: "Product not found" }, 404);
  const days = Math.min(3650, Math.max(30, Number(context.req.query("days") ?? 365)));
  return context.json({ history: await getHistory(context.env.DB, product.id, days) });
});

// Token-protected endpoints used by the external analysis bot.
app.use("/api/internal/*", bearerAuth("INGEST_TOKEN"));
app.get("/api/internal/analysis-runs/due", async (context) => {
  return context.json({ slugs: await listDueProductSlugs(context.env.DB) });
});
app.post("/api/internal/analysis-runs", async (context) => {
  let productSlug: string | undefined;
  const raw = await context.req.text();
  if (raw.trim()) {
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return context.json({ error: "Expected a JSON object" }, 400);
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return context.json({ error: "Expected a JSON object" }, 400);
    }
    const supplied = (body as { productSlug?: unknown }).productSlug;
    if (supplied != null) {
      if (typeof supplied !== "string") return context.json({ error: "productSlug must be a string" }, 400);
      productSlug = supplied.trim() || undefined;
    }
  }

  const result = await createBotAnalysisRun(context.env.DB, productSlug);
  if (result.status === "none_due") return new Response(null, { status: 204 });
  if (result.status === "not_found") return context.json({ error: "Product not found" }, 404);
  return context.json({ runId: result.runId, context: result.context });
});
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
  const runId = context.req.param("id");
  try {
    return context.json(await ingestAnalysis(context.env, runId, payload));
  } catch (error) {
    if (!(error instanceof AiScoringError)) throw error;
    const message = (error.message || "AI scoring failed").slice(0, 1000);
    console.error(JSON.stringify({ event: "ai_scoring_failed", runId, message }));
    await markRunFailed(context.env.DB, runId, error.errorCode, message);
    return context.json({ errorCode: error.errorCode, message }, 500);
  }
});
app.post("/api/internal/signals/backfill", async (context) => {
  const raw = await context.req.text();
  let body: { weeks?: unknown; productSlug?: unknown; sources?: unknown } = {};
  if (raw.trim()) {
    try {
      body = JSON.parse(raw) as typeof body;
    } catch {
      return context.json({ error: "Expected a JSON object" }, 400);
    }
  }
  const weeks = body.weeks === undefined ? 26 : body.weeks;
  if (typeof weeks !== "number" || !Number.isInteger(weeks) || weeks < 1 || weeks > 26) {
    return context.json({ error: "weeks must be an integer from 1 to 26" }, 400);
  }
  const productSlug = body.productSlug === undefined ? undefined : body.productSlug;
  if (productSlug !== undefined && typeof productSlug !== "string") {
    return context.json({ error: "productSlug must be a string" }, 400);
  }
  const allowed = new Set(["wikipedia", "hacker_news"]);
  const sources = body.sources === undefined ? undefined : body.sources;
  if (sources !== undefined && (!Array.isArray(sources) || sources.some((source) => typeof source !== "string" || !allowed.has(source)))) {
    return context.json({ error: "sources must be wikipedia and hacker_news" }, 400);
  }
  const result = await backfillSignalHistory(context.env, {
    weeks,
    productSlug,
    sources: sources as Array<"wikipedia" | "hacker_news"> | undefined,
  });
  if (productSlug && result.errors.some((error) => error.message === "Product not found")) {
    return context.json({ error: "Product not found" }, 404);
  }
  return context.json(result);
});
app.post("/api/internal/signals", async (context) => {
  let body: unknown;
  try {
    body = await context.req.json();
  } catch {
    return context.json({ error: "Expected a JSON object" }, 400);
  }
  const result = await ingestExternalSignals(context.env.DB, body);
  if ("error" in result) {
    const status = result.error.startsWith("Product not found") ? 404 : 400;
    return context.json({ error: result.error }, status);
  }
  return context.json(result);
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

app.get("/robots.txt", (context) => new Response(renderRobotsTxt(), {
  status: 200,
  headers: {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "public, max-age=3600",
  },
}));

app.get("/sitemap.xml", async (context) => {
  const products = await listSitemapProducts(context.env.DB);
  return new Response(renderSitemap(sitemapEntries(products)), {
    status: 200,
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
});

app.get("/index.html", (context) => context.redirect("/", 301));
app.get("/", (context) => renderHtmlPage(context, { kind: "home" }));
app.get("/products", (context) => renderHtmlPage(context, { kind: "products" }));
app.get("/products/:slug", (context) => renderHtmlPage(context, { kind: "product", slug: context.req.param("slug") }));

app.notFound((context) => {
  if (isApiPath(context.req.path)) return context.json({ error: "Not found" }, 404);
  if (isStaticAssetPath(context.req.path)) return context.env.ASSETS.fetch(context.req.raw);
  return new Response(renderNotFoundHtml(), {
    status: 404,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
    },
  });
});

async function renderHtmlPage(
  context: { req: { url: string }; env: Env },
  target: { kind: "home" } | { kind: "products" } | { kind: "product"; slug: string },
): Promise<Response> {
  const products = await getProducts(context.env.DB);
  let page: PublicPage;
  if (target.kind === "home") page = buildHomePage(products);
  else if (target.kind === "products") page = buildProductsPage(products);
  else {
    const product = products.find((item) => item.slug === target.slug);
    if (!product) {
      return new Response(renderNotFoundHtml(), {
        status: 404,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "x-robots-tag": "noindex",
        },
      });
    }
    const mentions = product.snapshot
      ? asMentions(await getMentions(context.env.DB, product.snapshot.id))
      : [];
    const supplyDemand = await readSupplyDemand(context.env.DB, product.id);
    const history = (await getHistory(context.env.DB, product.id, 365)).map((row) => ({
      analyzedAt: String(row.analyzedAt ?? ""),
      barometerScore: Number(row.barometerScore ?? 0),
    }));
    page = buildProductPage({ ...product, supplyDemand }, mentions, history);
  }

  const shell = await context.env.ASSETS.fetch(new Request(new URL("/index.html", context.req.url)));
  if (!shell.ok) return new Response("App shell unavailable", { status: 502 });
  return new Response(applySeoToShell(await shell.text(), page), { status: 200, headers: HTML_HEADERS });
}

function asMentions(rows: readonly Record<string, unknown>[]): PublicMention[] {
  return rows.map((row) => ({
    sourceType: String(row.sourceType ?? ""),
    sourceTitle: String(row.sourceTitle ?? ""),
    sourceUrl: typeof row.sourceUrl === "string" ? row.sourceUrl : null,
    sentiment: String(row.sentiment ?? ""),
    excerpt: String(row.excerpt ?? ""),
  }));
}

function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

export { app };

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env, context: ExecutionContext) {
    context.waitUntil(runScheduledMonitoring(env));
  },
} satisfies ExportedHandler<Env>;
