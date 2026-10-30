import { describe, expect, it, vi } from "vitest";

import { HttpVotingService } from "@/features/voting/http-service";

const json = (status: number, body: unknown = {}) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
const sub = { questionId: "q", optionId: "o", idempotencyKey: "k" };

describe("HttpVotingService", () => {
  it("posts votes with the idempotency key to /api/votes", async () => {
    const f = vi.fn(() => json(201, { voteId: "v", questionId: "q", optionId: "o", acceptedAt: "t" }));
    const s = new HttpVotingService("https://api.test/", f as unknown as typeof fetch);
    await s.submitVote(sub);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.test/api/votes");
    expect(JSON.parse(init.body as string)).toEqual(sub);
  });

  it.each([
    [404, "QUESTION_UNAVAILABLE"],
    [409, "DUPLICATE_VOTE"],
    [410, "POLL_CLOSED"],
    [422, "INVALID_OPTION"],
    [500, "SERVER"],
  ])("maps HTTP %i to %s", async (status, code) => {
    const s = new HttpVotingService("https://api.test", (() => json(status)) as unknown as typeof fetch);
    await expect(s.submitVote(sub)).rejects.toMatchObject({ code });
  });

  it("maps a network interruption to NETWORK", async () => {
    const s = new HttpVotingService("https://api.test", (() => Promise.reject(new TypeError("fail"))) as unknown as typeof fetch);
    await expect(s.getActiveQuestion()).rejects.toMatchObject({ code: "NETWORK" });
  });
});
