import type { ProductSummary, SnapshotSummary, SupplyDemandScore } from "../shared/contracts";
import { MIN_CLASSIFIED_EVIDENCE } from "./analysis";
import { renderHomeAppShell, renderSiteHeader } from "./home-shell";
import {
  CONFIDENCE_FAILURES_BEFORE_DROP,
  CONFIDENCE_HIGH_CATEGORIES,
  CONFIDENCE_HIGH_ITEMS,
  CONFIDENCE_MEDIUM_CATEGORIES,
  CONFIDENCE_MEDIUM_ITEMS,
  CONFIDENCE_VERY_HIGH_CATEGORIES,
  CONFIDENCE_VERY_HIGH_ITEMS,
  SENTIMENT_SCORE_MIDPOINT,
  TEMPERATURE_COLD_AT,
  TEMPERATURE_COOLING_AT,
  TEMPERATURE_HOT_AT,
  TEMPERATURE_WARMING_AT,
  VOLUME_HIGH_AT,
  VOLUME_MEDIUM_AT,
  VOLUME_VERY_HIGH_AT,
} from "./metrics";
import { renderProductAppShell, renderProductsAppShell, type ShellHistoryPoint } from "./page-shell";
import {
  DEMAND_MOMENTUM_WEEKS,
  HIGH_CONFIDENCE_SOURCES,
  HISTORY_WEEKS,
  LABEL_COLD_AT,
  LABEL_HOT_AT,
  MIN_SOURCE_WEEKS,
  MIN_SOURCES_FOR_LABEL,
  MIN_WEEKS_FOR_FULL_INDEX,
} from "./signal-catalog";

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
export const DATASET_LICENSE = "https://creativecommons.org/licenses/by/4.0/";

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
  markdown: string;
  jsonLd: unknown;
};

/**
 * Derives a Markdown mirror from the same semantic HTML that renders the
 * page's crawl copy, so the mirror can never drift from the site's own
 * stored content. Supports only the tags the semantic builders emit
 * (main, headings, paragraphs, lists, articles, anchors).
 */
export function semanticHtmlToMarkdown(html: string): string {
  const plain = (value: string): string => value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  let markdown = html.replace(
    /<a\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi,
    (_match, href: string, text: string) => `[${plain(text)}](${href.startsWith("/") ? canonicalUrl(href) : href})`,
  );
  markdown = markdown.replace(/<li>([\s\S]*?)<\/li>/gi, (_match, inner: string) => `\n- ${plain(inner)}\n`);
  markdown = markdown.replace(/<h1>([\s\S]*?)<\/h1>/gi, (_match, text: string) => `\n# ${plain(text)}\n\n`);
  markdown = markdown.replace(/<h2>([\s\S]*?)<\/h2>/gi, (_match, text: string) => `\n## ${plain(text)}\n\n`);
  markdown = markdown.replace(/<h3>([\s\S]*?)<\/h3>/gi, (_match, text: string) => `\n### ${plain(text)}\n\n`);
  markdown = markdown.replace(/<p>([\s\S]*?)<\/p>/gi, (_match, text: string) => `${plain(text)}\n\n`);
  markdown = markdown.replace(/<[^>]+>/g, "");
  markdown = markdown
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
  // Inter-tag indentation in the source templates is literal text once the
  // tags are stripped; the mirrors have no intentional indentation, and a
  // 4-space indent would render as a code block, so trim every line fully.
  const lines = markdown.split("\n").map((line) => line.trim());
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

export function renderRobotsTxt(): string {
  const lines = ["User-agent: *", "Allow: /", "Content-Signal: ai-train=no, search=yes, ai-input=yes", ""];
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
    { path: "/methodology", lastModified: null },
    { path: "/about", lastModified: null },
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
  const semantic = `<main>
    <h1>Microsoft 365 sentiment, measured in public.</h1>
    <p>Automated weekly readings from recent community discussions, scored consistently over time.</p>
    <p>Score measures sentiment. Momentum measures change from the previous reading.</p>
    <h2>Tracked products</h2>
    ${items ? `<ul>${items}</ul>` : "<p>No active products are stored.</p>"}
    <p><a href="/products">All products</a></p>
  </main>`;
  const mainHtml = `<div class="crawl-copy">${semantic}</div>${renderHomeAppShell(products)}`;
  return {
    title: "M365 Barometer",
    description: SITE_DESCRIPTION,
    canonicalPath: "/",
    mainHtml,
    markdown: semanticHtmlToMarkdown(semantic),
    jsonLd: graph(catalogDataset(products, canonicalUrl("/"))),
  };
}

export function buildProductsPage(products: ProductSummary[]): PublicPage {
  const items = products.map((product) => `<li>${renderProductSummary(product)}</li>`).join("");
  const semantic = `<main>
    <h1>Microsoft 365 Products</h1>
    <p>Every active product receives an automated Last30Days reading once per week.</p>
    ${items ? `<ul>${items}</ul>` : "<p>No active products are stored.</p>"}
  </main>`;
  const mainHtml = `<div class="crawl-copy">${semantic}</div>${renderProductsAppShell(products)}`;
  return {
    title: "Microsoft 365 Products | M365 Barometer",
    description: "Every active product receives an automated Last30Days reading once per week.",
    canonicalPath: "/products",
    mainHtml,
    markdown: semanticHtmlToMarkdown(semantic),
    jsonLd: graph(catalogDataset(products, canonicalUrl("/products"))),
  };
}

const MESSAGE_CENTER_URL = "https://mc.merill.net/messages-index.json";
const ROADMAP_URL = "https://www.microsoft.com/releasecommunications/api/v1/m365";
const WIKIMEDIA_API_URL = "https://wikimedia.org/api/rest_v1/";
const HACKER_NEWS_SEARCH_URL = "https://hn.algolia.com/api/v1/search";

type DocSection = {
  heading: string;
  paragraphs: string[];
  items?: string[];
  after?: string[];
};

export function buildMethodologyPage(): PublicPage {
  const midpoint = SENTIMENT_SCORE_MIDPOINT;
  return buildDocPage({
    heading: "Methodology",
    title: "Methodology | M365 Barometer",
    description: "How M365 Barometer computes its 0-100 sentiment score, temperature, confidence, and supply and demand estimates.",
    canonicalPath: "/methodology",
    eyebrow: "How the readings work",
    ledeHtml: "M365 Barometer publishes two readings for each active product. The barometer score is a 0–100 sentiment score. Supply and demand figures are estimates.",
    sections: [
      {
        heading: "Sources",
        paragraphs: [
          "Weekly supply and demand counts use the last completed ISO week. The Worker collects Message Center, the Microsoft 365 Roadmap, Wikipedia pageviews, and Hacker News. X, YouTube, and Tech Community counts are submitted as weekly figures.",
        ],
        items: [
          `Message Center, via ${link(MESSAGE_CENTER_URL, "mc.merill.net")}. Matching messages in the week are a supply count.`,
          `${link(ROADMAP_URL, "Microsoft 365 Roadmap feed")}. Matching roadmap items in the week are a supply count.`,
          `Wikipedia pageviews from the ${link(WIKIMEDIA_API_URL, "Wikimedia pageviews API")}, summed for the product's English Wikipedia article. This is a demand count. Products with no dedicated article are skipped. When the article is broader than the product, the count is stored as an estimate.`,
          `Hacker News stories from the ${link(HACKER_NEWS_SEARCH_URL, "Hacker News search API")}. This is a demand count. When the search reports that the hit count is not exhaustive, the count is stored as an estimate.`,
          "X post counts. These are a demand signal, submitted as a weekly count. This Worker does not fetch X itself.",
          "YouTube and web evidence from the weekly sentiment searches. A YouTube count submitted on its own is a supply signal.",
          "Tech Community counts can be submitted as supply or demand.",
          "Reddit only as evidence from public search results in the weekly sentiment reading. Reddit is not a supply or demand count.",
        ],
        after: [
          "A Message Center or roadmap item matches a product when its service is one of that product's configured services, or when its title contains one of that product's phrases.",
          "The sentiment reading is built from evidence submitted after a weekly search. That search plan includes Reddit, YouTube, Hacker News, GitHub, and the web. Searches aimed at positive signals use Reddit, YouTube, and the web. YouTube and web evidence in the reading comes from those searches. The search plan carries source weights for collection. Those weights are not applied to the score.",
        ],
      },
      {
        heading: "Barometer score",
        paragraphs: [
          `Classified evidence is positive, neutral, or negative. The score is ${midpoint} when nothing was classified. Otherwise it starts at ${midpoint}, adds ${midpoint} times the share of items that are positive, and subtracts ${midpoint} times the share of items that are negative. The result is rounded to the nearest integer and kept inside 0–100. Neutral items stay in the share and do not push the score. Every classified item counts equally.`,
          `A reading is stored only when at least ${MIN_CLASSIFIED_EVIDENCE} evidence items were classified.`,
          "Momentum is this score minus the product's previous stored score. With no previous score, momentum is 0.",
        ],
      },
      {
        heading: "Temperature",
        paragraphs: [
          "The temperature names are Hot, Warming, Stable, Cooling, and Cold. The score is applied before momentum.",
          `Hot when the score is ${TEMPERATURE_HOT_AT} or higher, including when momentum is negative. Cold when the score is ${TEMPERATURE_COLD_AT} or lower, including when momentum is positive. Otherwise Warming when momentum is ${TEMPERATURE_WARMING_AT} or higher. Otherwise Cooling when momentum is ${TEMPERATURE_COOLING_AT} or lower. Otherwise Stable.`,
        ],
      },
      {
        heading: "Confidence",
        paragraphs: [
          "The sentiment confidence names are Very High, High, Medium, and Low. They use the number of classified items and the number of source categories with at least one item.",
          `Very High: at least ${CONFIDENCE_VERY_HIGH_ITEMS} classified items and at least ${CONFIDENCE_VERY_HIGH_CATEGORIES} categories. High: at least ${CONFIDENCE_HIGH_ITEMS} classified items and at least ${CONFIDENCE_HIGH_CATEGORIES} categories. Medium: at least ${CONFIDENCE_MEDIUM_ITEMS} classified items and at least ${CONFIDENCE_MEDIUM_CATEGORIES} categories. Low: below that.`,
          `When ${CONFIDENCE_FAILURES_BEFORE_DROP} or more configured sources have status failed, confidence drops one step. Low stays Low.`,
          "The source categories are reddit, x, blogs, forums, youtube, and other. Web evidence is counted as blogs. Hacker News evidence is counted as forums.",
        ],
      },
      {
        heading: "Discussion volume",
        paragraphs: [
          `Discussion volume names the classified item count. The names are Very High, High, Medium, and Low. Very High at ${VOLUME_VERY_HIGH_AT} or more, High at ${VOLUME_HIGH_AT} or more, Medium at ${VOLUME_MEDIUM_AT} or more, and Low below that.`,
        ],
      },
      {
        heading: "Supply and demand",
        paragraphs: [
          "Supply and demand figures are estimates. They are not Microsoft usage, license, or revenue numbers.",
          `Each usable source adds its weekly value into a supply total or a demand total. The index compares the scored week's total with that product's own weekly totals over the trailing ${HISTORY_WEEKS} weeks, including the scored week (HISTORY_WEEKS). The scored week is the latest completed ISO week that has usable counts. If the only usable counts fall in the current, unfinished week, that week is used and the index is marked as an estimate.`,
          "The index is a percentile of the scored week's total in that history. Weeks below the current total count in full, weeks equal to it count half, and the index is that share of the weeks multiplied by 100 and rounded to the nearest integer.",
          "The gap is the demand index minus the supply index when both exist.",
          `Demand momentum is the scored week's demand index minus the average of the demand percentiles from up to the previous ${DEMAND_MOMENTUM_WEEKS} weeks. It is left empty when this week has no demand index or there is no earlier week.`,
        ],
      },
      {
        heading: "When a new source counts",
        paragraphs: [
          `A new source counts only after ${MIN_SOURCE_WEEKS} weeks of history for that product (MIN_SOURCE_WEEKS). A week counts when the stored value is a number. Until then the source is pending. Pending sources are left out of the supply index, the demand index, momentum, the gap, and the source count used for confidence.`,
        ],
      },
      {
        heading: "Supply and demand labels",
        paragraphs: [
          "The supply and demand label names are Hot, Neutral, and Cold.",
          `A label is assigned only when a demand index exists, demand momentum exists, the scored week has at least ${MIN_SOURCES_FOR_LABEL} usable sources (MIN_SOURCES_FOR_LABEL), and that demand index is built from at least ${MIN_WEEKS_FOR_FULL_INDEX} weeks (MIN_WEEKS_FOR_FULL_INDEX).`,
          `Hot when the demand index is ${LABEL_HOT_AT} or higher and momentum is above 0. Cold when the demand index is ${LABEL_COLD_AT} or lower and momentum is below 0. Neutral otherwise. When those conditions are not met, there is no label.`,
        ],
      },
      {
        heading: "Supply and demand confidence",
        paragraphs: [
          "The supply and demand confidence names are High, Medium, Low, and not enough data. They follow the number of distinct usable sources in the scored week.",
          `not enough data when that number is 0. Low when it is at least 1 and below ${MIN_SOURCES_FOR_LABEL}. Medium when it is at least ${MIN_SOURCES_FOR_LABEL} and below ${HIGH_CONFIDENCE_SOURCES}. High when it is ${HIGH_CONFIDENCE_SOURCES} or more.`,
        ],
      },
      {
        heading: "Estimates",
        paragraphs: [
          "Supply and demand figures are estimates.",
          `An index is marked as an estimate when the scored week is still in progress, when fewer than ${MIN_WEEKS_FOR_FULL_INDEX} weeks of that product's history are stored (MIN_WEEKS_FOR_FULL_INDEX), or when a count in the scored week was stored as an estimate. Wikipedia counts are estimates when the article is broader than the product. Hacker News counts are estimates when the hit count is not exhaustive. Submitted counts are estimates when they are flagged as estimated.`,
          "The gap and the label are marked as estimates when they are shown and an index they use is an estimate.",
        ],
      },
    ],
  });
}

export function buildAboutPage(): PublicPage {
  return buildDocPage({
    heading: "About",
    title: "About | M365 Barometer",
    description: "An independent community radar of which Microsoft 365 products are gaining or losing traction. Not affiliated with Microsoft.",
    canonicalPath: "/about",
    eyebrow: "The project",
    ledeHtml: "M365 Barometer is an independent community radar of which Microsoft 365 products are gaining or losing traction.",
    sections: [
      {
        heading: "Independence",
        paragraphs: [
          "It is not affiliated with Microsoft. The site is published by M365 Barometer, an independent organization.",
          `How the readings are computed is described on the ${link("/methodology", "methodology")} page.`,
        ],
      },
      {
        heading: "Data",
        paragraphs: [
          `Public data on this site is licensed under ${link(DATASET_LICENSE, "CC BY 4.0")}.`,
        ],
      },
    ],
  });
}

function buildDocPage(options: {
  heading: string;
  title: string;
  description: string;
  canonicalPath: string;
  eyebrow: string;
  ledeHtml: string;
  sections: DocSection[];
}): PublicPage {
  const sections = options.sections.map((section) => {
    const paragraphs = section.paragraphs.map((paragraph) => `<p>${paragraph}</p>`).join("");
    const items = section.items?.length
      ? `<ul>${section.items.map((item) => `<li>${item}</li>`).join("")}</ul>`
      : "";
    const after = (section.after ?? []).map((paragraph) => `<p>${paragraph}</p>`).join("");
    return `<h2>${escapeHtml(section.heading)}</h2>${paragraphs}${items}${after}`;
  }).join("");
  const semantic = `<main>
    <h1>${escapeHtml(options.heading)}</h1>
    <p>${options.ledeHtml}</p>
    ${sections}
  </main>`;
  const visual = `<div class="app-shell">${renderSiteHeader("none")}<main class="page-shell"><div class="page-title"><p class="eyebrow">${escapeHtml(options.eyebrow)}</p><h1>${escapeHtml(options.heading)}</h1><p>${options.ledeHtml}</p></div><div class="prose">${sections}</div></main></div>`;
  return {
    title: options.title,
    description: options.description,
    canonicalPath: options.canonicalPath,
    mainHtml: `<div class="crawl-copy">${semantic}</div>${visual}`,
    markdown: semanticHtmlToMarkdown(semantic),
    jsonLd: documentGraph(options.title, options.description, canonicalUrl(options.canonicalPath)),
  };
}

function link(href: string, text: string): string {
  return `<a href="${escapeHtml(href)}">${escapeHtml(text)}</a>`;
}

export function buildProductPage(
  product: ProductSummary,
  mentions: PublicMention[],
  history: ShellHistoryPoint[] = [],
): PublicPage {
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
    supplyDemandSection(product.supplyDemand),
    mentions.length ? mentionSection(mentions) : "",
  ].join("");
  const semantic = `<main>
    <p>Microsoft 365 community barometer</p>
    <h1>${escapeHtml(product.name)}</h1>
    ${product.description ? `<p>${escapeHtml(product.description)}</p>` : ""}
    <p>Last analyzed: ${escapeHtml(product.lastAnalyzedAt ?? "Not analyzed")}</p>
    ${sections}
    <p><a href="/products">All products</a></p>
  </main>`;
  const mainHtml = `<div class="crawl-copy">${semantic}</div>${renderProductAppShell(product, mentions, history)}`;
  return {
    title: `${product.name} | M365 Barometer`,
    description,
    canonicalPath: path,
    mainHtml,
    markdown: semanticHtmlToMarkdown(semantic),
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

  // Every insertion uses a replacement function: page data comes from stored
  // AI/bot text, and a string replacement would interpret $$, $&, $` and $'
  // sequences in it as replacement patterns, splicing shell fragments into
  // the document. Function returns are inserted literally.
  if (!/<title>[\s\S]*?<\/title>/i.test(shell)) throw new Error("App shell is missing <title>");
  let html = shell.replace(/<title>[\s\S]*?<\/title>/i, () => `<title>${title}</title>`);
  if (/<meta\s+name=["']description["'][^>]*>/i.test(html)) {
    html = html.replace(
      /<meta\s+name=["']description["'][^>]*>/i,
      () => `<meta name="description" content="${description}" />`,
    );
  } else {
    html = html.replace("</head>", () => `<meta name="description" content="${description}" /></head>`);
  }
  if (!html.includes("</head>")) throw new Error("App shell is missing </head>");
  html = html.replace("</head>", () => `${head}</head>`);
  if (!/<div id="root">[\s\S]*?<\/div>/.test(html)) throw new Error("App shell is missing #root");
  html = html.replace(/<div id="root">[\s\S]*?<\/div>/, () => `<div id="root">${page.mainHtml}</div>`);
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
  <link rel="icon" type="image/svg+xml" href="/assets/favicon.svg" />
</head>
<body>
  <main>
    <h1>Page not found</h1>
    <p>That path is not on M365 Barometer.</p>
    <p><a href="/">Back to the dashboard</a></p>
  </main>
  <footer>
    <p>${INDEPENDENT_DISCLAIMER}</p>
    <p>Data licensed under <a href="${DATASET_LICENSE}" rel="license">CC BY 4.0</a>.</p>
  </footer>
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

function supplyDemandSection(score: SupplyDemandScore | undefined): string {
  if (!score || (score.status === "not_enough_data" && !score.supply && !score.demand)) {
    return "<h2>Supply vs demand</h2><p>Not enough data</p>";
  }
  const lines = [
    score.week ? `<p>Week of ${escapeHtml(score.week)}</p>` : "",
    indexLine("Supply", score.supply),
    indexLine("Demand", score.demand),
    `<p>Supply vs demand: ${score.gap === null ? "Not enough data" : formatGap(score.gap, score.estimated)}</p>`,
    `<p>${score.label ? `${escapeHtml(score.label)}${score.estimated ? " (estimate)" : ""}` : "Not enough data"}</p>`,
    `<p>Confidence: ${escapeHtml(score.confidence)}</p>`,
  ];
  return `<h2>Supply vs demand</h2>${lines.join("")}`;
}

function indexLine(label: string, index: SupplyDemandScore["supply"]): string {
  if (!index) return `<p>${label}: Not enough data</p>`;
  const estimate = index.estimated ? " (estimate)" : "";
  return `<p>${label}: ${index.index}${estimate}</p>`;
}

function formatGap(gap: number, estimated: boolean): string {
  const text = gap > 0 ? `+${gap}` : String(gap);
  return estimated ? `${text} (estimate)` : text;
}

function supplyDemandProperties(score: SupplyDemandScore | undefined): Array<ReturnType<typeof property>> {
  if (!score || score.status === "not_enough_data") return [];
  const measured = [];
  if (score.supply) measured.push(property("supplyIndex", score.supply.index));
  if (score.demand) measured.push(property("demandIndex", score.demand.index));
  if (score.gap !== null) measured.push(property("supplyVsDemand", score.gap));
  if (score.label) measured.push(property("supplyDemandLabel", score.label));
  return measured;
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
    license: DATASET_LICENSE,
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
    license: DATASET_LICENSE,
    isAccessibleForFree: true,
    creator: publisher(),
  };
  if (product.description) dataset.description = product.description;
  if (product.snapshot?.summary) dataset.description = product.snapshot.summary;
  if (modified) dataset.dateModified = modified;
  const measured = product.snapshot
    ? [
      property("barometerScore", product.snapshot.barometerScore),
      property("temperature", product.snapshot.temperature),
      property("momentum", product.snapshot.momentum),
      property("confidence", product.snapshot.confidence),
      property("discussionVolume", product.snapshot.discussionVolume),
    ]
    : [];
  measured.push(...supplyDemandProperties(product.supplyDemand));
  if (measured.length) dataset.variableMeasured = measured;
  return dataset;
}

function documentGraph(name: string, description: string, url: string) {
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
      {
        "@type": "WebPage",
        name,
        description,
        url,
        license: DATASET_LICENSE,
        isPartOf: { "@id": `${CANONICAL_ORIGIN}/#website` },
        publisher: publisher(),
      },
    ],
  };
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
