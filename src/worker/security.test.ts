import { describe, expect, it, vi } from "vitest";
import { adminAuth, createAdminSession, verifyAdminSession } from "./security";

function context(url: string, cookie?: string) {
  const json = vi.fn((body: unknown, status?: number) => ({ body, status }));
  return {
    req: {
      url,
      header: vi.fn((name: string) => name === "Cookie" ? cookie : undefined),
    },
    env: {
      ADMIN_KEY: "a-long-random-admin-key",
    },
    json,
  };
}

describe("admin key sessions", () => {
  it("creates a valid signed session that expires", async () => {
    const now = Date.now();
    const session = await createAdminSession("secret", now);
    expect(await verifyAdminSession(session, "secret", now + 1)).toBe(true);
    expect(await verifyAdminSession(session, "wrong-secret", now + 1)).toBe(false);
    expect(await verifyAdminSession(session, "secret", now + 12 * 60 * 60 * 1000 + 1)).toBe(false);
  });

  it("allows localhost development without a session", async () => {
    const next = vi.fn();
    await adminAuth()(context("http://127.0.0.1:5173/admin/api/products") as never, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("accepts a valid production session", async () => {
    const next = vi.fn();
    const session = await createAdminSession("a-long-random-admin-key");
    await adminAuth()(
      context("https://barometer.example.com/admin/api/products", `m365_admin_session=${session}`) as never,
      next,
    );
    expect(next).toHaveBeenCalledOnce();
  });

  it("rejects production requests without a session", async () => {
    const next = vi.fn();
    const result = await adminAuth()(context("https://barometer.example.com/admin/api/products") as never, next);
    expect(next).not.toHaveBeenCalled();
    expect(result).toEqual({
      body: { error: "Admin authentication required" },
      status: 401,
    });
  });
});
