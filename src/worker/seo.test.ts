import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ProductSummary } from "../shared/contracts";
import {
  CANONICAL_ORIGIN,
  INDEPENDENT_DISCLAIMER,
  applySeoToShell,
  buildHomePage,
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
    expect(dataset?.variableMeasured).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "barometerScore", value: 72 }),
    ]));
  });

  it("does not invent a score when D1 has no snapshot", () => {
    const html = applySeoToShell(shell, buildProductPage(product(), []));
    expect(html).toContain("No automated reading is stored for this product yet.");
    expect(html).toContain("Supply vs demand");
    expect(html).toContain("Not enough data");
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
});

describe("not found HTML", () => {
  it("is a real not-found document with the disclaimer", () => {
    const html = renderNotFoundHtml();
    expect(html).toContain("Page not found");
    expect(html).toContain(`content="noindex"`);
    expect(html).toContain(INDEPENDENT_DISCLAIMER);
    expect(html).not.toContain(`id="root"`);
  });
});
