import { describe, expect, it } from "vitest";
import type { ProductSummary } from "../shared/contracts";
import { INDEPENDENT_DISCLAIMER } from "../shared/site";
import {
  SEARCH_CRAWLERS,
  formatUpdatedDate,
  injectDocument,
  publicOrigin,
  renderHomePage,
  renderNotFoundPage,
  renderProductPage,
  renderRobotsTxt,
  renderSitemap,
} from "./crawl";

const shell = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="description" content="Replace me" />
    <title>M365 Barometer</title>
    <script type="module" src="/assets/index-abc123.js"></script>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`;

function product(overrides: Partial<ProductSummary> = {}): ProductSummary {
  return {
    id: "prod-m365-copilot",
    slug: "microsoft-365-copilot",
    name: "Microsoft 365 Copilot",
    description: "Copilot across Word, Excel, and Teams.",
    isActive: true,
    nextAnalysisAt: null,
    lastAnalyzedAt: "2026-09-30T15:04:05.000Z",
    isStale: true,
    snapshot: {
      id: "snap-1",
      analyzedAt: "2026-09-30T15:04:05.000Z",
      barometerScore: 33,
      temperature: "Warming",
      momentum: -4,
      confidence: "Low",
      discussionVolume: "Low",
      summary: "Discussion is thin and mixed.",
      positiveSignals: [],
      negativeSignals: [],
      sourceBreakdown: { reddit: 1, x: 1, blogs: 0, forums: 0, youtube: 0, other: 0 },
      sourceStatus: {},
    },
    ...overrides,
  };
}

describe("public origin", () => {
  it("canonicalizes the apex and www hostnames to www", () => {
    expect(publicOrigin("https://m365-barometer.com/products")).toBe("https://www.m365-barometer.com");
    expect(publicOrigin("https://www.m365-barometer.com/")).toBe("https://www.m365-barometer.com");
    expect(publicOrigin("https://www.m365-barometer.com/", "https://m365-barometer.example.workers.dev")).toBe(
      "https://www.m365-barometer.com",
    );
  });

  it("uses the configured origin for other hostnames", () => {
    expect(publicOrigin("https://m365-barometer.example.workers.dev/", "https://www.m365-barometer.com/")).toBe(
      "https://www.m365-barometer.com",
    );
    expect(publicOrigin("http://127.0.0.1:8787/products")).toBe("http://127.0.0.1:8787");
  });
});

describe("robots.txt", () => {
  const body = renderRobotsTxt("https://www.m365-barometer.com");

  it("allows search and AI crawlers and points at the sitemap", () => {
    for (const crawler of SEARCH_CRAWLERS) {
      expect(body).toContain(`User-agent: ${crawler}\nAllow: /\nDisallow: /api/\n`);
    }
    expect(body).toContain("User-agent: *\nAllow: /\nDisallow: /api/\n");
    expect(body).toContain("Sitemap: https://www.m365-barometer.com/sitemap.xml\n");
  });

  it("does not disallow the public site", () => {
    const disallowed = body
      .split("\n")
      .filter((line) => line.startsWith("Disallow:"))
      .map((line) => line.slice("Disallow:".length).trim());
    expect(disallowed.every((path) => path === "/api/")).toBe(true);
    expect(disallowed.length).toBe(SEARCH_CRAWLERS.length + 1);
  });
});

describe("sitemap.xml", () => {
  it("lists the public routes and product pages", () => {
    const xml = renderSitemap("https://www.m365-barometer.com", [product()]);
    expect(xml).toContain("<loc>https://www.m365-barometer.com/</loc>");
    expect(xml).toContain("<loc>https://www.m365-barometer.com/products</loc>");
    expect(xml).toContain("<loc>https://www.m365-barometer.com/products/microsoft-365-copilot</loc>");
    expect(xml).toContain("<lastmod>2026-09-30</lastmod>");
  });

  it("escapes urls", () => {
    const xml = renderSitemap("https://www.m365-barometer.com", [product({ slug: "a&b" })]);
    expect(xml).toContain("<loc>https://www.m365-barometer.com/products/a%26b</loc>");
    expect(xml).not.toContain("<loc>https://www.m365-barometer.com/products/a&b</loc>");
  });
});

describe("prerendered html", () => {
  it("includes the home reading, metadata, and the React shell", () => {
    const page = renderHomePage("https://www.m365-barometer.com", [product()]);
    const html = injectDocument(shell, page);
    expect(html).toContain("<title>M365 Barometer</title>");
    expect(html).toContain(`content="${page.description}"`);
    expect(html).toContain(`<link rel="canonical" href="https://www.m365-barometer.com/" />`);
    expect(html).toContain(`<meta property="og:title" content="M365 Barometer" />`);
    expect(html).toContain(`<meta property="og:url" content="https://www.m365-barometer.com/" />`);
    expect(html).toContain(`"@type":"WebSite"`);
    expect(html).toContain("Microsoft 365 Copilot");
    expect(html).toContain("Temperature: Warming. Score: 33/100. Last updated: September 30, 2026.");
    expect(html).toContain("Discussion is thin and mixed.");
    expect(html).toContain(INDEPENDENT_DISCLAIMER);
    expect(html).toContain(`<script type="module" src="/assets/index-abc123.js"></script>`);
    expect(html.indexOf('id="prerender"')).toBeLessThan(html.indexOf('id="root"'));
    expect(html).toContain('document.documentElement.classList.add("js")');
    expect(html).toContain("html.js #prerender{display:none}");
  });

  it("renders a product page with dataset json-ld", () => {
    const page = renderProductPage("https://www.m365-barometer.com", product());
    const html = injectDocument(shell, page);
    expect(html).toContain("<title>Microsoft 365 Copilot | M365 Barometer</title>");
    expect(html).toContain("<h1>Microsoft 365 Copilot</h1>");
    expect(html).toContain("<dt>Temperature</dt><dd>Warming</dd>");
    expect(html).toContain("<dt>Score</dt><dd>33<span>/100</span></dd>");
    expect(html).toContain(`<time datetime="2026-09-30T15:04:05.000Z">September 30, 2026</time>`);
    expect(html).toContain("<h2>Summary</h2>");
    expect(html).toContain("<p>Discussion is thin and mixed.</p>");
    expect(html).toContain(`"@type":"Dataset"`);
    expect(html).toContain(INDEPENDENT_DISCLAIMER);
  });

  it("escapes product text so it cannot break out of the page", () => {
    const page = renderProductPage("https://www.m365-barometer.com", product({
      name: `</script><script>alert("x")</script>`,
      description: `He said "hello" & <ok>`,
      snapshot: {
        ...product().snapshot!,
        summary: `</script><img alt="x">`,
      },
    }));
    const html = injectDocument(shell, page);
    expect(html).not.toContain(`<script>alert("x")</script>`);
    expect(html).toContain("&lt;/script&gt;");
    expect(html).toContain("He said &quot;hello&quot; &amp; &lt;ok&gt;");
    expect(html).toContain("\\u003c/script\\u003e");
  });

  it("says when a product has no reading yet", () => {
    const page = renderProductPage("https://www.m365-barometer.com", product({
      snapshot: null,
      lastAnalyzedAt: null,
      description: "Waiting on the first reading.",
    }));
    const html = injectDocument(shell, page);
    expect(html).toContain("<dt>Temperature</dt><dd>Not yet analyzed</dd>");
    expect(html).toContain("<dt>Score</dt><dd>Not yet analyzed</dd>");
    expect(html).toContain("Not yet analyzed");
    expect(html).toContain("Waiting on the first reading.");
  });

  it("marks unknown products noindex", () => {
    const html = injectDocument(shell, renderNotFoundPage("https://www.m365-barometer.com"));
    expect(html).toContain("<h1>Product not found</h1>");
    expect(html).toContain(`<meta name="robots" content="noindex" />`);
  });
});

describe("dates", () => {
  it("formats ISO and sqlite timestamps in UTC", () => {
    expect(formatUpdatedDate("2026-09-30T15:04:05.000Z")).toBe("September 30, 2026");
    expect(formatUpdatedDate("2026-09-30 15:04:05")).toBe("September 30, 2026");
    expect(formatUpdatedDate(null)).toBe("Not yet analyzed");
  });
});
