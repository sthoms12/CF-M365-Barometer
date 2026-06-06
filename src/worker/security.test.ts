import { describe, expect, it, vi } from "vitest";
import { accessAuth } from "./security";

function context(url: string, jwt?: string) {
  const json = vi.fn((body: unknown, status?: number) => ({ body, status }));
  return {
    req: {
      url,
      header: vi.fn((name: string) => name === "Cf-Access-Jwt-Assertion" ? jwt : undefined),
    },
    env: {
      ACCESS_TEAM_DOMAIN: "example.cloudflareaccess.com",
      ACCESS_AUD: "audience",
    },
    json,
  };
}

describe("Cloudflare Access middleware", () => {
  it("allows localhost development without an Access assertion", async () => {
    const next = vi.fn();
    await accessAuth()(context("http://127.0.0.1:5173/admin/api/products") as never, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("rejects production requests without an Access assertion", async () => {
    const next = vi.fn();
    const result = await accessAuth()(context("https://barometer.example.com/admin/api/products") as never, next);
    expect(next).not.toHaveBeenCalled();
    expect(result).toEqual({
      body: { error: "Cloudflare Access authentication required" },
      status: 401,
    });
  });
});
