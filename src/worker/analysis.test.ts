import { describe, expect, it } from "vitest";
import { AI_ANALYSIS_MAX_TOKENS, analysisModelInput, parseAiAnalysisResponse } from "./analysis";

const response = {
  classifications: [{ id: "evidence-1", sentiment: "positive" }],
  summary: "Community sentiment is positive.",
  positiveSignals: ["Useful improvements"],
  negativeSignals: [],
};

describe("Workers AI response parsing", () => {
  it("accepts structured JSON responses", () => {
    expect(parseAiAnalysisResponse(response)).toEqual(response);
  });

  it("accepts JSON string responses", () => {
    expect(parseAiAnalysisResponse(JSON.stringify(response))).toEqual(response);
  });

  it("rejects missing responses", () => {
    expect(() => parseAiAnalysisResponse(undefined)).toThrow("Workers AI returned no response");
  });

  it("requests enough tokens for 60 compact per-item classifications", () => {
    const evidence = Array.from({ length: 60 }, (_, index) => ({
      id: `evidence-${index}`,
      source: "reddit",
      title: "Thread title",
      excerpt: "A long user comment that must not be copied into the model output.",
      rank: index,
    }));
    const input = analysisModelInput("Microsoft 365 Copilot", evidence);

    expect(input.max_tokens).toBe(AI_ANALYSIS_MAX_TOKENS);
    expect(input.max_tokens).toBeGreaterThanOrEqual(2048);
    expect(input.max_tokens).toBeLessThanOrEqual(4096);
    expect(input.messages[0].content).toContain("only its original id and sentiment");
    expect(input.messages[0].content).toContain("evidence-59");
    expect(input.response_format.json_schema.schema.properties.classifications.items.properties).toEqual({
      id: { type: "string" },
      sentiment: { type: "string", enum: ["positive", "neutral", "negative"] },
    });

    const worstCase = JSON.stringify({
      classifications: Array.from({ length: 60 }, () => ({ id: "i".repeat(120), sentiment: "negative" })),
      summary: "s".repeat(800),
      positiveSignals: Array.from({ length: 5 }, () => "p".repeat(240)),
      negativeSignals: Array.from({ length: 5 }, () => "n".repeat(240)),
    });
    expect(Math.ceil(worstCase.length / 4)).toBeLessThanOrEqual(AI_ANALYSIS_MAX_TOKENS);
  });
});
