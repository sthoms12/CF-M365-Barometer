import { describe, expect, it } from "vitest";
import { buildEngineArgs, normalize, sourceDiagnostics } from "./collector.mjs";

describe("collector integration", () => {
  it("uses the full Last30Days retrieval profile", () => {
    const args = buildEngineArgs(
      "/engine.py",
      { product: { analysisQuery: "Teams Premium" }, subreddits: ["MicrosoftTeams", "Microsoft365"] },
      "/plan.json",
      {},
    );

    expect(args).not.toContain("--quick");
    expect(args).toContain("--days=30");
    expect(args).toContain("--subreddits");
    expect(args.at(-1)).toBe("MicrosoftTeams,Microsoft365");
  });

  it("reports raw, accepted, and failed source counts", () => {
    const report = {
      range_from: "2026-05-01T00:00:00.000Z",
      range_to: "2026-06-01T00:00:00.000Z",
      items_by_source: {
        reddit: [{ item_id: "r1", title: "Useful post", snippet: "Details", local_rank_score: 1 }],
        youtube: [{ item_id: "y1", title: "", snippet: "Missing title" }],
      },
      errors_by_source: { hackernews: "request failed" },
    };
    const payload = normalize(report);

    expect(sourceDiagnostics(report, payload)).toEqual({
      raw: { reddit: 1, youtube: 1 },
      accepted: { reddit: 1 },
      errors: { hackernews: "request failed" },
      acceptedTotal: 1,
    });
  });
});
