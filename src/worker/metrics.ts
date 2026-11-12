import {
  confidenceLevels,
  type Confidence,
  type DiscussionVolume,
  type EvidenceItem,
  type Sentiment,
  type SourceBreakdown,
  type SourceCategory,
  type Temperature,
} from "../shared/contracts";

export const SOURCE_CATEGORY_MAP: Record<string, SourceCategory> = {
  reddit: "reddit",
  x: "x",
  twitter: "x",
  blog: "blogs",
  blogs: "blogs",
  web: "blogs",
  forum: "forums",
  forums: "forums",
  hackernews: "forums",
  hn: "forums",
  youtube: "youtube",
  github: "other",
  bluesky: "other",
  threads: "other",
  tiktok: "other",
  instagram: "other",
  polymarket: "other",
  other: "other",
};

export function sourceCategory(source: string): SourceCategory {
  return SOURCE_CATEGORY_MAP[source.toLowerCase()] ?? "other";
}

export function sourceBreakdown(evidence: EvidenceItem[]): SourceBreakdown {
  const result: SourceBreakdown = {
    reddit: 0,
    x: 0,
    blogs: 0,
    forums: 0,
    youtube: 0,
    other: 0,
  };
  for (const item of evidence) result[sourceCategory(item.source)] += 1;
  return result;
}

/** Empty input, and the origin of the 0–100 sentiment score. */
export const SENTIMENT_SCORE_MIDPOINT = 50;
export const TEMPERATURE_HOT_AT = 75;
export const TEMPERATURE_COLD_AT = 25;
export const TEMPERATURE_WARMING_AT = 5;
export const TEMPERATURE_COOLING_AT = -5;
export const VOLUME_VERY_HIGH_AT = 50;
export const VOLUME_HIGH_AT = 25;
export const VOLUME_MEDIUM_AT = 10;
export const CONFIDENCE_VERY_HIGH_ITEMS = 40;
export const CONFIDENCE_VERY_HIGH_CATEGORIES = 4;
export const CONFIDENCE_HIGH_ITEMS = 20;
export const CONFIDENCE_HIGH_CATEGORIES = 3;
export const CONFIDENCE_MEDIUM_ITEMS = 8;
export const CONFIDENCE_MEDIUM_CATEGORIES = 2;
/** This many failed configured sources lowers confidence one step. */
export const CONFIDENCE_FAILURES_BEFORE_DROP = 2;

export function calculateScore(sentiments: Sentiment[]): number {
  if (sentiments.length === 0) return SENTIMENT_SCORE_MIDPOINT;
  const positive = sentiments.filter((item) => item === "positive").length;
  const negative = sentiments.filter((item) => item === "negative").length;
  const midpoint = SENTIMENT_SCORE_MIDPOINT;
  return Math.max(0, Math.min(100, Math.round(midpoint + midpoint * ((positive - negative) / sentiments.length))));
}

export function calculateTemperature(score: number, momentum: number): Temperature {
  if (score >= TEMPERATURE_HOT_AT) return "Hot";
  if (score <= TEMPERATURE_COLD_AT) return "Cold";
  if (momentum >= TEMPERATURE_WARMING_AT) return "Warming";
  if (momentum <= TEMPERATURE_COOLING_AT) return "Cooling";
  return "Stable";
}

export function calculateVolume(count: number): DiscussionVolume {
  if (count >= VOLUME_VERY_HIGH_AT) return "Very High";
  if (count >= VOLUME_HIGH_AT) return "High";
  if (count >= VOLUME_MEDIUM_AT) return "Medium";
  return "Low";
}

export function calculateConfidence(
  classifiedCount: number,
  categoryCount: number,
  failedConfiguredSources: number,
): Confidence {
  let index = classifiedCount >= CONFIDENCE_VERY_HIGH_ITEMS && categoryCount >= CONFIDENCE_VERY_HIGH_CATEGORIES
    ? 0
    : classifiedCount >= CONFIDENCE_HIGH_ITEMS && categoryCount >= CONFIDENCE_HIGH_CATEGORIES
      ? 1
      : classifiedCount >= CONFIDENCE_MEDIUM_ITEMS && categoryCount >= CONFIDENCE_MEDIUM_CATEGORIES
        ? 2
        : 3;

  if (failedConfiguredSources >= CONFIDENCE_FAILURES_BEFORE_DROP) index = Math.min(3, index + 1);
  return confidenceLevels[index];
}

export function selectSampleMentions<T extends EvidenceItem & { sentiment: Sentiment }>(
  evidence: T[],
  limit = 10,
): T[] {
  const selected: T[] = [];
  const categoryCounts = new Map<SourceCategory, number>();
  const sorted = [...evidence].sort((a, b) => a.rank - b.rank);

  while (selected.length < limit) {
    const next = sorted.find((item) => {
      if (selected.includes(item)) return false;
      return (categoryCounts.get(sourceCategory(item.source)) ?? 0) < 3;
    });
    if (!next) break;
    selected.push(next);
    const category = sourceCategory(next.source);
    categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
  }

  return selected;
}
