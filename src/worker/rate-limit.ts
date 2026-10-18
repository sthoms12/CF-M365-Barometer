/**
 * Per-IP throttle for `/api/*` only, using the Workers Rate Limiting binding.
 *
 * The binding is included on the Workers Free plan (no separate charge).
 * Counters are cached per Cloudflare location, so the limit is not a global
 * cap, and people behind one NAT share a budget. HTML, robots.txt, and the
 * sitemap are not limited — those routes are meant to be crawled.
 *
 * `limit()` failing open keeps a platform blip from taking down the read API.
 * The threshold itself lives in `ratelimits` in wrangler.jsonc (60 / 60s).
 */

export type ApiRateLimiter = {
  limit(options: { key: string }): Promise<{ success: boolean }>;
};

export async function apiRateLimitResponse(
  limiter: ApiRateLimiter | undefined,
  request: Request,
): Promise<Response | null> {
  const { pathname } = new URL(request.url);
  if (!pathname.startsWith("/api/")) return null;

  if (!limiter) {
    console.error(JSON.stringify({ event: "rate_limit_unconfigured", path: pathname }));
    return null;
  }

  try {
    const key = (request.headers.get("CF-Connecting-IP") ?? "unknown").slice(0, 64);
    const { success } = await limiter.limit({ key });
    if (success) return null;
  } catch (error) {
    console.error(JSON.stringify({
      event: "rate_limit_error",
      path: pathname,
      message: error instanceof Error ? error.message : "unknown",
    }));
    return null;
  }

  console.warn(JSON.stringify({ event: "rate_limited", path: pathname }));
  return new Response(JSON.stringify({ error: "Too many requests" }), {
    status: 429,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "retry-after": "60",
    },
  });
}
