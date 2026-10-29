import { describe, expect, it } from "vitest";

import { MockVotingService, MOCK_QUESTION } from "./mock-service";
import { computeResults } from "./results";
import { VoteError } from "./types";

describe("computeResults", () => {
  it("reproduces the design sample: 248 responses → 26/22/16/14/12/10", () => {
    const r = computeResults([64, 55, 40, 35, 30, 24].map((count, i) => ({ optionId: `o${i}`, count })));
    expect(r.totalVotes).toBe(248);
    expect(r.results.map((x) => x.percent)).toEqual([26, 22, 16, 14, 12, 10]);
  });

  it("shows 0% everywhere with zero votes", () => {
    const r = computeResults([{ optionId: "a", count: 0 }, { optionId: "b", count: 0 }]);
    expect(r.results.map((x) => x.percent)).toEqual([0, 0]);
  });

  it("percentages always sum to 100", () => {
    const r = computeResults([1, 1, 1].map((count, i) => ({ optionId: `o${i}`, count })));
    expect(r.results.reduce((s, x) => s + x.percent, 0)).toBe(100);
  });
});

describe("MockVotingService", () => {
  const svc = () => new MockVotingService({ latencyMs: 0, seed: false });

  it("a retried submission with the same key counts once", async () => {
    const s = svc();
    const input = { questionId: MOCK_QUESTION.id, optionId: "opt-1", idempotencyKey: "k1" };
    await s.submitVote(input);
    await s.submitVote(input);
    expect((await s.getResults(MOCK_QUESTION.id)).totalVotes).toBe(1);
  });

  it("rejects an unknown option", async () => {
    await expect(
      svc().submitVote({ questionId: MOCK_QUESTION.id, optionId: "nope", idempotencyKey: "k2" }),
    ).rejects.toMatchObject({ code: "INVALID_OPTION" } satisfies Partial<VoteError>);
  });
});
