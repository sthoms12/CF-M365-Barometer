import { describe, expect, it } from "vitest";
import {
  calculateConfidence,
  calculateScore,
  calculateTemperature,
  calculateVolume,
  selectSampleMentions,
  sourceBreakdown,
} from "./metrics";
import type { EvidenceItem, Sentiment } from "../shared/contracts";

describe("barometer metrics", () => {
  it("calculates sentiment score and clamps it", () => {
    expect(calculateScore(["positive", "positive", "negative", "neutral"])).toBe(63);
    expect(calculateScore(["positive"])).toBe(100);
    expect(calculateScore(["negative"])).toBe(0);
    expect(calculateScore([])).toBe(50);
  });

  it("applies temperature precedence", () => {
    expect(calculateTemperature(80, -10)).toBe("Hot");
    expect(calculateTemperature(20, 10)).toBe("Cold");
    expect(calculateTemperature(60, 5)).toBe("Warming");
    expect(calculateTemperature(60, -5)).toBe("Cooling");
    expect(calculateTemperature(60, 4)).toBe("Stable");
  });

  it("calculates volume and confidence boundaries", () => {
    expect(calculateVolume(50)).toBe("Very High");
    expect(calculateVolume(25)).toBe("High");
    expect(calculateVolume(10)).toBe("Medium");
    expect(calculateVolume(9)).toBe("Low");
    expect(calculateConfidence(40, 4, 0)).toBe("Very High");
    expect(calculateConfidence(40, 4, 2)).toBe("High");
    expect(calculateConfidence(8, 2, 0)).toBe("Medium");
  });

  it("maps source breakdown and diversifies samples", () => {
    const evidence: Array<EvidenceItem & { sentiment: Sentiment }> = [
      ...Array.from({ length: 8 }, (_, index) => ({
        id: `r${index}`, source: "reddit", title: "Reddit", excerpt: "x", rank: index, sentiment: "neutral" as const,
      })),
      ...Array.from({ length: 4 }, (_, index) => ({
        id: `y${index}`, source: "youtube", title: "YouTube", excerpt: "x", rank: index + 10, sentiment: "positive" as const,
      })),
    ];
    expect(sourceBreakdown(evidence).reddit).toBe(8);
    expect(selectSampleMentions(evidence)).toHaveLength(6);
  });
});
