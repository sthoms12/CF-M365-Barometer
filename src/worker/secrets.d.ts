declare namespace Cloudflare {
  interface Env {
    INGEST_TOKEN: string;
    GITHUB_TOKEN: string;
    /** Public origin, no trailing slash. Set by the deploy workflow when PUBLIC_BASE_URL is configured. */
    PUBLIC_BASE_URL?: string;
  }
}
