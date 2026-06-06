import type {
  Confidence,
  DiscussionVolume,
  EvidenceItem,
  Sentiment,
  SourceBreakdown,
  SourceCategory,
  Temperature,
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

export function calculateScore(sentiments: Sentiment[]): number {
  if (sentiments.length === 0) return 50;
  const positive = sentiments.filter((item) => item === "positive").length;
  const negative = sentiments.filter((item) => item === "negative").length;
  return Math.max(0, Math.min(100, Math.round(50 + 50 * ((positive - negative) / sentiments.length))));
}

export function calculateTemperature(score: number, momentum: number): Temperature {
  if (score >= 75) return "Hot";
  if (score <= 25) return "Cold";
  if (momentum >= 5) return "Warming";
  if (momentum <= -5) return "Cooling";
  return "Stable";
}

export function calculateVolume(count: number): DiscussionVolume {
  if (count >= 50) return "Very High";
  if (count >= 25) return "High";
  if (count >= 10) return "Medium";
  return "Low";
}

export function calculateConfidence(
  classifiedCount: number,
  categoryCount: number,
  failedConfiguredSources: number,
): Confidence {
  let index = classifiedCount >= 40 && categoryCount >= 4
    ? 0
    : classifiedCount >= 20 && categoryCount >= 3
      ? 1
      : classifiedCount >= 8 && categoryCount >= 2
        ? 2
        : 3;

  if (failedConfiguredSources >= 2) index = Math.min(3, index + 1);
  return (["Very High", "High", "Medium", "Low"] as const)[index];
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
