import { describe, expect, it } from "vitest";
import { parseAiAnalysisResponse } from "./analysis";

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
});
