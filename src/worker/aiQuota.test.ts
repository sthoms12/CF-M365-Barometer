import { describe, expect, it } from "vitest";
import { isAiDailyQuotaError } from "./aiQuota";

describe("Workers AI quota detection", () => {
  it("recognizes daily allocation and neuron limit errors", () => {
    expect(isAiDailyQuotaError(new Error("Exceeded your daily allocation of 10,000 neurons"))).toBe(true);
    expect(isAiDailyQuotaError(new Error("Workers AI neuron quota exceeded"))).toBe(true);
    expect(isAiDailyQuotaError(new Error("Free tier daily limit reached"))).toBe(true);
    expect(isAiDailyQuotaError({ error: "Account has run out of free allocated usage for today" })).toBe(true);
  });

  it("does not classify unrelated AI failures as daily quota errors", () => {
    expect(isAiDailyQuotaError(new Error("Model returned invalid JSON"))).toBe(false);
    expect(isAiDailyQuotaError(new Error("Request timed out"))).toBe(false);
  });
});
