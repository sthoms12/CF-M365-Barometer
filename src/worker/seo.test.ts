import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { MicrosoftInvestment, ProductSummary } from "../shared/contracts";
import { ANNOUNCEMENT_WINDOW_DAYS, ROADMAP_STATUS_ORDER } from "../shared/investment";
import { MIN_CLASSIFIED_EVIDENCE } from "./analysis";
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
import {
  CANONICAL_ORIGIN,
  DATASET_LICENSE,
  INDEPENDENT_DISCLAIMER,
  applySeoToShell,
  buildAboutPage,
  buildHomePage,
  buildMethodologyPage,
  buildProductPage,
  buildProductsPage,
  renderNotFoundHtml,
  renderRobotsTxt,
  renderSitemap,
  sitemapEntries,
  toLastMod,
} from "./seo";

const shell = readFileSync(new URL("../../index.html", import.meta.url), "utf8");

function product(overrides: Partial<ProductSummary> = {}): ProductSummary {
  return {
    id: "prod-copilot",
    slug: "microsoft-365-copilot",
    name: "Microsoft 365 Copilot",
    description: "Copilot across Office apps.",
    isActive: true,
    nextAnalysisAt: null,
    lastAnalyzedAt: null,
    snapshot: null,
    isStale: true,
    ...overrides,
  };
}

const reading = product({
  lastAnalyzedAt: "2026-06-07 15:04:00",
  isStale: true,
  snapshot: {
    id: "snap-1",
    analyzedAt: "2026-06-07 15:04:00",
    barometerScore: 72,
    temperature: "Warming",
    momentum: 4,
    confidence: "Low",
    discussionVolume: "Low",
    summary: "Community sentiment is cautiously positive.",
    positiveSignals: ["Useful drafts"],
    negativeSignals: ["Hallucinations"],
    sourceBreakdown: { reddit: 4, x: 1, blogs: 0, forums: 0, youtube: 1, other: 0 },
    sourceStatus: { reddit: "available" },
  },
});

describe("robots.txt", () => {
  const body = renderRobotsTxt();

  it("allows all crawlers and names the AI crawlers", () => {
    expect(body).toContain("User-agent: *\nAllow: /");
    for (const agent of ["GPTBot", "ClaudeBot", "PerplexityBot", "Google-Extended", "CCBot", "Bingbot"]) {
      expect(body).toContain(`User-agent: ${agent}\nAllow: /`);
    }
    expect(body).not.toContain("Disallow");
  });

  it("publishes the www sitemap", () => {
    expect(body).toContain("Sitemap: https://www.m365-barometer.com/sitemap.xml");
  });
});

describe("sitemap.xml", () => {
  it("lists the home page, products page, and each public slug", () => {
    const xml = renderSitemap(sitemapEntries([
      { slug: "teams-phone", lastModified: "2026-06-01 00:00:00" },
      { slug: "microsoft-365-copilot", lastModified: null },
    ]));
    expect(xml).toContain("<loc>https://www.m365-barometer.com/</loc>");
    expect(xml).toContain("<loc>https://www.m365-barometer.com/products</loc>");
    expect(xml).toContain("<loc>https://www.m365-barometer.com/methodology</loc>");
    expect(xml).toContain("<loc>https://www.m365-barometer.com/about</loc>");
    expect(xml).toContain("<loc>https://www.m365-barometer.com/products/microsoft-365-copilot</loc>");
    expect(xml).toContain("<loc>https://www.m365-barometer.com/products/teams-phone</loc>");
    expect(xml).toContain("<lastmod>2026-06-01T00:00:00.000Z</lastmod>");
    expect(xml).not.toContain("microsoft-loop");
  });

  it("escapes XML in locations and omits unknown dates", () => {
    const xml = renderSitemap([{ path: "/products/a&b", lastModified: "not-a-date" }]);
    expect(xml).toContain("<loc>https://www.m365-barometer.com/products/a&amp;b</loc>");
    expect(xml).not.toContain("<lastmod>");
    expect(toLastMod("not-a-date")).toBeNull();
  });
});

describe("public HTML", () => {
  it("injects canonical, social tags, JSON-LD, and stored product copy into the shell", () => {
    const html = applySeoToShell(shell, buildHomePage([reading, product({ slug: "teams-phone", name: "Teams Phone", snapshot: null })]));
    expect(html).toContain("<title>M365 Barometer</title>");
    expect(html).toContain(`<link rel="canonical" href="${CANONICAL_ORIGIN}/" />`);
    expect(html).toContain(`<meta property="og:url" content="${CANONICAL_ORIGIN}/" />`);
    expect(html).toContain(`<meta name="twitter:card" content="summary" />`);
    expect(html).toContain(`"@type":"WebSite"`);
    expect(html).toContain(`"@type":"Dataset"`);
    expect(html).toContain("Microsoft 365 Copilot");
    expect(html).toContain("Teams Phone");
    expect(html).toContain("Barometer score: 72/100");
    expect(html).toContain("Community sentiment is cautiously positive.");
    expect(html).toContain("No automated reading is stored for this product yet.");
    expect(html).toContain(INDEPENDENT_DISCLAIMER);
    expect(html).toContain(`src="/src/client/main.tsx"`);
    const teamsItem = html.slice(html.indexOf('href="/products/teams-phone"'), html.indexOf("</ul>"));
    expect(teamsItem).toContain("No automated reading is stored for this product yet.");
    expect(teamsItem).not.toContain("Barometer score:");
    const data = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1] ?? "{}") as {
      "@graph": Array<{ "@type": string; hasPart?: Array<{ name: string; variableMeasured?: unknown }> }>;
    };
    const catalog = data["@graph"].find((node) => node.hasPart);
    const teams = catalog?.hasPart?.find((part) => part.name === "Teams Phone");
    const copilot = catalog?.hasPart?.find((part) => part.name === "Microsoft 365 Copilot");
    expect(html).toContain('id="home-bootstrap"');
    expect(html).toContain('class="product-section"');
    const bootstrap = JSON.parse(html.match(/id="home-bootstrap">([\s\S]*?)<\/script>/)?.[1] ?? "{}") as {
      sections: { heatingUp: Array<{ name: string }>; coolingOff: unknown[] };
    };
    expect(bootstrap.sections.heatingUp.map((item) => item.name)).toEqual(["Microsoft 365 Copilot"]);
    expect(bootstrap.sections.coolingOff).toEqual([]);
    expect(teams?.variableMeasured).toBeUndefined();
    expect(copilot?.variableMeasured).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "barometerScore", value: 72 }),
    ]));
  });

  it("renders a product reading from stored fields only", () => {
    const html = applySeoToShell(shell, buildProductPage(reading, [{
      sourceType: "reddit",
      sourceTitle: "Copilot thread",
      sourceUrl: "https://example.com/thread",
      sentiment: "positive",
      excerpt: "Helpful for drafts.",
    }]));
    expect(html).toContain("<title>Microsoft 365 Copilot | M365 Barometer</title>");
    expect(html).toContain(`href="${CANONICAL_ORIGIN}/products/microsoft-365-copilot"`);
    expect(html).toContain("Useful drafts");
    expect(html).toContain("Hallucinations");
    expect(html).toContain("reddit: 4");
    expect(html).toContain("Helpful for drafts.");
    expect(html).toContain("https://example.com/thread");
    const json = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
    const data = JSON.parse(json ?? "{}") as { "@graph": Array<Record<string, unknown>> };
    const dataset = data["@graph"].find((node) => node["@type"] === "Dataset" && node.name === "Microsoft 365 Copilot");
    expect(dataset?.license).toBe("https://creativecommons.org/licenses/by/4.0/");
    expect(dataset?.variableMeasured).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "barometerScore", value: 72 }),
    ]));
  });

  it("does not invent a score when D1 has no snapshot", () => {
    const html = applySeoToShell(shell, buildProductPage(product(), []));
    expect(html).toContain("No automated reading is stored for this product yet.");
    expect(html).toContain("Supply vs demand");
    expect(html).toContain("Not enough data");
    expect(html).toContain("Microsoft investment");
    expect(html).toContain("Counts of Microsoft announcements, an indicator of Microsoft investment.");
    expect(html).toContain("Last 30 days");
    expect(html).toContain("As of not available");
    expect(html).toContain("Roadmap: not available");
    expect(html).toContain("Message Center: not available");
    expect(html).not.toContain("Roadmap: 0");
    expect(html).not.toContain("Message Center: 0");
    expect(html).not.toContain("Barometer score:");
    expect(html).not.toContain("Hot");
    expect(html).not.toContain("variableMeasured");
  });

  it("renders a supply versus demand score and marks estimates", () => {
    const html = applySeoToShell(shell, buildProductPage(product({
      supplyDemand: {
        week: "2026-10-05",
        supply: { index: 40, raw: 2, weeks: 4, estimated: false },
        demand: { index: 88, raw: 10, weeks: 4, estimated: true },
        gap: 48,
        momentum: 20,
        label: "Hot",
        confidence: "Medium",
        sources: 3,
        status: "ok",
        estimated: true,
        pendingSources: [],
      },
    }), []));
    expect(html).toContain("Week of 2026-10-05");
    expect(html).toContain("Supply: 40");
    expect(html).toContain("Demand: 88 (estimate)");
    expect(html).toContain("Supply vs demand: +48 (estimate)");
    expect(html).toContain("Hot (estimate)");
    expect(html).toContain("Confidence: Medium");
  });

  it("shows announcement counts beside the score and keeps a failed feed unavailable", () => {
    const collected: MicrosoftInvestment = {
      windowDays: 30,
      windowStart: "2026-09-14T15:00:00.000Z",
      windowEnd: "2026-10-14T15:00:00.000Z",
      asOf: "2026-10-14T15:00:00.000Z",
      messageCenter: { available: false },
      roadmap: {
        available: true,
        count: 4,
        byStatus: {
          "In development": 1,
          "Rolling out": 1,
          Launched: 1,
          Cancelled: 1,
        },
      },
    };
    const html = applySeoToShell(shell, buildProductPage(reading, [], []));
    const withCounts = applySeoToShell(shell, buildProductPage(product({
      ...reading,
      microsoftInvestment: collected,
    }), []));
    const home = applySeoToShell(shell, buildHomePage([product({
      ...reading,
      microsoftInvestment: collected,
    })]));

    expect(withCounts).toContain("Barometer score: 72/100");
    expect(withCounts).toContain("Microsoft investment");
    expect(withCounts).toContain("Counts of Microsoft announcements, an indicator of Microsoft investment.");
    expect(withCounts).toContain("Last 30 days (Sep 14, 2026 - Oct 14, 2026)");
    expect(withCounts).toContain("As of Oct 14, 2026");
    expect(withCounts).toContain("Roadmap: <strong>4</strong>");
    expect(withCounts).toContain("In development");
    expect(withCounts).toContain("Rolling out");
    expect(withCounts).toContain("Launched");
    expect(withCounts).toContain("Cancelled");
    expect(withCounts).toContain("Message Center: <strong>not available</strong>");
    expect(withCounts).not.toContain("Message Center: <strong>0</strong>");
    expect(withCounts).not.toContain("Message Center: 0");
    expect(home).toContain("investment-compact");
    expect(home).toContain("Barometer score: 72/100");
    expect(home).toContain("Roadmap: <strong>4</strong>");
    expect(html).toContain("As of not available");
  });

  it("escapes product text and drops unsafe mention URLs", () => {
    const html = applySeoToShell(shell, buildProductPage(product({
      name: `A & B <script>`,
      description: `Quotes "here"`,
    }), [{
      sourceType: "web",
      sourceTitle: "Bad",
      sourceUrl: "javascript:alert(1)",
      sentiment: "neutral",
      excerpt: "<b>excerpt</b>",
    }]));
    expect(html).toContain("A &amp; B &lt;script&gt;");
    expect(html).toContain("Quotes &quot;here&quot;");
    expect(html).toContain("&lt;b&gt;excerpt&lt;/b&gt;");
    expect(html).not.toContain("javascript:");
  });

  it("uses the products index title and canonical path", () => {
    const page = buildProductsPage([product()]);
    const html = applySeoToShell(shell, page);
    expect(html).toContain("<title>Microsoft 365 Products | M365 Barometer</title>");
    expect(html).toContain(`href="${CANONICAL_ORIGIN}/products"`);
  });

  it("inserts stored text containing $-patterns literally", () => {
    const html = applySeoToShell(shell, buildProductPage(product({
      snapshot: {
        ...reading.snapshot!,
        summary: "Prices $$ and $& deals $` today",
      },
    }), [{
      sourceType: "blogs",
      sourceTitle: "Costs $$ $& $`",
      sourceUrl: "https://example.com/post",
      sentiment: "positive",
      excerpt: "Excerpt $$ $&",
    }]));
    // escapeHtml leaves $ alone and turns & into &amp;; the sequences must
    // survive verbatim instead of being read as replace() patterns.
    expect(html).toContain("Prices $$ and $&amp; deals $` today");
    expect(html).toContain("Costs $$ $&amp; $`");
    // No shell fragment was spliced into the document by a $ pattern.
    expect(html.match(/<div id="root">/g)).toHaveLength(1);
    expect(html.match(/<title>/g)).toHaveLength(1);
    expect(html.match(/glass-portfolio/g)).toHaveLength(1);
    expect(html).not.toContain("$$</title>");
  });
});

describe("markdown mirrors", () => {
  it("derives the home mirror from the same stored product copy as the HTML", () => {
    const page = buildHomePage([reading, product({ slug: "teams-phone", name: "Teams Phone", snapshot: null })]);
    expect(page.markdown).toContain("# Microsoft 365 sentiment, measured in public.");
    expect(page.markdown).toContain("Automated weekly readings from recent community discussions, scored consistently over time.");
    expect(page.markdown).toContain("## Tracked products");
    expect(page.markdown).toContain("[Microsoft 365 Copilot](https://www.m365-barometer.com/products/microsoft-365-copilot)");
    expect(page.markdown).toContain("Barometer score: 72/100");
    expect(page.markdown).toContain("Community sentiment is cautiously positive.");
    expect(page.markdown).toContain("No automated reading is stored for this product yet.");
    expect(page.markdown).toContain("[All products](https://www.m365-barometer.com/products)");
    expect(page.markdown).not.toContain("<");
    expect(page.markdown).not.toMatch(/^ +\S/m);
  });

  it("derives the product mirror with reading, signals, sources, and mentions", () => {
    const page = buildProductPage(reading, [{
      sourceType: "reddit",
      sourceTitle: "Copilot thread",
      sourceUrl: "https://example.com/thread",
      sentiment: "positive",
      excerpt: "Helpful for drafts.",
    }]);
    expect(page.markdown).toContain("# Microsoft 365 Copilot");
    expect(page.markdown).toContain("Copilot across Office apps.");
    expect(page.markdown).toContain("## Current reading");
    expect(page.markdown).toContain("## Positive signals");
    expect(page.markdown).toContain("- Useful drafts");
    expect(page.markdown).toContain("## Negative signals");
    expect(page.markdown).toContain("- Hallucinations");
    expect(page.markdown).toContain("## Source breakdown");
    expect(page.markdown).toContain("- reddit: 4");
    expect(page.markdown).toContain("## Sample public mentions");
    expect(page.markdown).toContain("### Copilot thread");
    expect(page.markdown).toContain("Helpful for drafts.");
    expect(page.markdown).toContain("[Source](https://example.com/thread)");
    expect(page.markdown).not.toContain("<");
  });

  it("derives the products index mirror", () => {
    const page = buildProductsPage([product()]);
    expect(page.markdown).toContain("# Microsoft 365 Products");
    expect(page.markdown).toContain("Every active product receives an automated Last30Days reading once per week.");
    expect(page.markdown).not.toContain("<");
  });
});

describe("not found HTML", () => {
  it("is a real not-found document with the disclaimer", () => {
    const html = renderNotFoundHtml();
    expect(html).toContain("Page not found");
    expect(html).toContain(`content="noindex"`);
    expect(html).toContain(INDEPENDENT_DISCLAIMER);
    expect(html).toContain(`href="${DATASET_LICENSE}"`);
    expect(html).toContain("CC BY 4.0");
    expect(html).not.toContain(`id="root"`);
  });
});

describe("footer and static pages", () => {
  it("shows the CC BY 4.0 license and footer links in the visible shell", () => {
    expect(shell).toContain(`href="${DATASET_LICENSE}"`);
    expect(shell).toContain("CC BY 4.0");
    expect(shell).toContain('rel="license"');
    expect(shell).toContain('href="/methodology"');
    expect(shell).toContain('href="/about"');
    const html = applySeoToShell(shell, buildHomePage([]));
    expect(html).toContain(`href="${DATASET_LICENSE}"`);
    expect(html).toContain('href="/methodology"');
    expect(html).toContain('href="/about"');
    expect(html).toContain('"license":"https://creativecommons.org/licenses/by/4.0/"');
  });

  it("renders methodology from the scoring rules in code", () => {
    const page = buildMethodologyPage();
    const html = applySeoToShell(shell, page);
    expect(page.title).toBe("Methodology | M365 Barometer");
    expect(page.canonicalPath).toBe("/methodology");
    expect(page.description.length).toBeGreaterThan(0);
    expect(page.description.length).toBeLessThanOrEqual(160);
    expect(html).toContain("<title>Methodology | M365 Barometer</title>");
    expect(html).toContain(`<meta name="description" content="${page.description}" />`);
    expect(html).toContain(`href="${CANONICAL_ORIGIN}/methodology"`);
    expect(html).toContain('class="app-shell"');
    expect(html).toContain('class="prose"');

    const text = page.markdown;
    expect(text).toContain("# Methodology");
    expect(text).toContain("Supply and demand figures are estimates.");
    expect(text).toContain(`[mc.merill.net](https://mc.merill.net/messages-index.json)`);
    expect(text).toContain(`[Microsoft 365 Roadmap feed](https://www.microsoft.com/releasecommunications/api/v1/m365)`);
    expect(text).toContain("Wikipedia pageviews");
    expect(text).toContain("Hacker News");
    expect(text).toContain("X post counts");
    expect(text).toContain("YouTube and web evidence from the weekly sentiment searches");
    expect(text).toContain("Reddit only as evidence from public search results");
    expect(text).toContain(`only after ${MIN_SOURCE_WEEKS} weeks of history`);
    expect(text).toContain("(MIN_SOURCE_WEEKS)");
    expect(text).toContain(`trailing ${HISTORY_WEEKS} weeks`);
    expect(text).toContain(`at least ${MIN_SOURCES_FOR_LABEL} usable sources`);
    expect(text).toContain(`at least ${MIN_WEEKS_FOR_FULL_INDEX} weeks`);
    expect(text).toContain(`demand index is ${LABEL_HOT_AT} or higher`);
    expect(text).toContain(`demand index is ${LABEL_COLD_AT} or lower`);
    expect(text).toContain(`previous ${DEMAND_MOMENTUM_WEEKS} weeks`);
    expect(text).toContain("## Microsoft investment");
    expect(text).toContain(`last ${ANNOUNCEMENT_WINDOW_DAYS} days`);
    expect(text).toContain("(ANNOUNCEMENT_WINDOW_DAYS)");
    expect(text).toContain("These are announcement counts.");
    expect(text).toContain("They do not change the 0–100 barometer score");
    expect(text).toContain(`feed's own status values: ${ROADMAP_STATUS_ORDER.join(", ")}`);
    expect(text).toContain("as-of date");
    expect(text).toContain("shown as not available");
    expect(text).toContain(`High when it is ${HIGH_CONFIDENCE_SOURCES} or more`);
    expect(text).toContain(`The score is ${SENTIMENT_SCORE_MIDPOINT} when nothing was classified`);
    expect(text).toContain(`at least ${MIN_CLASSIFIED_EVIDENCE} evidence items`);
    expect(text).toContain(`score is ${TEMPERATURE_HOT_AT} or higher`);
    expect(text).toContain(`score is ${TEMPERATURE_COLD_AT} or lower`);
    expect(text).toContain(`momentum is ${TEMPERATURE_WARMING_AT} or higher`);
    expect(text).toContain(`momentum is ${TEMPERATURE_COOLING_AT} or lower`);
    expect(text).toContain(`at least ${CONFIDENCE_VERY_HIGH_ITEMS} classified items and at least ${CONFIDENCE_VERY_HIGH_CATEGORIES} categories`);
    expect(text).toContain(`at least ${CONFIDENCE_HIGH_ITEMS} classified items and at least ${CONFIDENCE_HIGH_CATEGORIES} categories`);
    expect(text).toContain(`at least ${CONFIDENCE_MEDIUM_ITEMS} classified items and at least ${CONFIDENCE_MEDIUM_CATEGORIES} categories`);
    expect(text).toContain(`When ${CONFIDENCE_FAILURES_BEFORE_DROP} or more configured sources have status failed`);
    expect(text).toContain(`Very High at ${VOLUME_VERY_HIGH_AT} or more`);
    expect(text).toContain(`High at ${VOLUME_HIGH_AT} or more`);
    expect(text).toContain(`Medium at ${VOLUME_MEDIUM_AT} or more`);
    for (const label of ["Hot", "Warming", "Stable", "Cooling", "Cold", "Neutral"]) {
      expect(text).toContain(label);
    }
    for (const level of ["Very High", "High", "Medium", "Low", "not enough data"]) {
      expect(text).toContain(level);
    }
    expect(text).not.toContain("<");
    expect(text.toLowerCase()).not.toContain("sthoms");

    const data = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1] ?? "{}") as {
      "@graph": Array<{ "@type": string; license?: string; publisher?: { "@type": string; name: string } }>;
    };
    const webPage = data["@graph"].find((node) => node["@type"] === "WebPage");
    expect(webPage?.license).toBe(DATASET_LICENSE);
    expect(webPage?.publisher).toEqual({
      "@type": "Organization",
      name: "M365 Barometer",
      url: `${CANONICAL_ORIGIN}/`,
      disambiguatingDescription: INDEPENDENT_DISCLAIMER,
    });
  });

  it("renders a short about page credited to the organization", () => {
    const page = buildAboutPage();
    const html = applySeoToShell(shell, page);
    expect(page.title).toBe("About | M365 Barometer");
    expect(page.canonicalPath).toBe("/about");
    expect(page.description.length).toBeLessThanOrEqual(160);
    expect(html).toContain("<title>About | M365 Barometer</title>");
    expect(html).toContain(`<meta name="description" content="${page.description}" />`);
    expect(html).toContain(`href="${CANONICAL_ORIGIN}/about"`);
    expect(page.markdown).toContain("# About");
    expect(page.markdown).toContain("independent community radar of which Microsoft 365 products are gaining or losing traction");
    expect(page.markdown).toContain("not affiliated with Microsoft");
    expect(page.markdown).toContain("independent organization");
    expect(page.markdown).toContain(`[methodology](${CANONICAL_ORIGIN}/methodology)`);
    expect(page.markdown).toContain(`[CC BY 4.0](${DATASET_LICENSE})`);
    expect(page.markdown).not.toContain("<");
    expect(page.markdown.toLowerCase()).not.toContain("sthoms");
  });
});
