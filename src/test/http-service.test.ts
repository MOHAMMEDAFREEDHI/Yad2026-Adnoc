import { describe, expect, it, vi } from "vitest";

import { HttpVotingService } from "@/features/voting/http-service";

const json = (status: number, body: unknown = {}) =>
  Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
  );
const sub = { questionId: "q", optionId: "o", idempotencyKey: "k" };

describe("HttpVotingService", () => {
  it("posts votes with the idempotency key and cache: no-store to /api/votes", async () => {
    const f = vi.fn(() =>
      json(201, { voteId: "v", questionId: "q", answerOptionId: "o", acceptedAt: "t" }),
    );
    const s = new HttpVotingService("https://api.test/", f as unknown as typeof fetch);
    await s.submitVote(sub);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.test/api/votes");
    expect(init.cache).toBe("no-store");
    expect(init.credentials).toBe("include");
    expect(JSON.parse(init.body as string)).toEqual({
      questionId: "q",
      answerOptionId: "o",
      idempotencyKey: "k",
    });
  });

  it("maps HTTP 409 with ALREADY_VOTED error code to ALREADY_VOTED", async () => {
    const s = new HttpVotingService("https://api.test", (() =>
      json(409, {
        error: {
          code: "ALREADY_VOTED",
          message:
            "You've already voted! Your response has been successfully recorded. Thank you for participating.",
        },
      })) as unknown as typeof fetch);
    await expect(s.submitVote(sub)).rejects.toMatchObject({
      code: "ALREADY_VOTED",
      message:
        "You've already voted! Your response has been successfully recorded. Thank you for participating.",
    });
  });

  it("extracts hasVoted flag from active question payload", async () => {
    const s = new HttpVotingService("https://api.test", (() =>
      json(200, {
        event: { id: "e-1" },
        question: { id: "q-1", prompt: "Prompt", subtitle: "Sub" },
        options: [{ id: "opt-1", label: "L1", description: null, iconKey: "k1", displayOrder: 1 }],
        hasVoted: true,
      })) as unknown as typeof fetch);
    const q = await s.getActiveQuestion();
    expect(q.hasVoted).toBe(true);
  });

  it("maps HTTP 404 with QUESTION_UNAVAILABLE error code to QUESTION_UNAVAILABLE", async () => {
    const s = new HttpVotingService("https://api.test", (() =>
      json(404, {
        error: { code: "QUESTION_UNAVAILABLE", message: "No active voting question is available." },
      })) as unknown as typeof fetch);
    await expect(s.getActiveQuestion()).rejects.toMatchObject({ code: "QUESTION_UNAVAILABLE" });
  });

  it("maps unexpected HTTP 404 without QUESTION_UNAVAILABLE code to SERVER", async () => {
    const s = new HttpVotingService("https://api.test", (() =>
      Promise.resolve(
        new Response("Not Found", { status: 404, headers: { "Content-Type": "text/html" } }),
      )) as unknown as typeof fetch);
    await expect(s.getActiveQuestion()).rejects.toMatchObject({ code: "SERVER" });
  });

  it.each([
    [409, "DUPLICATE_VOTE"],
    [410, "POLL_CLOSED"],
    [422, "INVALID_OPTION"],
    [500, "SERVER"],
  ])("maps HTTP %i to %s", async (status, code) => {
    const s = new HttpVotingService("https://api.test", (() =>
      json(status)) as unknown as typeof fetch);
    await expect(s.submitVote(sub)).rejects.toMatchObject({ code });
  });

  it("maps a network interruption to NETWORK", async () => {
    const s = new HttpVotingService("https://api.test", (() =>
      Promise.reject(new TypeError("fail"))) as unknown as typeof fetch);
    await expect(s.getActiveQuestion()).rejects.toMatchObject({ code: "NETWORK" });
  });
});
