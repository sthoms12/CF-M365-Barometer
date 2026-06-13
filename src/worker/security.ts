import type { MiddlewareHandler } from "hono";

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

export async function secureEqual(left: string, right: string): Promise<boolean> {
  const [leftHash, rightHash] = await Promise.all([digest(left), digest(right)]);
  let difference = 0;
  for (let index = 0; index < leftHash.length; index += 1) {
    difference |= leftHash[index] ^ rightHash[index];
  }
  return difference === 0;
}

export function bearerAuth(secretName: "INGEST_TOKEN"): MiddlewareHandler<{
  Bindings: Env;
}> {
  return async (context, next) => {
    const supplied = context.req.header("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    const expected = context.env[secretName];
    if (!supplied || !expected || !(await secureEqual(supplied, expected))) {
      return context.json({ error: "Unauthorized" }, 401);
    }
    await next();
  };
}

function isLocalRequest(url: string): boolean {
  const hostname = new URL(url).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

const sessionCookie = "m365_admin_session";

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function signExpiry(secret: string, expiresAt: number): Promise<string> {
  const payload = String(expiresAt);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
  return `${payload}.${base64Url(signature)}`;
}

export async function createAdminSession(secret: string, now = Date.now()): Promise<string> {
  const expiresAt = now + 12 * 60 * 60 * 1000;
  return signExpiry(secret, expiresAt);
}

export async function verifyAdminSession(session: string, secret: string, now = Date.now()): Promise<boolean> {
  const [expiresAtRaw] = session.split(".");
  const expiresAt = Number(expiresAtRaw);
  if (!expiresAt || expiresAt <= now) return false;
  return secureEqual(session, await signExpiry(secret, expiresAt));
}

export function adminSessionCookie(session: string): string {
  return `${sessionCookie}=${session}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200`;
}

export function clearAdminSessionCookie(): string {
  return `${sessionCookie}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

function cookieValue(header: string | undefined, name: string): string {
  return header?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1) ?? "";
}

export function adminAuth(): MiddlewareHandler<{ Bindings: Env }> {
  return async (context, next) => {
    if (isLocalRequest(context.req.url)) {
      await next();
      return;
    }

    const session = cookieValue(context.req.header("Cookie"), sessionCookie);
    if (!session || !context.env.ADMIN_KEY || !(await verifyAdminSession(session, context.env.ADMIN_KEY))) {
      return context.json({ error: "Admin authentication required" }, 401);
    }
    await next();
  };
}
