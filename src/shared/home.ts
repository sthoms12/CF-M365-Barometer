import type { ProductSummary } from "./contracts";

export const homeSectionOrder = [
  "heatingUp",
  "coolingOff",
  "highestScores",
  "lowestScores",
  "mostDiscussed",
  "recentlyAnalyzed",
] as const;

export type HomeSectionKey = (typeof homeSectionOrder)[number];
export type HomeSections = Record<HomeSectionKey, ProductSummary[]>;

export const homeSectionCopy: Record<HomeSectionKey, { title: string; description: string }> = {
  heatingUp: { title: "Heating Up", description: "Products gaining positive momentum." },
  coolingOff: { title: "Cooling Off", description: "Products losing positive momentum." },
  highestScores: { title: "Highest Scores", description: "The strongest current community readings." },
  lowestScores: { title: "Lowest Scores", description: "Products facing the most negative discussion." },
  mostDiscussed: { title: "Most Discussed", description: "The highest-volume conversations." },
  recentlyAnalyzed: { title: "Recently Analyzed", description: "The newest automated readings." },
};

const volumeRank = { "Very High": 4, High: 3, Medium: 2, Low: 1 } as const;

export function buildHomeSections(products: ProductSummary[]): HomeSections {
  const scored = products.filter((product) => product.snapshot);
  const byScore = [...scored].sort((a, b) => (b.snapshot?.barometerScore ?? 0) - (a.snapshot?.barometerScore ?? 0));
  const byMomentum = [...scored].sort((a, b) => (b.snapshot?.momentum ?? 0) - (a.snapshot?.momentum ?? 0));
  const byVolume = [...scored].sort((a, b) =>
    volumeRank[b.snapshot?.discussionVolume ?? "Low"] - volumeRank[a.snapshot?.discussionVolume ?? "Low"],
  );
  const recentlyAnalyzed = [...scored].sort((a, b) =>
    new Date(b.lastAnalyzedAt ?? 0).getTime() - new Date(a.lastAnalyzedAt ?? 0).getTime(),
  );
  return {
    heatingUp: byMomentum.filter((product) => (product.snapshot?.momentum ?? 0) > 0).slice(0, 5),
    coolingOff: [...byMomentum].reverse().filter((product) => (product.snapshot?.momentum ?? 0) < 0).slice(0, 5),
    highestScores: byScore.slice(0, 5),
    lowestScores: [...byScore].reverse().slice(0, 5),
    mostDiscussed: byVolume.slice(0, 5),
    recentlyAnalyzed: recentlyAnalyzed.slice(0, 5),
  };
}
