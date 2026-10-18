import type { MiddlewareHandler } from "hono";

export const PUBLIC_API_RATE_LIMIT = {
  limit: 60,
  period: 60,
} as const;

type RateLimitedEnv = {
  PUBLIC_API_RATE_LIMITER: RateLimit;
};

export function isInternalApiPath(pathname: string): boolean {
  return pathname === "/api/internal" || pathname.startsWith("/api/internal/");
}

export function publicApiRateLimitKey(header: string | undefined): string {
  const ip = header?.trim();
  return ip ? ip : "unknown";
}

// Public /api/* routes are limited per client IP. /api/internal/* stays on its bearer token.
export function rateLimitPublicApi(): MiddlewareHandler<{ Bindings: RateLimitedEnv }> {
  return async (context, next) => {
    if (isInternalApiPath(context.req.path)) {
      await next();
      return;
    }

    const key = publicApiRateLimitKey(context.req.header("CF-Connecting-IP"));
    const { success } = await context.env.PUBLIC_API_RATE_LIMITER.limit({ key });
    if (!success) {
      console.log(JSON.stringify({
        event: "rate_limited",
        path: context.req.path,
        limit: PUBLIC_API_RATE_LIMIT.limit,
        period: PUBLIC_API_RATE_LIMIT.period,
      }));
      return context.json({ error: "Too many requests" }, 429, {
        "Retry-After": String(PUBLIC_API_RATE_LIMIT.period),
      });
    }
    await next();
  };
}
