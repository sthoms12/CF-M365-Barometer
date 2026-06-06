import type { MiddlewareHandler } from "hono";
import { createRemoteJWKSet, jwtVerify } from "jose";

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

export function accessAuth(): MiddlewareHandler<{ Bindings: Env }> {
  return async (context, next) => {
    if (isLocalRequest(context.req.url)) {
      await next();
      return;
    }

    const token = context.req.header("Cf-Access-Jwt-Assertion");
    if (!token) return context.json({ error: "Cloudflare Access authentication required" }, 401);

    try {
      const issuer = `https://${context.env.ACCESS_TEAM_DOMAIN}`;
      const jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
      await jwtVerify(token, jwks, {
        issuer,
        audience: context.env.ACCESS_AUD,
      });
      await next();
    } catch (error) {
      console.warn(JSON.stringify({
        event: "access_jwt_rejected",
        message: error instanceof Error ? error.message : "unknown",
      }));
      return context.json({ error: "Invalid Cloudflare Access session" }, 403);
    }
  };
}
