import type { PageContent } from "./crawl";
import { injectDocument } from "./crawl";

/**
 * Serves the Vite shell with crawlable content injected.
 * HTML is not edge-cached: the shell points at a hashed script, and a cached
 * copy from before a deploy would leave the app blank. Browsers revalidate.
 */

const FALLBACK_SHELL = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>M365 Barometer</title></head><body><div id="root"></div></body></html>`;

export async function loadClientShell(assets: Fetcher, requestUrl: string): Promise<string> {
  try {
    const url = new URL("/index.html", requestUrl);
    const response = await assets.fetch(new Request(url));
    if (response.ok) {
      const text = await response.text();
      if (text.includes('id="root"')) return text;
    }
  } catch (error) {
    console.error(JSON.stringify({
      event: "shell_load_failed",
      message: error instanceof Error ? error.message : "unknown",
    }));
  }
  return FALLBACK_SHELL;
}

export async function servePage(
  requestUrl: string,
  assets: Fetcher,
  page: PageContent,
  status: number,
): Promise<Response> {
  const shell = await loadClientShell(assets, requestUrl);
  return new Response(injectDocument(shell, page), {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": status === 200 ? "public, max-age=0, must-revalidate" : "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
