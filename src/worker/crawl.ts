import type { ProductSummary } from "../shared/contracts";
import { CANONICAL_ORIGIN, HOME_DESCRIPTION, INDEPENDENT_DISCLAIMER, SITE_NAME } from "../shared/site";

/**
 * Crawlable HTML, robots.txt, and sitemap.xml.
 *
 * The React app still mounts on `#root` and replaces that empty node.
 * The same response also includes `#prerender` for clients that do not run
 * JavaScript (search and AI crawlers). A blocking script in `<head>` marks
 * `html` with class `js` before the body is parsed, and CSS then hides
 * `#prerender` so people using the app don't see two copies.
 */

export const SEARCH_CRAWLERS = [
  "Googlebot",
  "Bingbot",
  "GPTBot",
  "OAI-SearchBot",
  "ClaudeBot",
  "PerplexityBot",
] as const;

const CANONICAL_HOSTS = new Set(["m365-barometer.com", "www.m365-barometer.com"]);

export type PageContent = {
  title: string;
  description: string;
  canonical: string;
  /** When set, added as a robots meta tag. 404 pages use `noindex`. */
  robots?: string;
  jsonLd: unknown;
  bodyHtml: string;
};

export function publicOrigin(requestUrl: string, configuredBaseUrl?: string): string {
  const url = new URL(requestUrl);
  if (CANONICAL_HOSTS.has(url.hostname.toLowerCase())) return CANONICAL_ORIGIN;
  const configured = configuredBaseUrl?.trim().replace(/\/$/, "");
  if (configured) return configured;
  return url.origin;
}

export function renderRobotsTxt(origin: string): string {
  const groups = [...SEARCH_CRAWLERS, "*"].map((agent) =>
    [`User-agent: ${agent}`, "Allow: /", "Disallow: /api/", ""].join("\n"),
  );
  return `${groups.join("\n")}Sitemap: ${origin}/sitemap.xml\n`;
}

export function renderSitemap(origin: string, products: ProductSummary[]): string {
  const urls = [
    sitemapUrl(`${origin}/`),
    sitemapUrl(`${origin}/products`),
    ...products.map((product) => sitemapUrl(productUrl(origin, product.slug), product.snapshot?.analyzedAt ?? product.lastAnalyzedAt)),
  ];
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
    ...urls,
    `</urlset>`,
    ``,
  ].join("\n");
}

export function renderHomePage(origin: string, products: ProductSummary[]): PageContent {
  const canonical = `${origin}/`;
  const items = products.map((product) => `<li>${productReadingHtml(origin, product)}</li>`).join("");
  const bodyHtml = layout(`
    <h1>Microsoft 365 sentiment, measured in public.</h1>
    <p>Automated readings of recent public discussion. The score runs from 0 to 100. Temperature is the label for that score, and the summary is the latest reading.</p>
    <section>
      <h2>Current readings</h2>
      ${items ? `<ul class="reading-list">${items}</ul>` : `<p>No active products are in the catalog yet.</p>`}
    </section>
  `);
  return {
    title: SITE_NAME,
    description: HOME_DESCRIPTION,
    canonical,
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: SITE_NAME,
      url: canonical,
      description: HOME_DESCRIPTION,
      publisher: {
        "@type": "Organization",
        name: SITE_NAME,
        disambiguatingDescription: INDEPENDENT_DISCLAIMER,
      },
    },
    bodyHtml,
  };
}

export function renderProductsPage(origin: string, products: ProductSummary[]): PageContent {
  const canonical = `${origin}/products`;
  const items = products.map((product) => `<li>${productReadingHtml(origin, product)}</li>`).join("");
  return {
    title: `Microsoft 365 products | ${SITE_NAME}`,
    description: HOME_DESCRIPTION,
    canonical,
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: SITE_NAME,
      url: `${origin}/`,
      description: HOME_DESCRIPTION,
    },
    bodyHtml: layout(`
      <p class="eyebrow">Tracked portfolio</p>
      <h1>Microsoft 365 products</h1>
      <p>Every active product has its own page with the latest public sentiment reading.</p>
      ${items ? `<ul class="reading-list">${items}</ul>` : `<p>No active products are in the catalog yet.</p>`}
    `),
  };
}

export function renderProductPage(origin: string, product: ProductSummary): PageContent {
  const canonical = productUrl(origin, product.slug);
  const snapshot = product.snapshot;
  const summary = snapshot?.summary?.trim() || product.description?.trim() || "No summary is available for this product yet.";
  const updatedLabel = formatUpdatedDate(snapshot?.analyzedAt ?? product.lastAnalyzedAt);
  const updatedIso = isoTimestamp(snapshot?.analyzedAt ?? product.lastAnalyzedAt);
  const score = snapshot ? String(snapshot.barometerScore) : "Not yet analyzed";
  const temperature = snapshot?.temperature ?? "Not yet analyzed";
  const jsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: `${product.name} public sentiment`,
    description: summary,
    url: canonical,
    creator: {
      "@type": "Organization",
      name: SITE_NAME,
      url: `${origin}/`,
    },
    isAccessibleForFree: true,
    keywords: ["Microsoft 365", product.name, "sentiment"],
  };
  if (updatedIso) jsonLd.dateModified = updatedIso;

  return {
    title: `${product.name} | ${SITE_NAME}`,
    description: metaDescription(summary),
    canonical,
    jsonLd,
    bodyHtml: layout(`
      <p class="eyebrow">Microsoft 365 community barometer</p>
      <h1>${escapeHtml(product.name)}</h1>
      ${product.description ? `<p>${escapeHtml(product.description)}</p>` : ""}
      <dl class="reading-facts">
        <div><dt>Temperature</dt><dd>${escapeHtml(temperature)}</dd></div>
        <div><dt>Score</dt><dd>${escapeHtml(score)}${snapshot ? `<span>/100</span>` : ""}</dd></div>
        <div><dt>Last updated</dt><dd>${updatedIso ? `<time datetime="${escapeHtml(updatedIso)}">${escapeHtml(updatedLabel)}</time>` : escapeHtml(updatedLabel)}</dd></div>
      </dl>
      <h2>Summary</h2>
      <p>${escapeHtml(summary)}</p>
      <p><a href="/products">All products</a></p>
    `),
  };
}

export function renderNotFoundPage(origin: string): PageContent {
  return {
    title: `Product not found | ${SITE_NAME}`,
    description: "This product is not in the M365 Barometer catalog.",
    canonical: `${origin}/products`,
    robots: "noindex",
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: SITE_NAME,
      url: `${origin}/`,
    },
    bodyHtml: layout(`
      <h1>Product not found</h1>
      <p>This product is not in the M365 Barometer catalog.</p>
      <p><a href="/products">Browse products</a></p>
    `),
  };
}

const FALLBACK_SHELL = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${SITE_NAME}</title>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`;

export function injectDocument(shell: string, page: PageContent): string {
  let html = shell.includes('id="root"') ? shell : FALLBACK_SHELL;
  const headExtras = [
    `<script>document.documentElement.classList.add("js")</script>`,
    `<style>html.js #prerender{display:none}</style>`,
    `<link rel="canonical" href="${escapeHtml(page.canonical)}" />`,
    `<meta property="og:title" content="${escapeHtml(page.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(page.description)}" />`,
    `<meta property="og:url" content="${escapeHtml(page.canonical)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${escapeHtml(SITE_NAME)}" />`,
    page.robots ? `<meta name="robots" content="${escapeHtml(page.robots)}" />` : "",
    `<script type="application/ld+json">${serializeJsonLd(page.jsonLd)}</script>`,
  ].filter(Boolean).join("\n    ");

  html = html.replace(/<head[^>]*>/i, (open) => `${open}\n    ${headExtras}`);
  if (/<title>[\s\S]*?<\/title>/i.test(html)) {
    html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(page.title)}</title>`);
  } else {
    html = html.replace("</head>", `<title>${escapeHtml(page.title)}</title>\n</head>`);
  }
  const descriptionTag = `<meta name="description" content="${escapeHtml(page.description)}" />`;
  if (/<meta\s+name=["']description["'][^>]*>/i.test(html)) {
    html = html.replace(/<meta\s+name=["']description["'][^>]*>/i, descriptionTag);
  } else {
    html = html.replace("</head>", `${descriptionTag}\n</head>`);
  }
  const prerender = `<div id="prerender">${page.bodyHtml}</div>\n    <div id="root"></div>`;
  if (/<div id="root">\s*<\/div>/.test(html)) {
    html = html.replace(/<div id="root">\s*<\/div>/, prerender);
  } else {
    html = html.replace("</body>", `${prerender}\n</body>`);
  }
  return html;
}

export function formatUpdatedDate(value: string | null): string {
  const date = parseTimestamp(value);
  if (!date) return "Not yet analyzed";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function layout(mainHtml: string): string {
  return [
    `<header class="site-header">`,
    `<a class="brand" href="/">${escapeHtml(SITE_NAME)}</a>`,
    `<nav aria-label="Primary">`,
    `<a href="/">Dashboard</a>`,
    `<a href="/products">Products</a>`,
    `</nav>`,
    `</header>`,
    `<main class="page-shell">${mainHtml}</main>`,
    `<footer class="site-footer"><p>${escapeHtml(INDEPENDENT_DISCLAIMER)}</p></footer>`,
  ].join("");
}

function productReadingHtml(origin: string, product: ProductSummary): string {
  const snapshot = product.snapshot;
  const updated = formatUpdatedDate(snapshot?.analyzedAt ?? product.lastAnalyzedAt);
  const temperature = snapshot?.temperature ?? "Not yet analyzed";
  const score = snapshot ? `${snapshot.barometerScore}/100` : "Not yet analyzed";
  const summary = snapshot?.summary?.trim() || product.description?.trim() || "No summary is available yet.";
  return [
    `<a href="${escapeHtml(productUrl(origin, product.slug))}">${escapeHtml(product.name)}</a>`,
    `<p>Temperature: ${escapeHtml(temperature)}. Score: ${escapeHtml(score)}. Last updated: ${escapeHtml(updated)}.</p>`,
    `<p>${escapeHtml(summary)}</p>`,
  ].join("");
}

function productUrl(origin: string, slug: string): string {
  return `${origin}/products/${encodeURIComponent(slug)}`;
}

function sitemapUrl(loc: string, lastModified?: string | null): string {
  const lastmod = sitemapDate(lastModified);
  const lines = [`  <url>`, `    <loc>${escapeXml(loc)}</loc>`];
  if (lastmod) lines.push(`    <lastmod>${lastmod}</lastmod>`);
  lines.push(`  </url>`);
  return lines.join("\n");
}

function sitemapDate(value?: string | null): string | null {
  const date = parseTimestamp(value ?? null);
  if (!date) return null;
  return date.toISOString().slice(0, 10);
}

function isoTimestamp(value: string | null): string | null {
  const date = parseTimestamp(value);
  return date ? date.toISOString() : null;
}

function parseTimestamp(value: string | null | undefined): Date | null {
  if (!value) return null;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(" ", "T")}Z`
    : value;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function metaDescription(value: string): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= 160) return text;
  return `${text.slice(0, 157).trimEnd()}...`;
}

function serializeJsonLd(value: unknown): string {
  // Keep `<` out of the script tag so a summary cannot close it early.
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
