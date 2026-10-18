import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { PUBLIC_API_RATE_LIMIT, publicApiRateLimitKey, rateLimitPublicApi } from "./rate-limit";

describe("public API rate limit", () => {
  it("matches the Workers Rate Limiting binding", () => {
    const config = JSON.parse(readFileSync(new URL("../../wrangler.jsonc", import.meta.url), "utf8")) as {
      ratelimits: Array<{ name: string; simple: { limit: number; period: number } }>;
      assets: { not_found_handling: string; run_worker_first: string[] };
    };
    expect(config.ratelimits[0]).toMatchObject({
      name: "PUBLIC_API_RATE_LIMITER",
      simple: PUBLIC_API_RATE_LIMIT,
    });
    expect(config.assets.not_found_handling).toBe("none");
    // `/*` covers /robots.txt, /sitemap.xml, /, /products, and /products/*.
    // Wrangler rejects those patterns when `/*` is also listed. Hashed files under
    // /assets/* stay on the asset server so the React bundle is not rewritten.
    expect(config.assets.run_worker_first).toEqual(["/*", "!/assets/*"]);
  });

  it("returns 429 with Retry-After for a limited IP and skips internal routes", async () => {
    const calls: string[] = [];
    const limiter = {
      limit: async ({ key }: { key: string }) => {
        calls.push(key);
        return { success: key !== "198.51.100.10" };
      },
    };
    const app = new Hono<{ Bindings: { PUBLIC_API_RATE_LIMITER: typeof limiter } }>();
    app.use("/api/*", rateLimitPublicApi());
    app.get("/api/health", (context) => context.json({ ok: true }));
    app.get("/api/internal/analysis-runs/:id/context", (context) => context.json({ ok: true }));

    const limited = await app.request("http://localhost/api/health", {
      headers: { "CF-Connecting-IP": "198.51.100.10" },
    }, { PUBLIC_API_RATE_LIMITER: limiter });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe(String(PUBLIC_API_RATE_LIMIT.period));
    expect(await limited.json()).toEqual({ error: "Too many requests" });

    const allowed = await app.request("http://localhost/api/health", {}, { PUBLIC_API_RATE_LIMITER: limiter });
    expect(allowed.status).toBe(200);
    expect(calls).toEqual(["198.51.100.10", "unknown"]);
    expect(publicApiRateLimitKey(undefined)).toBe("unknown");

    const internal = await app.request("http://localhost/api/internal/analysis-runs/1/context", {
      headers: { "CF-Connecting-IP": "198.51.100.10" },
    }, { PUBLIC_API_RATE_LIMITER: limiter });
    expect(internal.status).toBe(200);
    expect(calls).toEqual(["198.51.100.10", "unknown"]);
  });
});
