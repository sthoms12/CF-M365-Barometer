import type { ProductSummary, SnapshotSummary } from "../shared/contracts";

export const CANONICAL_ORIGIN = "https://www.m365-barometer.com";
export const INDEPENDENT_DISCLAIMER = "Independent project, not affiliated with Microsoft.";

const AI_CRAWLERS = [
  "GPTBot",
  "ClaudeBot",
  "PerplexityBot",
  "Google-Extended",
  "CCBot",
  "Bingbot",
] as const;

const SITE_DESCRIPTION = "Public sentiment trends for Microsoft 365 products.";

export type SitemapEntry = {
  path: string;
  lastModified: string | null;
};

export type PublicMention = {
  sourceType: string;
  sourceTitle: string;
  sourceUrl: string | null;
  sentiment: string;
  excerpt: string;
};

export type PublicPage = {
  title: string;
  description: string;
  canonicalPath: string;
  mainHtml: string;
  jsonLd: unknown;
};

export function renderRobotsTxt(): string {
  const lines = ["User-agent: *", "Allow: /", ""];
  for (const agent of AI_CRAWLERS) {
    lines.push(`User-agent: ${agent}`, "Allow: /", "");
  }
  lines.push(`Sitemap: ${CANONICAL_ORIGIN}/sitemap.xml`, "");
  return lines.join("\n");
}

export function canonicalUrl(path: string): string {
  if (path === "/") return `${CANONICAL_ORIGIN}/`;
  return `${CANONICAL_ORIGIN}${path.startsWith("/") ? path : `/${path}`}`;
}

export function toLastMod(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const hasZone = /(?:z|[+-]\d{2}:?\d{2})$/i.test(trimmed);
  const normalized = hasZone ? trimmed : `${trimmed.replace(" ", "T")}Z`;
  const time = Date.parse(normalized);
  if (Number.isNaN(time)) return null;
  return new Date(time).toISOString();
}

export function sitemapEntries(products: Array<{ slug: string; lastModified: string | null }>): SitemapEntry[] {
  const latest = latestTimestamp(products.map((product) => product.lastModified));
  const pages = [...products].sort((left, right) => left.slug.localeCompare(right.slug));
  return [
    { path: "/", lastModified: latest },
    { path: "/products", lastModified: latest },
    ...pages.map((product) => ({
      path: `/products/${encodeURIComponent(product.slug)}`,
      lastModified: product.lastModified,
    })),
  ];
}

export function renderSitemap(entries: SitemapEntry[]): string {
  const urls = entries.map((entry) => {
    const lastmod = toLastMod(entry.lastModified);
    const lines = ["  <url>", `    <loc>${escapeXml(canonicalUrl(entry.path))}</loc>`];
    if (lastmod) lines.push(`    <lastmod>${lastmod}</lastmod>`);
    lines.push("  </url>");
    return lines.join("\n");
  });
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
    ...urls,
    `</urlset>`,
    ``,
  ].join("\n");
}

export function buildHomePage(products: ProductSummary[]): PublicPage {
  const items = products.map((product) => `<li>${renderProductSummary(product)}</li>`).join("");
  const mainHtml = `<main>
    <h1>Microsoft 365 sentiment, measured in public.</h1>
    <p>Automated weekly readings from recent community discussions, scored consistently over time.</p>
    <p>Score measures sentiment. Momentum measures change from the previous reading.</p>
    <h2>Tracked products</h2>
    ${items ? `<ul>${items}</ul>` : "<p>No active products are stored.</p>"}
    <p><a href="/products">All products</a></p>
  </main>`;
  return {
    title: "M365 Barometer",
    description: SITE_DESCRIPTION,
    canonicalPath: "/",
    mainHtml,
    jsonLd: graph(catalogDataset(products, canonicalUrl("/"))),
  };
}

export function buildProductsPage(products: ProductSummary[]): PublicPage {
  const items = products.map((product) => `<li>${renderProductSummary(product)}</li>`).join("");
  const mainHtml = `<main>
    <h1>Microsoft 365 Products</h1>
    <p>Every active product receives an automated Last30Days reading once per week.</p>
    ${items ? `<ul>${items}</ul>` : "<p>No active products are stored.</p>"}
  </main>`;
  return {
    title: "Microsoft 365 Products | M365 Barometer",
    description: "Every active product receives an automated Last30Days reading once per week.",
    canonicalPath: "/products",
    mainHtml,
    jsonLd: graph(catalogDataset(products, canonicalUrl("/products"))),
  };
}

export function buildProductPage(product: ProductSummary, mentions: PublicMention[]): PublicPage {
  const snapshot = product.snapshot;
  const description = metaDescription(
    snapshot?.summary || product.description || `${product.name} on M365 Barometer.`,
  );
  const path = `/products/${encodeURIComponent(product.slug)}`;
  const sections = [
    snapshot ? readingSection(snapshot) : "<p>No automated reading is stored for this product yet.</p>",
    product.isStale ? "<p>Stale</p>" : "",
    snapshot && snapshot.positiveSignals.length
      ? `<h2>Positive signals</h2><ul>${snapshot.positiveSignals.map((signal) => `<li>${escapeHtml(signal)}</li>`).join("")}</ul>`
      : "",
    snapshot && snapshot.negativeSignals.length
      ? `<h2>Negative signals</h2><ul>${snapshot.negativeSignals.map((signal) => `<li>${escapeHtml(signal)}</li>`).join("")}</ul>`
      : "",
    snapshot ? sourceSection(snapshot) : "",
    mentions.length ? mentionSection(mentions) : "",
  ].join("");
  const mainHtml = `<main>
    <p>Microsoft 365 community barometer</p>
    <h1>${escapeHtml(product.name)}</h1>
    ${product.description ? `<p>${escapeHtml(product.description)}</p>` : ""}
    <p>Last analyzed: ${escapeHtml(product.lastAnalyzedAt ?? "Not analyzed")}</p>
    ${sections}
    <p><a href="/products">All products</a></p>
  </main>`;
  return {
    title: `${product.name} | M365 Barometer`,
    description,
    canonicalPath: path,
    mainHtml,
    jsonLd: graph(productDataset(product, canonicalUrl(path))),
  };
}

export function applySeoToShell(shell: string, page: PublicPage): string {
  const title = escapeHtml(page.title);
  const description = escapeHtml(page.description);
  const canonical = escapeHtml(canonicalUrl(page.canonicalPath));
  const head = [
    `<link rel="canonical" href="${canonical}" />`,
    `<meta property="og:site_name" content="M365 Barometer" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:url" content="${canonical}" />`,
    `<meta name="twitter:card" content="summary" />`,
    `<meta name="twitter:title" content="${title}" />`,
    `<meta name="twitter:description" content="${description}" />`,
    jsonLdScript(page.jsonLd),
  ].join("");

  if (!/<title>[\s\S]*?<\/title>/i.test(shell)) throw new Error("App shell is missing <title>");
  let html = shell.replace(/<title>[\s\S]*?<\/title>/i, `<title>${title}</title>`);
  if (/<meta\s+name=["']description["'][^>]*>/i.test(html)) {
    html = html.replace(
      /<meta\s+name=["']description["'][^>]*>/i,
      `<meta name="description" content="${description}" />`,
    );
  } else {
    html = html.replace("</head>", `<meta name="description" content="${description}" /></head>`);
  }
  if (!html.includes("</head>")) throw new Error("App shell is missing </head>");
  html = html.replace("</head>", `${head}</head>`);
  if (!/<div id="root">[\s\S]*?<\/div>/.test(html)) throw new Error("App shell is missing #root");
  html = html.replace(/<div id="root">[\s\S]*?<\/div>/, `<div id="root">${page.mainHtml}</div>`);
  return html;
}

export function renderNotFoundHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Page not found | M365 Barometer</title>
  <meta name="description" content="That page is not on M365 Barometer." />
  <meta name="robots" content="noindex" />
</head>
<body>
  <main>
    <h1>Page not found</h1>
    <p>That path is not on M365 Barometer.</p>
    <p><a href="/">Back to the dashboard</a></p>
  </main>
  <footer>${INDEPENDENT_DISCLAIMER}</footer>
</body>
</html>
`;
}

export function isStaticAssetPath(pathname: string): boolean {
  if (pathname === "/robots.txt" || pathname === "/sitemap.xml" || pathname === "/index.html") return false;
  const segment = pathname.split("/").pop() ?? "";
  return /^[A-Za-z0-9._-]+\.[A-Za-z0-9]+$/.test(segment);
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderProductSummary(product: ProductSummary): string {
  const href = `/products/${encodeURIComponent(product.slug)}`;
  const snapshot = product.snapshot;
  const reading = snapshot
    ? `<p>Barometer score: ${snapshot.barometerScore}/100. Temperature: ${escapeHtml(snapshot.temperature)}. Momentum: ${formatMomentum(snapshot.momentum)}. Confidence: ${escapeHtml(snapshot.confidence)}. Discussion volume: ${escapeHtml(snapshot.discussionVolume)}.</p><p>${escapeHtml(snapshot.summary)}</p>`
    : "<p>No automated reading is stored for this product yet.</p>";
  const stale = product.isStale ? "<p>Stale</p>" : "";
  return `<a href="${href}">${escapeHtml(product.name)}</a>${product.description ? `<p>${escapeHtml(product.description)}</p>` : ""}${reading}${stale}`;
}

function readingSection(snapshot: SnapshotSummary): string {
  return `<p>Barometer score: ${snapshot.barometerScore}/100</p>
    <p>Temperature: ${escapeHtml(snapshot.temperature)}</p>
    <p>Momentum: ${formatMomentum(snapshot.momentum)}</p>
    <p>Confidence: ${escapeHtml(snapshot.confidence)}</p>
    <p>Discussion volume: ${escapeHtml(snapshot.discussionVolume)}</p>
    <h2>Current reading</h2>
    <p>${escapeHtml(snapshot.summary)}</p>`;
}

function sourceSection(snapshot: SnapshotSummary): string {
  const items = Object.entries(snapshot.sourceBreakdown)
    .map(([source, count]) => `<li>${escapeHtml(source)}: ${count}</li>`)
    .join("");
  return `<h2>Source breakdown</h2><ul>${items}</ul>`;
}

function mentionSection(mentions: PublicMention[]): string {
  const articles = mentions.map((mention) => {
    const href = safeHttpUrl(mention.sourceUrl);
    const link = href ? `<p><a href="${escapeHtml(href)}">Source</a></p>` : "";
    return `<article><p>${escapeHtml(mention.sentiment)} · ${escapeHtml(mention.sourceType)}</p><h3>${escapeHtml(mention.sourceTitle)}</h3><p>${escapeHtml(mention.excerpt)}</p>${link}</article>`;
  }).join("");
  return `<h2>Sample public mentions</h2>${articles}`;
}

function catalogDataset(products: ProductSummary[], url: string) {
  return {
    "@type": "Dataset",
    name: "M365 Barometer",
    description: SITE_DESCRIPTION,
    url,
    isAccessibleForFree: true,
    creator: publisher(),
    hasPart: products.map((product) => productDataset(product, canonicalUrl(`/products/${encodeURIComponent(product.slug)}`))),
  };
}

function productDataset(product: ProductSummary, url: string) {
  const modified = toLastMod(product.lastAnalyzedAt);
  const dataset: Record<string, unknown> = {
    "@type": "Dataset",
    name: product.name,
    url,
    isAccessibleForFree: true,
    creator: publisher(),
  };
  if (product.description) dataset.description = product.description;
  if (product.snapshot?.summary) dataset.description = product.snapshot.summary;
  if (modified) dataset.dateModified = modified;
  if (product.snapshot) {
    dataset.variableMeasured = [
      property("barometerScore", product.snapshot.barometerScore),
      property("temperature", product.snapshot.temperature),
      property("momentum", product.snapshot.momentum),
      property("confidence", product.snapshot.confidence),
      property("discussionVolume", product.snapshot.discussionVolume),
    ];
  }
  return dataset;
}

function graph(dataset: unknown) {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${CANONICAL_ORIGIN}/#website`,
        name: "M365 Barometer",
        url: `${CANONICAL_ORIGIN}/`,
        description: SITE_DESCRIPTION,
        publisher: publisher(),
      },
      dataset,
    ],
  };
}

function publisher() {
  return {
    "@type": "Organization",
    name: "M365 Barometer",
    url: `${CANONICAL_ORIGIN}/`,
    disambiguatingDescription: INDEPENDENT_DISCLAIMER,
  };
}

function property(name: string, value: string | number) {
  return { "@type": "PropertyValue", name, value };
}

function formatMomentum(value: number): string {
  if (value > 0) return `+${value}`;
  return String(value);
}

function metaDescription(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= 160) return normalized;
  const cut = normalized.slice(0, 159);
  const space = cut.lastIndexOf(" ");
  const base = space > 80 ? cut.slice(0, space) : cut;
  return `${base.trimEnd()}…`;
}

function jsonLdScript(data: unknown): string {
  const json = JSON.stringify(data).replaceAll("<", "\\u003c");
  return `<script type="application/ld+json">${json}</script>`;
}

function latestTimestamp(values: Array<string | null>): string | null {
  let best: { raw: string; time: number } | null = null;
  for (const value of values) {
    const iso = toLastMod(value);
    if (!value || !iso) continue;
    const time = Date.parse(iso);
    if (!best || time > best.time) best = { raw: value, time };
  }
  return best?.raw ?? null;
}

function safeHttpUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol === "https:" || url.protocol === "http:") return url.toString();
  } catch {
    return null;
  }
  return null;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
