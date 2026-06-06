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

export const productInputSchema = z.object({
  name: z.string().min(2).max(100),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description: z.string().max(500).optional().default(""),
  analysisQuery: z.string().min(3).max(500),
  aliases: z.array(z.string().min(1).max(100)).max(20).default([]),
  sourceConfig: z.record(z.unknown()).default({}),
});

export type ProductInput = z.infer<typeof productInputSchema>;

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
