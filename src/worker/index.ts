import { Hono } from "hono";
import { ingestPayloadSchema } from "../shared/contracts";
import { ingestAnalysis } from "./analysis";
import {
  getHistory,
  getMentions,
  getProductBySlug,
  getProducts,
  listSitemapProducts,
} from "./db";
import {
  markRunFailed,
  runScheduledMonitoring,
  runnerContext,
} from "./automation";
import { rateLimitPublicApi } from "./rate-limit";
import { bearerAuth } from "./security";
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
    page = buildProductPage(product, mentions);
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
