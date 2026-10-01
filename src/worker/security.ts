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

// Guards the /api/internal/* endpoints used by the GitHub Actions collector.
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
