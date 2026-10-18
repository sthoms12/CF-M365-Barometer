import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { app } from "./index";

const shell = readFileSync(new URL("../../index.html", import.meta.url), "utf8");

const copilot = {
  id: "prod-copilot",
  slug: "microsoft-365-copilot",
  name: "Microsoft 365 Copilot",
  description: "Copilot across Office apps.",
  analysis_query: "q",
  aliases_json: "[]",
  source_config_json: "{}",
  is_active: 1,
  next_analysis_at: null,
  last_analyzed_at: "2026-06-07 15:04:00",
  lifecycle_status: "active",
  snapshot_id: "snap-1",
  analyzed_at: "2026-06-07 15:04:00",
  barometer_score: 72,
  temperature: "Warming",
  momentum: 4,
  confidence: "Low",
  discussion_volume: "Low",
  summary: "Community sentiment is cautiously positive.",
  positive_signals_json: JSON.stringify(["Useful drafts"]),
  negative_signals_json: JSON.stringify([]),
  source_breakdown_json: JSON.stringify({ reddit: 4, x: 0, blogs: 0, forums: 0, youtube: 0, other: 0 }),
  source_status_json: "{}",
};

const pending = {
  ...copilot,
  id: "prod-teams",
  slug: "teams-phone",
  name: "Teams Phone",
  description: "Cloud calling.",
  last_analyzed_at: null,
  snapshot_id: null,
};

function env(assetsFetch?: (request: Request) => Promise<Response>) {
  const fetched: string[] = [];
  return {
    fetched,
    bindings: {
      DB: {
        prepare(sql: string) {
          const statement = {
            bind() {
              return statement;
            },
            async all() {
              if (sql.includes("source_mentions")) {
                return {
                  results: [{
                    sourceType: "reddit",
                    sourceTitle: "Copilot thread",
                    sourceUrl: "https://example.com/thread",
                    sentiment: "positive",
                    excerpt: "Helpful for drafts.",
                  }],
                };
              }
              if (sql.includes("COALESCE")) {
                return {
                  results: [
                    { slug: "microsoft-365-copilot", last_modified: "2026-06-07 15:04:00" },
                    { slug: "teams-phone", last_modified: "2026-05-01 00:00:00" },
                  ],
                };
              }
              return { results: [copilot, pending] };
            },
          };
          return statement;
        },
      },
      ASSETS: {
        fetch: async (request: Request) => {
          fetched.push(new URL(request.url).pathname);
          if (assetsFetch) return assetsFetch(request);
          if (new URL(request.url).pathname === "/index.html") {
            return new Response(shell, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
          }
          return new Response("missing", { status: 404 });
        },
      },
      PUBLIC_API_RATE_LIMITER: {
        limit: async () => ({ success: true }),
      },
      INGEST_TOKEN: "secret",
      GITHUB_TOKEN: "github",
    },
  };
}

describe("public crawl routes", () => {
  it("serves robots.txt as plain text", async () => {
    const { bindings } = env();
    const response = await app.request("http://localhost/robots.txt", {}, bindings);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    const body = await response.text();
    expect(body).toContain("Sitemap: https://www.m365-barometer.com/sitemap.xml");
    expect(body).not.toContain("<html");
  });

  it("serves sitemap.xml from D1 slugs", async () => {
    const { bindings } = env();
    const response = await app.request("http://localhost/sitemap.xml", {}, bindings);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/xml");
    const body = await response.text();
    expect(body).toContain("https://www.m365-barometer.com/products/microsoft-365-copilot");
    expect(body).toContain("https://www.m365-barometer.com/products/teams-phone");
    expect(body).not.toContain("<html");
  });

  it("renders home HTML for a non-JS client and keeps the React entry", async () => {
    const { bindings, fetched } = env();
    const response = await app.request("http://localhost/", {}, bindings);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    const body = await response.text();
    expect(body).toContain("Microsoft 365 sentiment, measured in public.");
    expect(body).toContain("Barometer score: 72/100");
    expect(body).toContain("No automated reading is stored for this product yet.");
    expect(body).toContain("Independent project, not affiliated with Microsoft.");
    expect(body).toContain('type="module"');
    expect(fetched).toEqual(["/index.html"]);
  });

  it("renders a product page from D1 and 404s unknown slugs", async () => {
    const { bindings } = env();
    const found = await app.request("http://localhost/products/microsoft-365-copilot", {}, bindings);
    expect(found.status).toBe(200);
    const html = await found.text();
    expect(html).toContain("Community sentiment is cautiously positive.");
    expect(html).toContain("Helpful for drafts.");
    expect(html).toContain('rel="canonical" href="https://www.m365-barometer.com/products/microsoft-365-copilot"');

    const missing = await app.request("http://localhost/products/not-a-product", {}, bindings);
    expect(missing.status).toBe(404);
    expect(missing.headers.get("content-type")).toContain("text/html");
    expect(await missing.text()).toContain("Page not found");
  });

  it("returns a real 404 for unknown paths and does not serve the SPA shell", async () => {
    const { bindings, fetched } = env();
    const response = await app.request("http://localhost/not-a-page", {}, bindings);
    expect(response.status).toBe(404);
    const body = await response.text();
    expect(body).toContain("Page not found");
    expect(body).not.toContain('id="root"');
    expect(fetched).toEqual([]);
  });

  it("passes real files through to assets and redirects /index.html", async () => {
    const { bindings, fetched } = env();
    const icon = await app.request("http://localhost/favicon.ico", {}, bindings);
    expect(icon.status).toBe(404);
    expect(fetched).toEqual(["/favicon.ico"]);

    const index = await app.request("http://localhost/index.html", {}, bindings);
    expect(index.status).toBe(301);
    expect(index.headers.get("location")).toBe("/");
  });

  it("does not rate limit bearer-protected internal routes", async () => {
    let calls = 0;
    const { bindings } = env();
    bindings.PUBLIC_API_RATE_LIMITER = {
      limit: async () => {
        calls += 1;
        return { success: false };
      },
    };
    const response = await app.request("http://localhost/api/internal/analysis-runs/1/context", {}, bindings);
    expect(calls).toBe(0);
    expect(response.status).toBe(401);
  });

  it("rate limits public API routes", async () => {
    const { bindings } = env();
    bindings.PUBLIC_API_RATE_LIMITER = { limit: async () => ({ success: false }) };
    const response = await app.request("http://localhost/api/health", {
      headers: { "CF-Connecting-IP": "203.0.113.9" },
    }, bindings);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
  });
});
