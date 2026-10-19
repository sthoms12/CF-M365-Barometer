import { externalSignalSchema } from "../shared/contracts";
import type { SupplyDemandScore } from "../shared/contracts";
import {
  countHitsByWeek,
  emptySupplyDemand,
  isMonday,
  isoWeekStart,
  itemMatches,
  lastCompletedWeek,
  resolveSignalProfile,
  scoreSupplyDemand,
  shiftWeek,
  sumPageviewsByWeek,
  timestampInWeek,
  weekSequence,
  type CatalogItem,
  type ScoreSignal,
  type SignalKind,
  type SourceConfig,
} from "./signal-catalog";

const USER_AGENT = "M365Barometer/1.0 (https://www.m365-barometer.com; weekly-signals)";
const MESSAGE_CENTER_URL = "https://mc.merill.net/messages-index.json";
const ROADMAP_URL = "https://www.microsoft.com/releasecommunications/api/v1/m365";
const FETCH_TIMEOUT_MS = 12_000;
const CACHE_SECONDS = 6 * 60 * 60;

export type SignalFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type SignalProduct = {
  id: string;
  slug: string;
  name: string;
  profile: ReturnType<typeof resolveSignalProfile>;
};

type SignalWrite = {
  productId: string;
  week: string;
  source: string;
  kind: SignalKind;
  value: number;
  meta: Record<string, unknown>;
};

type SourceFailure = { source: string; message: string };

export type SignalCollectionResult = {
  weeks: string[];
  wrote: number;
  skipped: Array<{ slug: string; source: string; reason: string }>;
  errors: SourceFailure[];
};

const UPSERT = `
  INSERT INTO signals (id, product_id, week, source, kind, value, meta_json, collected_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(product_id, week, source) DO UPDATE SET
    kind = excluded.kind,
    value = excluded.value,
    meta_json = excluded.meta_json,
    collected_at = excluded.collected_at
`;

export async function collectWeeklySignals(
  env: Env,
  options: { fetch?: SignalFetcher; now?: Date; week?: string } = {},
): Promise<SignalCollectionResult> {
  const now = options.now ?? new Date();
  const week = options.week ?? lastCompletedWeek(now);
  return collectSources(env, {
    fetch: options.fetch,
    now,
    weeks: [week],
    sources: ["message_center", "roadmap", "wikipedia", "hacker_news"],
  });
}

export async function backfillSignalHistory(
  env: Env,
  options: {
    fetch?: SignalFetcher;
    now?: Date;
    weeks?: number;
    productSlug?: string;
    sources?: Array<"wikipedia" | "hacker_news">;
  } = {},
): Promise<SignalCollectionResult> {
  const now = options.now ?? new Date();
  const count = options.weeks ?? 26;
  const end = lastCompletedWeek(now);
  return collectSources(env, {
    fetch: options.fetch,
    now,
    weeks: weekSequence(end, count),
    sources: options.sources ?? ["wikipedia", "hacker_news"],
    productSlug: options.productSlug,
    includeInactive: Boolean(options.productSlug),
  });
}

export async function ingestExternalSignals(db: D1Database, body: unknown, now = new Date()): Promise<
  { stored: number } | { error: string }
> {
  const parsed = externalSignalSchema.safeParse(body);
  if (!parsed.success) return { error: "Expected signals with productSlug, week, source, kind, and value" };

  const writes: SignalWrite[] = [];
  for (const signal of parsed.data.signals) {
    const kindError = externalKindError(signal.source, signal.kind);
    if (kindError) return { error: kindError };
    const weekDate = new Date(`${signal.week}T00:00:00.000Z`);
    if (Number.isNaN(weekDate.getTime())) return { error: "week must be a calendar date" };
    const week = isMonday(signal.week) ? signal.week : isoWeekStart(weekDate);
    const product = await db.prepare(
      "SELECT id FROM products WHERE slug = ?",
    ).bind(signal.productSlug).first<{ id: string }>();
    if (!product) return { error: `Product not found: ${signal.productSlug}` };
    const meta = { ...(signal.meta ?? {}) };
    if (signal.estimated) meta.estimated = true;
    writes.push({
      productId: product.id,
      week,
      source: signal.source,
      kind: signal.kind,
      value: signal.value,
      meta,
    });
  }
  await writeSignals(db, writes, now);
  return { stored: writes.length };
}

export async function readSupplyDemand(db: D1Database, productId: string, now = new Date()): Promise<SupplyDemandScore> {
  const start = shiftWeek(isoWeekStart(now), -(26 + 4));
  const { results } = await db.prepare(`
    SELECT week, source, kind, value, meta_json
    FROM signals
    WHERE product_id = ? AND week >= ?
    ORDER BY week
  `).bind(productId, start).all<{ week: string; source: string; kind: string; value: number; meta_json: string }>();

  const signals: ScoreSignal[] = [];
  for (const row of results) {
    if (row.kind !== "supply" && row.kind !== "demand") continue;
    if (typeof row.week !== "string" || typeof row.value !== "number") continue;
    signals.push({
      week: row.week,
      source: String(row.source),
      kind: row.kind,
      value: row.value,
      estimated: metaEstimated(row.meta_json),
    });
  }
  if (signals.length === 0) return emptySupplyDemand();
  return scoreSupplyDemand(signals, now);
}

async function collectSources(
  env: Env,
  options: {
    fetch?: SignalFetcher;
    now: Date;
    weeks: string[];
    sources: string[];
    productSlug?: string;
    includeInactive?: boolean;
  },
): Promise<SignalCollectionResult> {
  const fetcher = options.fetch ?? ((input, init) => fetch(input, init));
  const products = await loadProducts(env.DB, options.productSlug, options.includeInactive ?? false);
  const result: SignalCollectionResult = { weeks: options.weeks, wrote: 0, skipped: [], errors: [] };
  if (options.productSlug && products.length === 0) {
    result.errors.push({ source: "products", message: "Product not found" });
    return result;
  }

  for (const source of options.sources) {
    try {
      const partial = await collectSource(env.DB, fetcher, products, options.weeks, source, options.now);
      result.wrote += partial.wrote;
      result.skipped.push(...partial.skipped);
      result.errors.push(...partial.errors);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Source failed";
      result.errors.push({ source, message });
      console.error(JSON.stringify({ event: "signal_source_failed", source, message }));
    }
  }
  console.log(JSON.stringify({
    event: "signals_collected",
    weeks: options.weeks.length,
    wrote: result.wrote,
    errors: result.errors.length,
  }));
  return result;
}

async function collectSource(
  db: D1Database,
  fetcher: SignalFetcher,
  products: SignalProduct[],
  weeks: string[],
  source: string,
  now: Date,
): Promise<Pick<SignalCollectionResult, "wrote" | "skipped" | "errors">> {
  if (source === "message_center") return collectCatalog(db, fetcher, products, weeks, now, "message_center", MESSAGE_CENTER_URL, messageCenterItems);
  if (source === "roadmap") return collectCatalog(db, fetcher, products, weeks, now, "roadmap", ROADMAP_URL, roadmapItems);
  if (source === "wikipedia") return collectWikipedia(db, fetcher, products, weeks, now);
  if (source === "hacker_news") return collectHackerNews(db, fetcher, products, weeks, now);
  return { wrote: 0, skipped: [], errors: [{ source, message: "Unsupported source" }] };
}

async function collectCatalog(
  db: D1Database,
  fetcher: SignalFetcher,
  products: SignalProduct[],
  weeks: string[],
  now: Date,
  source: string,
  url: string,
  parse: (payload: unknown) => CatalogItem[],
): Promise<Pick<SignalCollectionResult, "wrote" | "skipped" | "errors">> {
  const payload = await fetchJson(url, fetcher);
  const items = parse(payload);
  const writes: SignalWrite[] = [];
  for (const product of products) {
    for (const week of weeks) {
      const matched = items.filter((item) => item.at && timestampInWeek(item.at, week) && itemMatches(item, product.profile));
      writes.push({
        productId: product.id,
        week,
        source,
        kind: "supply",
        value: matched.length,
        meta: {
          matchedIds: matched.slice(0, 5).map((item) => item.id),
          majorChanges: matched.filter((item) => item.major).length,
        },
      });
    }
  }
  await writeSignals(db, writes, now);
  return { wrote: writes.length, skipped: [], errors: [] };
}

async function collectWikipedia(
  db: D1Database,
  fetcher: SignalFetcher,
  products: SignalProduct[],
  weeks: string[],
  now: Date,
): Promise<Pick<SignalCollectionResult, "wrote" | "skipped" | "errors">> {
  const writes: SignalWrite[] = [];
  const skipped: SignalCollectionResult["skipped"] = [];
  const errors: SourceFailure[] = [];
  const start = weeks[0]?.replaceAll("-", "") ?? "";
  const endDay = weeks.at(-1) ? shiftWeek(weeks.at(-1) as string, 1) : "";
  const end = endDate(endDay);
  for (const product of products) {
    const title = product.profile.wikipediaTitle;
    if (!title) {
      skipped.push({ slug: product.slug, source: "wikipedia", reason: "no dedicated article" });
      continue;
    }
    try {
      const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/${encodeURIComponent(title)}/daily/${start}/${end}`;
      const payload = await fetchJson(url, fetcher) as { items?: Array<{ timestamp?: string; views?: number }> };
      const totals = sumPageviewsByWeek(
        (payload.items ?? []).map((item) => ({ timestamp: String(item.timestamp ?? ""), views: Number(item.views ?? 0) })),
        weeks,
      );
      for (const [week, value] of totals) {
        writes.push({
          productId: product.id,
          week,
          source: "wikipedia",
          kind: "demand",
          value,
          meta: {
            article: title,
            estimated: product.profile.wikipediaEstimated,
            ...(product.profile.wikipediaEstimated ? { reason: "Wikipedia article is broader than this product" } : {}),
          },
        });
      }
    } catch (error) {
      errors.push({ source: `wikipedia:${product.slug}`, message: error instanceof Error ? error.message : "Wikipedia failed" });
    }
  }
  await writeSignals(db, writes, now);
  return { wrote: writes.length, skipped, errors };
}

async function collectHackerNews(
  db: D1Database,
  fetcher: SignalFetcher,
  products: SignalProduct[],
  weeks: string[],
  now: Date,
): Promise<Pick<SignalCollectionResult, "wrote" | "skipped" | "errors">> {
  const writes: SignalWrite[] = [];
  const errors: SourceFailure[] = [];
  const rangeStart = Math.floor(Date.parse(`${weeks[0]}T00:00:00.000Z`) / 1000);
  const rangeEnd = Math.floor(Date.parse(`${shiftWeek(weeks.at(-1) as string, 1)}T00:00:00.000Z`) / 1000);
  for (const product of products) {
    try {
      if (weeks.length === 1) {
        const count = await hackerNewsCount(product.profile.hnQuery, rangeStart, rangeEnd, fetcher);
        writes.push(hnWrite(product.id, weeks[0] as string, count.count, count.estimated, product.profile.hnQuery));
        continue;
      }
      const search = await hackerNewsSearch(product.profile.hnQuery, rangeStart, rangeEnd, fetcher);
      if (search.nbHits > search.createdAt.length) {
        errors.push({
          source: `hacker_news:${product.slug}`,
          message: `Hacker News returned ${search.nbHits} stories, above the ${search.createdAt.length} fetched`,
        });
        continue;
      }
      const totals = countHitsByWeek(search.createdAt, weeks);
      for (const [week, value] of totals) {
        writes.push(hnWrite(product.id, week, value, search.estimated, product.profile.hnQuery));
      }
    } catch (error) {
      errors.push({ source: `hacker_news:${product.slug}`, message: error instanceof Error ? error.message : "Hacker News failed" });
    }
  }
  await writeSignals(db, writes, now);
  return { wrote: writes.length, skipped: [], errors };
}

function hnWrite(productId: string, week: string, value: number, estimated: boolean, query: string): SignalWrite {
  return {
    productId,
    week,
    source: "hacker_news",
    kind: "demand",
    value,
    meta: { query, ...(estimated ? { estimated: true } : {}) },
  };
}

async function hackerNewsCount(query: string, start: number, end: number, fetcher: SignalFetcher) {
  const payload = await fetchJson(hackerNewsUrl(query, start, end, 0), fetcher) as {
    nbHits?: number;
    exhaustiveNbHits?: boolean;
  };
  if (typeof payload.nbHits !== "number") throw new Error("Hacker News did not return nbHits");
  return { count: payload.nbHits, estimated: payload.exhaustiveNbHits === false };
}

async function hackerNewsSearch(query: string, start: number, end: number, fetcher: SignalFetcher) {
  const payload = await fetchJson(hackerNewsUrl(query, start, end, 100), fetcher) as {
    nbHits?: number;
    exhaustiveNbHits?: boolean;
    hits?: Array<{ created_at_i?: number }>;
  };
  if (typeof payload.nbHits !== "number") throw new Error("Hacker News did not return nbHits");
  return {
    nbHits: payload.nbHits,
    estimated: payload.exhaustiveNbHits === false,
    createdAt: (payload.hits ?? []).map((hit) => Number(hit.created_at_i)).filter((value) => Number.isFinite(value)),
  };
}

function hackerNewsUrl(query: string, start: number, end: number, hitsPerPage: number): string {
  const filters = `created_at_i>=${start},created_at_i<${end}`;
  const fields = hitsPerPage === 0 ? "" : "&attributesToRetrieve=created_at_i";
  return `https://hn.algolia.com/api/v1/search?tags=story&hitsPerPage=${hitsPerPage}&query=${encodeURIComponent(query)}&numericFilters=${encodeURIComponent(filters)}${fields}`;
}

function messageCenterItems(payload: unknown): CatalogItem[] {
  if (!Array.isArray(payload)) throw new Error("Message Center index was not a list");
  return payload.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    return [{
      id: String(item.Id ?? ""),
      title: String(item.Title ?? ""),
      services: Array.isArray(item.Services) ? item.Services.map(String) : [],
      at: typeof item.LastModifiedDateTime === "string" ? item.LastModifiedDateTime : null,
      major: item.IsMajorChange === true,
    }];
  });
}

function roadmapItems(payload: unknown): CatalogItem[] {
  if (!Array.isArray(payload)) throw new Error("Roadmap feed was not a list");
  return payload.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    const tags = item.tagsContainer as { products?: Array<{ tagName?: string }> } | undefined;
    const modified = typeof item.modified === "string" ? item.modified : null;
    const created = typeof item.created === "string" ? item.created : null;
    return [{
      id: String(item.id ?? ""),
      title: String(item.title ?? ""),
      services: (tags?.products ?? []).map((tag) => String(tag.tagName ?? "")).filter(Boolean),
      at: modified ?? created,
      major: false,
    }];
  });
}

async function loadProducts(db: D1Database, slug: string | undefined, includeInactive: boolean): Promise<SignalProduct[]> {
  const where = slug
    ? "slug = ?"
    : includeInactive
      ? "1 = 1"
      : "is_active = 1 AND lifecycle_status = 'active'";
  const statement = db.prepare(`
    SELECT id, slug, name, aliases_json, source_config_json
    FROM products
    WHERE ${where}
    ORDER BY slug
  `);
  const { results } = slug
    ? await statement.bind(slug).all<ProductRow>()
    : await statement.all<ProductRow>();
  return results.map(toSignalProduct);
}

type ProductRow = {
  id: string;
  slug: string;
  name: string;
  aliases_json: string;
  source_config_json: string;
};

function toSignalProduct(row: ProductRow): SignalProduct {
  const aliases = parseJson<string[]>(row.aliases_json, []);
  const sourceConfig = parseJson<SourceConfig>(row.source_config_json, {});
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    profile: resolveSignalProfile({
      slug: row.slug,
      name: row.name,
      aliases: Array.isArray(aliases) ? aliases.filter((alias) => typeof alias === "string") : [],
      sourceConfig,
    }),
  };
}

async function writeSignals(db: D1Database, writes: SignalWrite[], now: Date): Promise<void> {
  const collectedAt = now.toISOString();
  for (let index = 0; index < writes.length; index += 20) {
    const chunk = writes.slice(index, index + 20);
    await db.batch(chunk.map((write) => db.prepare(UPSERT).bind(
      crypto.randomUUID(),
      write.productId,
      write.week,
      write.source,
      write.kind,
      write.value,
      JSON.stringify(write.meta),
      collectedAt,
    )));
  }
}

async function fetchJson(url: string, fetcher: SignalFetcher): Promise<unknown> {
  const headers = {
    Accept: "application/json",
    "User-Agent": USER_AGENT,
    "Api-User-Agent": USER_AGENT,
  };
  const cacheKey = new Request(url, { headers });
  const cache = await signalCache();
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit.json();
  }
  const response = await fetcher(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${new URL(url).hostname}`);
  const text = await response.text();
  if (cache) {
    await cache.put(cacheKey, new Response(text, {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": `public, max-age=${CACHE_SECONDS}`,
      },
    }));
  }
  return JSON.parse(text) as unknown;
}

async function signalCache(): Promise<Cache | null> {
  if (typeof caches === "undefined" || typeof caches.open !== "function") return null;
  return caches.open("m365-barometer-signals");
}

function externalKindError(source: string, kind: SignalKind): string | null {
  if (source === "x" && kind !== "demand") return "x counts are a demand signal";
  if (source === "youtube" && kind !== "supply") return "youtube counts are a supply signal";
  return null;
}

function metaEstimated(metaJson: string): boolean {
  const meta = parseJson<{ estimated?: boolean }>(metaJson, {});
  return meta.estimated === true;
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function endDate(nextWeekStart: string): string {
  const date = new Date(`${nextWeekStart}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}
