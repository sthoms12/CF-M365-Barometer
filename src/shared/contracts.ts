import { z } from "zod";

export const temperatures = ["Hot", "Warming", "Stable", "Cooling", "Cold"] as const;
export const confidenceLevels = ["Very High", "High", "Medium", "Low"] as const;
export const volumeLevels = ["Very High", "High", "Medium", "Low"] as const;
export const sentiments = ["positive", "neutral", "negative"] as const;
export const sourceCategories = ["reddit", "x", "blogs", "forums", "youtube", "other"] as const;

export type Temperature = (typeof temperatures)[number];
export type Confidence = (typeof confidenceLevels)[number];
export type DiscussionVolume = (typeof volumeLevels)[number];
export type Sentiment = (typeof sentiments)[number];
export type SourceCategory = (typeof sourceCategories)[number];

export const sourceStatusSchema = z.record(
  z.enum(["available", "unavailable", "failed", "returned_zero"]),
);

export const evidenceItemSchema = z.object({
  id: z.string().min(1).max(120),
  source: z.string().min(1).max(40),
  title: z.string().min(1).max(300),
  url: z.string().url().optional(),
  excerpt: z.string().min(1).max(1000),
  publishedAt: z.string().datetime().optional(),
  rank: z.number().nonnegative(),
});

export type EvidenceItem = z.infer<typeof evidenceItemSchema>;

export const ingestPayloadSchema = z.object({
  collectorVersion: z.string().min(1).max(80),
  windowStart: z.string().datetime(),
  windowEnd: z.string().datetime(),
  sourceStatus: sourceStatusSchema,
  evidence: z.array(evidenceItemSchema).min(1).max(60),
});

export type IngestPayload = z.infer<typeof ingestPayloadSchema>;

export const aiAnalysisSchema = z.object({
  classifications: z.array(
    z.object({
      id: z.string(),
      sentiment: z.enum(sentiments),
    }),
  ),
  summary: z.string().min(1).max(800),
  positiveSignals: z.array(z.string().min(1).max(240)).max(5),
  negativeSignals: z.array(z.string().min(1).max(240)).max(5),
});

export type AiAnalysis = z.infer<typeof aiAnalysisSchema>;

export type SourceBreakdown = Record<SourceCategory, number>;

export type Last30DaysResult = {
  productName: string;
  barometerScore: number;
  temperature: Temperature;
  momentum: number;
  confidence: Confidence;
  discussionVolume: DiscussionVolume;
  summary: string;
  positiveSignals: string[];
  negativeSignals: string[];
  sourceBreakdown: SourceBreakdown;
  sampleMentions: Array<{
    sourceType: string;
    sourceTitle: string;
    sourceUrl?: string;
    sentiment: Sentiment;
    excerpt: string;
  }>;
};

export type SignalLabel = "Hot" | "Neutral" | "Cold";
export type SignalConfidence = "Low" | "Medium" | "High" | "not enough data";

export type SupplyDemandIndex = {
  index: number;
  raw: number;
  weeks: number;
  estimated: boolean;
};

export type SupplyDemandScore = {
  week: string | null;
  supply: SupplyDemandIndex | null;
  demand: SupplyDemandIndex | null;
  gap: number | null;
  momentum: number | null;
  label: SignalLabel | null;
  confidence: SignalConfidence;
  sources: number;
  status: "ok" | "not_enough_data";
  estimated: boolean;
  pendingSources: Array<{ source: string; weeks: number }>;
};

export const externalSignalSources = ["x", "youtube", "tech_community"] as const;

/**
 * Ceiling for one external weekly count. The external sources are item
 * counts (posts, videos, threads) for a single product-week; even a viral
 * week stays orders of magnitude below this, while the cap keeps a bad bot
 * report from overflowing weekly totals or pinning absurd magnitudes into
 * stored history. (The one larger-magnitude source, Wikipedia pageviews,
 * is collected server-side and never flows through this schema.)
 */
export const MAX_EXTERNAL_SIGNAL_VALUE = 1_000_000;

/** Hard gate for bot-supplied meta: at most 32 keys and 4 KB serialized. */
export const MAX_EXTERNAL_META_KEYS = 32;
export const MAX_EXTERNAL_META_BYTES = 4_096;

export const externalSignalSchema = z.object({
  signals: z.array(z.object({
    productSlug: z.string().trim().min(1).max(80),
    week: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    source: z.enum(externalSignalSources),
    kind: z.enum(["supply", "demand"]),
    value: z.number().finite().nonnegative().max(MAX_EXTERNAL_SIGNAL_VALUE),
    estimated: z.boolean().optional(),
    meta: z.record(z.unknown()).refine(
      (meta) => Object.keys(meta).length <= MAX_EXTERNAL_META_KEYS
        && JSON.stringify(meta).length <= MAX_EXTERNAL_META_BYTES,
      { message: "meta must have at most 32 keys and serialize to at most 4 KB" },
    ).optional(),
  })).min(1).max(200),
});

export type ExternalSignalInput = z.infer<typeof externalSignalSchema>;

export type ProductSummary = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  isActive: boolean;
  nextAnalysisAt: string | null;
  lastAnalyzedAt: string | null;
  snapshot: SnapshotSummary | null;
  isStale: boolean;
  lifecycleStatus?: "draft" | "ready" | "active" | "archived";
  supplyDemand?: SupplyDemandScore;
};

export type SnapshotSummary = {
  id: string;
  analyzedAt: string;
  barometerScore: number;
  temperature: Temperature;
  momentum: number;
  confidence: Confidence;
  discussionVolume: DiscussionVolume;
  summary: string;
  positiveSignals: string[];
  negativeSignals: string[];
  sourceBreakdown: SourceBreakdown;
  sourceStatus: Record<string, string>;
};
