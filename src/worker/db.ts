import type { ProductInput, ProductSummary, SnapshotSummary } from "../shared/contracts";

type ProductRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  analysis_query: string;
  aliases_json: string;
  source_config_json: string;
  is_active: number;
  next_analysis_at: string | null;
  last_analyzed_at: string | null;
};

type SnapshotRow = {
  id: string;
  analyzed_at: string;
  barometer_score: number;
  temperature: SnapshotSummary["temperature"];
  momentum: number;
  confidence: SnapshotSummary["confidence"];
  discussion_volume: SnapshotSummary["discussionVolume"];
  summary: string;
  positive_signals_json: string;
  negative_signals_json: string;
  source_breakdown_json: string;
  source_status_json: string;
};

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function mapSnapshot(row: SnapshotRow | null): SnapshotSummary | null {
  if (!row) return null;
  return {
    id: row.id,
    analyzedAt: row.analyzed_at,
    barometerScore: row.barometer_score,
    temperature: row.temperature,
    momentum: row.momentum,
    confidence: row.confidence,
    discussionVolume: row.discussion_volume,
    summary: row.summary,
    positiveSignals: parseJson(row.positive_signals_json, []),
    negativeSignals: parseJson(row.negative_signals_json, []),
    sourceBreakdown: parseJson(row.source_breakdown_json, {
      reddit: 0, x: 0, blogs: 0, forums: 0, youtube: 0, other: 0,
    }),
    sourceStatus: parseJson(row.source_status_json, {}),
  };
}

export async function getProducts(db: D1Database, includeInactive = false): Promise<ProductSummary[]> {
  const where = includeInactive ? "" : "WHERE p.is_active = 1";
  const { results } = await db.prepare(`
    SELECT p.*,
      s.id AS snapshot_id, s.analyzed_at, s.barometer_score, s.temperature, s.momentum,
      s.confidence, s.discussion_volume, s.summary, s.positive_signals_json,
      s.negative_signals_json, s.source_breakdown_json, s.source_status_json
    FROM products p
    LEFT JOIN sentiment_snapshots s ON s.id = (
      SELECT id FROM sentiment_snapshots
      WHERE product_id = p.id ORDER BY analyzed_at DESC LIMIT 1
    )
    ${where}
    ORDER BY p.name
  `).all<ProductRow & SnapshotRow & { snapshot_id: string | null }>();

  return results.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    isActive: row.is_active === 1,
    nextAnalysisAt: row.next_analysis_at,
    lastAnalyzedAt: row.last_analyzed_at,
    snapshot: row.snapshot_id ? mapSnapshot({ ...row, id: row.snapshot_id }) : null,
    isStale: isStale(row.last_analyzed_at),
  }));
}

export async function getAdminProducts(db: D1Database) {
  const [products, configs] = await Promise.all([
    getProducts(db, true),
    db.prepare(`
      SELECT id, analysis_query, aliases_json, source_config_json FROM products ORDER BY name
    `).all<{ id: string; analysis_query: string; aliases_json: string; source_config_json: string }>(),
  ]);
  const configById = new Map(configs.results.map((row) => [row.id, row]));
  return products.map((product) => {
    const config = configById.get(product.id);
    return {
      ...product,
      analysisQuery: config?.analysis_query ?? "",
      aliases: parseJson(config?.aliases_json ?? "[]", [] as string[]),
      sourceConfig: parseJson(config?.source_config_json ?? "{}", {} as Record<string, unknown>),
    };
  });
}

export async function getProductBySlug(db: D1Database, slug: string): Promise<ProductSummary | null> {
  return (await getProducts(db, false)).find((product) => product.slug === slug) ?? null;
}

export async function getProductRow(db: D1Database, id: string): Promise<ProductRow | null> {
  return db.prepare("SELECT * FROM products WHERE id = ?").bind(id).first<ProductRow>();
}

export async function getDueProducts(db: D1Database, limit: number): Promise<ProductRow[]> {
  const { results } = await db.prepare(`
    SELECT * FROM products
    WHERE is_active = 1 AND (next_analysis_at IS NULL OR next_analysis_at <= datetime('now'))
    ORDER BY COALESCE(next_analysis_at, '1970-01-01') ASC
    LIMIT ?
  `).bind(limit).all<ProductRow>();
  return results;
}

export async function getPreviousScore(db: D1Database, productId: string): Promise<number | null> {
  const row = await db.prepare(`
    SELECT barometer_score FROM sentiment_snapshots
    WHERE product_id = ? ORDER BY analyzed_at DESC LIMIT 1
  `).bind(productId).first<{ barometer_score: number }>();
  return row?.barometer_score ?? null;
}

export async function createProduct(db: D1Database, input: ProductInput): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.prepare(`
    INSERT INTO products (
      id, slug, name, description, analysis_query, aliases_json, source_config_json,
      is_active, next_analysis_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
  `).bind(
    id, input.slug, input.name, input.description, input.analysisQuery,
    JSON.stringify(input.aliases), JSON.stringify(input.sourceConfig), now, now, now,
  ).run();
  return id;
}

export async function updateProduct(db: D1Database, id: string, input: ProductInput): Promise<void> {
  await db.prepare(`
    UPDATE products SET slug = ?, name = ?, description = ?, analysis_query = ?,
      aliases_json = ?, source_config_json = ?, updated_at = ? WHERE id = ?
  `).bind(
    input.slug, input.name, input.description, input.analysisQuery,
    JSON.stringify(input.aliases), JSON.stringify(input.sourceConfig), new Date().toISOString(), id,
  ).run();
}

export async function setProductActive(db: D1Database, id: string, active: boolean): Promise<void> {
  await db.prepare(`
    UPDATE products SET is_active = ?, next_analysis_at = CASE WHEN ? = 1 THEN datetime('now') ELSE next_analysis_at END,
      updated_at = datetime('now') WHERE id = ?
  `).bind(active ? 1 : 0, active ? 1 : 0, id).run();
}

export async function getHistory(db: D1Database, productId: string, days: number) {
  const { results } = await db.prepare(`
    SELECT analyzed_at AS analyzedAt, barometer_score AS barometerScore,
      momentum, temperature, discussion_volume AS discussionVolume
    FROM sentiment_snapshots
    WHERE product_id = ? AND analyzed_at >= datetime('now', ?)
    ORDER BY analyzed_at ASC
  `).bind(productId, `-${days} days`).all();
  return results;
}

export async function getMentions(db: D1Database, snapshotId: string) {
  const { results } = await db.prepare(`
    SELECT source_type AS sourceType, source_title AS sourceTitle, source_url AS sourceUrl,
      sentiment, excerpt, published_at AS publishedAt
    FROM source_mentions WHERE snapshot_id = ? ORDER BY source_rank
  `).bind(snapshotId).all();
  return results;
}

export function isStale(lastAnalyzedAt: string | null): boolean {
  if (!lastAnalyzedAt) return true;
  return Date.now() - new Date(lastAnalyzedAt).getTime() > 10 * 24 * 60 * 60 * 1000;
}
