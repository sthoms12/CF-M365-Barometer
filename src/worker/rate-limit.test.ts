import { describe, expect, it, vi } from "vitest";
import { apiRateLimitResponse, type ApiRateLimiter } from "./rate-limit";

function limiter(result: { success: boolean } | Error, calls: string[] = []): ApiRateLimiter {
  return {
    limit: async ({ key }) => {
      calls.push(key);
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

describe("api rate limit", () => {
  it("ignores non-api routes", async () => {
    const calls: string[] = [];
    const response = await apiRateLimitResponse(
      limiter({ success: false }, calls),
      new Request("https://www.m365-barometer.com/"),
    );
    expect(response).toBeNull();
    expect(calls).toEqual([]);
  });

  it("allows a request under the limit and keys it by ip", async () => {
    const calls: string[] = [];
    const response = await apiRateLimitResponse(
      limiter({ success: true }, calls),
      new Request("https://www.m365-barometer.com/api/products", {
        headers: { "CF-Connecting-IP": "203.0.113.9" },
      }),
    );
    expect(response).toBeNull();
    expect(calls).toEqual(["203.0.113.9"]);
  });

  it("returns 429 when the limiter rejects the ip", async () => {
    const response = await apiRateLimitResponse(
      limiter({ success: false }),
      new Request("https://www.m365-barometer.com/api/home", {
        headers: { "CF-Connecting-IP": "203.0.113.9" },
      }),
    );
    expect(response?.status).toBe(429);
    expect(response?.headers.get("retry-after")).toBe("60");
    expect(response?.headers.get("cache-control")).toBe("no-store");
    await expect(response?.json()).resolves.toEqual({ error: "Too many requests" });
  });

  it("fails open when the binding throws", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await apiRateLimitResponse(
        limiter(new Error("binding unavailable")),
        new Request("https://www.m365-barometer.com/api/health"),
      );
      expect(response).toBeNull();
      expect(errorLog).toHaveBeenCalled();
    } finally {
      errorLog.mockRestore();
    }
  });

  it("limits internal collector routes too", async () => {
    const response = await apiRateLimitResponse(
      limiter({ success: false }),
      new Request("https://www.m365-barometer.com/api/internal/analysis-runs/1/ingest", {
        method: "POST",
        headers: { "CF-Connecting-IP": "198.51.100.4" },
      }),
    );
    expect(response?.status).toBe(429);
  });
});
