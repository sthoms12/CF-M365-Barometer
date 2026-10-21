import type { ProductSummary } from "../shared/contracts";
import { buildHomeSections, homeSectionCopy, homeSectionOrder } from "../shared/home";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function scoreTone(value: number): string {
  if (value >= 65) return "positive";
  if (value <= 35) return "negative";
  return "neutral";
}

function icon(size: number, path: string): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
}

export function momentumHtml(value: number): string {
  if (value === 0) return `<span class="momentum momentum-flat">0</span>`;
  const up = value > 0;
  const glyph = up
    ? icon(15, `<path d="M7 7h10v10"/><path d="M7 17 17 7"/>`)
    : icon(15, `<path d="m7 7 10 10"/><path d="M17 7v10H7"/>`);
  return `<span class="momentum ${up ? "momentum-up" : "momentum-down"}">${glyph}${up ? "+" : ""}${value}</span>`;
}

export function renderSiteHeader(active: "home" | "products"): string {
  const brandClass = active === "home" ? "brand active" : "brand";
  const dashboard = active === "home" ? ` class="active" aria-current="page"` : "";
  const products = active === "products" ? ` class="active" aria-current="page"` : "";
  return `<header class="site-header"><a class="${brandClass}" href="/"><span class="brand-mark">${icon(20, `<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>`)}</span><span>M365 Barometer</span></a><nav aria-label="Primary navigation"><a href="/"${dashboard}>${icon(16, `<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>`)} Dashboard</a><a href="/products"${products}>${icon(16, `<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>`)} Products</a></nav></header>`;
}

export function productCardHtml(product: ProductSummary): string {
  const href = `/products/${encodeURIComponent(product.slug)}`;
  const snapshot = product.snapshot;
  const score = snapshot
    ? `<div class="score score-normal score-${scoreTone(snapshot.barometerScore)}" aria-label="Barometer score ${snapshot.barometerScore}"><span>${snapshot.barometerScore}</span><small>/100</small></div>`
    : `<span class="no-score">Pending</span>`;
  const meta = snapshot
    ? `<span class="temperature temperature-${snapshot.temperature.toLowerCase()}">${escapeHtml(snapshot.temperature)}</span>${momentumHtml(snapshot.momentum)}<span>${escapeHtml(snapshot.discussionVolume)} volume</span>`
    : `<span>Awaiting first automated analysis</span>`;
  const stale = product.isStale
    ? `<span class="stale">${icon(13, `<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>`)} Stale</span>`
    : "";
  return `<a class="product-card" href="${href}"><div class="product-card-main"><div><h3>${escapeHtml(product.name)}</h3><p>${escapeHtml(product.description ?? "")}</p></div>${score}</div><div class="product-card-meta">${meta}${stale}</div></a>`;
}

export function renderHomeAppShell(products: ProductSummary[]): string {
  const sections = buildHomeSections(products);
  const blocks = homeSectionOrder.map((key) => {
    const copy = homeSectionCopy[key];
    const items = sections[key];
    const cards = items.map(productCardHtml).join("");
    const empty = items.length === 0
      ? `<div class="empty-state">${icon(24, `<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>`)}<p>This section will populate after scheduled readings establish a trend.</p></div>`
      : "";
    return `<section class="product-section"><div class="section-heading"><div><h2>${escapeHtml(copy.title)}</h2><p>${escapeHtml(copy.description)}</p></div></div><div class="product-grid">${cards}</div>${empty}</section>`;
  }).join("");
  const header = renderSiteHeader("home");
  const main = `<main><section class="dashboard-intro"><div><p class="eyebrow">30-day community signal</p><h1>Microsoft 365 sentiment, measured in public.</h1><p>Automated weekly readings from recent community discussions, scored consistently over time.</p></div><div class="method-note"><strong>How to read it</strong><span>Score measures sentiment. Momentum measures change from the previous reading.</span></div></section><div class="dashboard-sections">${blocks}</div></main>`;
  const json = JSON.stringify({ sections }).replaceAll("<", "\\u003c");
  return `<div class="app-shell">${header}${main}<script type="application/json" id="home-bootstrap">${json}</script></div>`;
}
