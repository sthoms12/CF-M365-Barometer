import type { ProductSummary, SupplyDemandScore } from "../shared/contracts";
import { momentumHtml, productCardHtml, renderSiteHeader } from "./home-shell";

export type ShellMention = {
  sourceType: string;
  sourceTitle: string;
  sourceUrl: string | null;
  sentiment: string;
  excerpt: string;
};

export type ShellHistoryPoint = { analyzedAt: string; barometerScore: number };

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function jsonScript(id: string, data: unknown): string {
  return `<script type="application/json" id="${id}">${JSON.stringify(data).replaceAll("<", "\\u003c")}</script>`;
}

function formatDate(value: string | null): string {
  if (!value) return "Not analyzed";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
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

function safeMentions(mentions: ShellMention[]): ShellMention[] {
  return mentions.map((mention) => ({ ...mention, sourceUrl: safeHttpUrl(mention.sourceUrl) }));
}

function scoreHtml(value: number, size: "normal" | "large"): string {
  const tone = value >= 65 ? "positive" : value <= 35 ? "negative" : "neutral";
  return `<div class="score score-${size} score-${tone}" aria-label="Barometer score ${value}"><span>${value}</span><small>/100</small></div>`;
}

function withEstimate(text: string, estimated: boolean): string {
  return estimated ? `${text} (estimate)` : text;
}

function supplyDemandHtml(score: SupplyDemandScore | undefined): string {
  if (!score || (score.status === "not_enough_data" && !score.supply && !score.demand)) {
    return `<section class="detail-band"><h2>Supply vs demand</h2><p>Not enough data</p></section>`;
  }
  const gap = score.gap === null ? "Not enough data" : withEstimate(score.gap > 0 ? `+${score.gap}` : String(score.gap), score.estimated);
  return `<section class="detail-band"><h2>Supply vs demand</h2>${score.week ? `<p>Week of ${escapeHtml(score.week)}</p>` : ""}<p>Supply: ${score.supply ? escapeHtml(withEstimate(String(score.supply.index), score.supply.estimated)) : "Not enough data"}</p><p>Demand: ${score.demand ? escapeHtml(withEstimate(String(score.demand.index), score.demand.estimated)) : "Not enough data"}</p><p>Supply vs demand: ${escapeHtml(gap)}</p><p>${score.label ? escapeHtml(withEstimate(score.label, score.estimated)) : "Not enough data"}</p><p>Confidence: ${escapeHtml(score.confidence)}</p></section>`;
}

const clockIcon = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;

function emptyStateHtml(message: string): string {
  return `<div class="empty-state">${clockIcon}<p>${escapeHtml(message)}</p></div>`;
}

function trendHtml(history: ShellHistoryPoint[]): string {
  if (history.length < 2) {
    return emptyStateHtml("Trend data appears after the second automated analysis.");
  }
  const width = 720;
  const height = 220;
  const points = history.map((point, index) => {
    const x = 20 + (index / (history.length - 1)) * (width - 40);
    const y = height - 20 - (point.barometerScore / 100) * (height - 40);
    return `${x},${y}`;
  }).join(" ");
  const circles = history.map((point, index) => {
    const [x, y] = points.split(" ")[index].split(",");
    return `<circle cx="${x}" cy="${y}" r="4" class="chart-point"></circle>`;
  }).join("");
  const grid = [25, 50, 75].map((value) => {
    const y = height - 20 - (value / 100) * (height - 40);
    return `<line x1="20" x2="${width - 20}" y1="${y}" y2="${y}" class="chart-grid"></line>`;
  }).join("");
  return `<div class="chart-wrap"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Historical barometer score">${grid}<polyline points="${points}" class="chart-line"></polyline>${circles}</svg><div class="chart-labels"><span>${escapeHtml(formatDate(history[0].analyzedAt))}</span><span>${escapeHtml(formatDate(history[history.length - 1].analyzedAt))}</span></div></div>`;
}

function mentionHtml(mentions: ShellMention[]): string {
  const articles = mentions.map((mention) => {
    const href = mention.sourceUrl;
    const link = href
      ? `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer" aria-label="Open source"></a>`
      : "";
    return `<article class="mention"><div class="mention-head"><span class="sentiment sentiment-${escapeHtml(mention.sentiment)}">${escapeHtml(mention.sentiment)}</span><span>${escapeHtml(mention.sourceType)}</span>${link}</div><h3>${escapeHtml(mention.sourceTitle)}</h3><p>${escapeHtml(mention.excerpt)}</p></article>`;
  }).join("");
  return `<div class="mention-list">${articles}</div>`;
}

export function renderProductsAppShell(products: ProductSummary[]): string {
  const cards = products.map(productCardHtml).join("");
  const main = `<main class="page-shell"><div class="page-title"><p class="eyebrow">Tracked portfolio</p><h1>Microsoft 365 Products</h1><p>Every active product receives an automated Last30Days reading once per week.</p></div><div class="product-grid wide">${cards}</div></main>`;
  return `<div class="app-shell">${renderSiteHeader("products")}${main}${jsonScript("products-bootstrap", products)}</div>`;
}

export function renderProductAppShell(
  product: ProductSummary,
  mentions: ShellMention[],
  history: ShellHistoryPoint[],
): string {
  const safe = safeMentions(mentions);
  const snapshot = product.snapshot;
  const score = snapshot ? scoreHtml(snapshot.barometerScore, "large") : `<span class="no-score">Pending first reading</span>`;
  const hero = `<section class="product-hero"><div><p class="eyebrow">Microsoft 365 community barometer</p><h1>${escapeHtml(product.name)}</h1><p>${escapeHtml(product.description ?? "")}</p><span class="last-analyzed">Last analyzed: ${escapeHtml(formatDate(product.lastAnalyzedAt))}${product.isStale ? " · stale" : ""}</span></div>${score}</section>`;
  const reading = snapshot
    ? `<section class="metric-strip"><div><span>Temperature</span><span class="temperature temperature-${snapshot.temperature.toLowerCase()}">${escapeHtml(snapshot.temperature)}</span></div><div><span>Momentum</span>${momentumHtml(snapshot.momentum)}</div><div><span>Confidence</span><strong>${escapeHtml(snapshot.confidence)}</strong></div><div><span>Discussion volume</span><strong>${escapeHtml(snapshot.discussionVolume)}</strong></div></section><section class="detail-band summary-band"><div><p class="eyebrow">Current reading</p><h2>What the community signal says</h2></div><p class="summary-copy">${escapeHtml(snapshot.summary)}</p></section><section class="signal-columns"><div><h2>Positive signals</h2><ul>${snapshot.positiveSignals.map((signal) => `<li>${escapeHtml(signal)}</li>`).join("")}</ul></div><div><h2>Negative signals</h2><ul>${snapshot.negativeSignals.map((signal) => `<li>${escapeHtml(signal)}</li>`).join("")}</ul></div></section><section class="detail-band"><h2>Historical trend</h2>${trendHtml(history)}</section><section class="detail-band"><h2>Source breakdown</h2><div class="source-bars">${Object.entries(snapshot.sourceBreakdown).map(([source, count]) => `<div><span>${escapeHtml(source)}</span><div><i style="width:${Math.min(100, count * 5)}%"></i></div><strong>${count}</strong></div>`).join("")}</div></section><section class="detail-band"><h2>Sample public mentions</h2>${mentionHtml(safe)}</section>`
    : emptyStateHtml("The first automated Last30Days analysis is scheduled. No manual import is required.");
  const main = `<main class="page-shell">${hero}${supplyDemandHtml(product.supplyDemand)}${reading}</main>`;
  return `<div class="app-shell">${renderSiteHeader("products")}${main}${jsonScript("product-bootstrap", { product, mentions: safe, history })}</div>`;
}
