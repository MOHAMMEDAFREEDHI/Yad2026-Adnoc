// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";

import type { Db } from "@/server/db";
import {
  _resetRateLimits,
  handleActiveQuestion,
  handleResults,
  handleVote,
} from "@/server/handlers";

/** In-memory stand-in that mimics the SQL semantics used by the repository (incl. UNIQUE key and rollback). */
const ID = {
  q: "11111111-1111-4111-8111-111111111111",
  q2: "22222222-2222-4222-8222-222222222222",
  o: Array.from({ length: 6 }, (_, i) => `aaaaaaaa-aaaa-4aaa-8aaa-00000000000${i + 1}`),
  other: "bbbbbbbb-bbbb-4bbb-8bbb-000000000001", // belongs to q2
};
interface State {
  eStatus: string;
  qStatus: string;
  votes: { id: string; q: string; o: string; k: string; at: Date }[];
  participations: { id: string; eventId: string; visitorIdHash: string; answerOptionId?: string }[];
  fail?: boolean;
}
function fakeDb(s: State): Db {
  const exec = async (sql: string, p: unknown[] = []) => {
    if (s.fail) throw new Error("connection terminated (secret-host.rds.amazonaws.com)");
    if (sql.includes("FROM votes WHERE idempotency_key")) {
      const v = s.votes.find((x) => x.k === p[0]);
      return {
        rows: v ? [{ id: v.id, question_id: v.q, answer_option_id: v.o, submitted_at: v.at }] : [],
      };
    }
    if (sql.includes("q.status AS q_status")) {
      return {
        rows: p[0] === ID.q ? [{ event_id: "e1", q_status: s.qStatus, e_status: s.eStatus }] : [],
      };
    }
    if (sql.includes("FROM answer_options WHERE id = $1")) {
      return { rows: p[1] === ID.q && ID.o.includes(p[0] as string) ? [{ "?column?": 1 }] : [] };
    }
    if (sql.includes("FROM event_participations")) {
      const part = s.participations.find((x) => x.eventId === p[0] && x.visitorIdHash === p[1]);
      if (!part) return { rows: [] };
      return {
        rows: [
          {
            answer_option_id: part.answerOptionId ?? ID.o[0],
            label: "Option 1",
            description: "Desc",
            image_url: null,
            icon_key: "business-owner",
            display_order: 1,
          },
        ],
      };
    }
    if (sql.startsWith("INSERT INTO event_participations")) {
      if (s.participations.some((x) => x.eventId === p[0] && x.visitorIdHash === p[1])) {
        return { rows: [] };
      }
      const ep = {
        id: `ep-${s.participations.length + 1}`,
        eventId: p[0] as string,
        visitorIdHash: p[1] as string,
        answerOptionId: p[2] as string | undefined,
      };
      s.participations.push(ep);
      return { rows: [{ id: ep.id }] };
    }
    if (sql.startsWith("INSERT INTO votes")) {
      if (s.votes.some((x) => x.k === p[2])) return { rows: [] };
      const v = {
        id: `v-${s.votes.length + 1}`,
        q: p[0] as string,
        o: p[1] as string,
        k: p[2] as string,
        at: new Date(),
      };
      s.votes.push(v);
      return { rows: [{ id: v.id, submitted_at: v.at }] };
    }
    if (sql.includes("FROM questions WHERE id = $1"))
      return { rows: p[0] === ID.q ? [{ x: 1 }] : [] };
    if (sql.includes("COUNT(v.id)")) {
      return {
        rows: ID.o.map((id, i) => ({
          id,
          label: `Option ${i + 1}`,
          vote_count: String(s.votes.filter((v) => v.o === id).length),
        })),
      };
    }
    if (sql.includes("FROM questions q JOIN events e ON e.id = q.event_id")) {
      return s.eStatus === "open" && s.qStatus === "active"
        ? {
            rows: [
              {
                event_id: "e1",
                event_name: "ADIPEC 2026",
                event_slug: "adipec-2026",
                id: ID.q,
                prompt: "P",
                subtitle: "S",
                status: "active",
              },
            ],
          }
        : { rows: [] };
    }
    if (sql.includes("FROM answer_options WHERE question_id = $1 AND is_active")) {
      return {
        rows: ID.o.map((id, i) => ({
          id,
          label: `Option ${i + 1}`,
          description: "d",
          image_url: null,
          icon_key: "k",
          display_order: i + 1,
        })),
      };
    }
    throw new Error(`unexpected SQL: ${sql}`);
  };
  return {
    query: exec as Db["query"],
    async transaction(fn) {
      const snapVotes = [...s.votes];
      const snapPart = [...s.participations];
      try {
        return await fn({ query: exec as Db["query"] });
      } catch (e) {
        s.votes = snapVotes; // rollback
        s.participations = snapPart;
        throw e;
      }
    },
  };
}

const post = (body: unknown, cookie?: string) =>
  new Request("http://x/api/votes", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: {
      "x-forwarded-for": "1.1.1.1",
      ...(cookie ? { cookie } : {}),
    },
  });
const key = (n: number) => `cccccccc-cccc-4ccc-8ccc-${String(n).padStart(12, "0")}`;
const vote = (o = ID.o[0]!, k = key(1), q = ID.q) => ({
  questionId: q,
  answerOptionId: o,
  idempotencyKey: k,
});

let s: State;
beforeEach(() => {
  _resetRateLimits();
  s = { eStatus: "open", qStatus: "active", votes: [], participations: [] };
});

describe("GET /api/questions/active", () => {
  it("returns the event, question and all six ordered options", async () => {
    const res = await handleActiveQuestion(new Request("http://x/api/questions/active"), fakeDb(s));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.options).toHaveLength(6);
    expect(body.options.map((o: { displayOrder: number }) => o.displayOrder)).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
    expect(body.question.id).toBe(ID.q);
    expect(body.hasVoted).toBe(false);
    expect(res.headers.get("set-cookie")).toContain("adnoc_vid=");
    expect(res.headers.get("set-cookie")).toContain("HttpOnly");
    expect(res.headers.get("set-cookie")).toContain("SameSite=Lax");
  });
  it("detects subsequent visit using the same browser cookie and returns hasVoted: true", async () => {
    const vid = "11111111-2222-3333-4444-555555555555";
    const db = fakeDb(s);
    // Vote first using this visitor ID
    const voteRes = await handleVote(post(vote(ID.o[0], key(1)), `adnoc_vid=${vid}`), db);
    expect(voteRes.status).toBe(201);

    // Subsequent visit using same cookie
    const req = new Request("http://x/api/questions/active", {
      headers: { cookie: `adnoc_vid=${vid}` },
    });
    const res = await handleActiveQuestion(req, db);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hasVoted).toBe(true);
  });
  it("404s clearly (no fabrication) when nothing is open", async () => {
    s.qStatus = "closed";
    const res = await handleActiveQuestion(new Request("http://x/api/questions/active"), fakeDb(s));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("QUESTION_UNAVAILABLE");
  });
});

describe("POST /api/votes", () => {
  it("persists an accepted vote and returns 201", async () => {
    const res = await handleVote(post(vote()), fakeDb(s));
    expect(res.status).toBe(201);
    expect(s.votes).toHaveLength(1);
  });
  it("rejects malformed bodies / non-UUIDs with 4xx and stores nothing", async () => {
    expect((await handleVote(post("not json"), fakeDb(s))).status).toBe(400);
    expect((await handleVote(post({ ...vote(), questionId: "nope" }), fakeDb(s))).status).toBe(422);
    expect((await handleVote(post({ questionId: ID.q }), fakeDb(s))).status).toBe(422);
    expect(s.votes).toHaveLength(0);
  });
  it("404 for unknown question; 422 for answer from another question", async () => {
    expect((await handleVote(post(vote(ID.o[0], key(2), ID.q2)), fakeDb(s))).status).toBe(404);
    expect((await handleVote(post(vote(ID.other, key(3))), fakeDb(s))).status).toBe(422);
    expect(s.votes).toHaveLength(0);
  });
  it("410 when the question or event is not open", async () => {
    s.qStatus = "closed";
    expect((await handleVote(post(vote()), fakeDb(s))).status).toBe(410);
    s.qStatus = "active";
    s.eStatus = "closed";
    expect((await handleVote(post(vote()), fakeDb(s))).status).toBe(410);
    expect(s.votes).toHaveLength(0);
  });
  it("a retried idempotency key counts once and returns 200", async () => {
    const db = fakeDb(s);
    expect((await handleVote(post(vote()), db)).status).toBe(201);
    const again = await handleVote(post(vote()), db);
    expect(again.status).toBe(200);
    expect(s.votes).toHaveLength(1);
  });
  it("same key with a different option is a 409 conflict", async () => {
    const db = fakeDb(s);
    await handleVote(post(vote(ID.o[0])), db);
    const res = await handleVote(post(vote(ID.o[1])), db);
    expect(res.status).toBe(409);
    expect(s.votes).toHaveLength(1);
  });
  it("rejects a second vote from the same visitor profile with HTTP 409 and code ALREADY_VOTED", async () => {
    const db = fakeDb(s);
    const vidCookie = "adnoc_vid=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    // First vote: accepted (201)
    const first = await handleVote(post(vote(ID.o[0], key(1)), vidCookie), db);
    expect(first.status).toBe(201);
    expect(s.votes).toHaveLength(1);
    expect(s.participations).toHaveLength(1);

    // Second vote with new idempotency key from same browser profile: rejected (409)
    const second = await handleVote(post(vote(ID.o[1], key(2)), vidCookie), db);
    expect(second.status).toBe(409);
    const body = await second.json();
    expect(body.error.code).toBe("ALREADY_VOTED");
    expect(body.error.message).toBe(
      "You've already voted! Your response has been successfully recorded. Thank you for participating.",
    );
    expect(s.votes).toHaveLength(1); // No second vote row was inserted
  });
  it("allows distinct visitors to submit independent votes", async () => {
    const db = fakeDb(s);
    const vid1 = "adnoc_vid=11111111-1111-4111-8111-111111111111";
    const vid2 = "adnoc_vid=22222222-2222-4222-8222-222222222222";

    const v1 = await handleVote(post(vote(ID.o[0], key(1)), vid1), db);
    expect(v1.status).toBe(201);

    const v2 = await handleVote(post(vote(ID.o[1], key(2)), vid2), db);
    expect(v2.status).toBe(201);

    expect(s.votes).toHaveLength(2);
    expect(s.participations).toHaveLength(2);
  });
  it("sets HttpOnly, SameSite=Lax visitor cookie header if request had no cookie", async () => {
    const db = fakeDb(s);
    const res = await handleVote(post(vote(ID.o[0], key(1))), db);
    expect(res.status).toBe(201);
    expect(res.headers.get("set-cookie")).toContain("adnoc_vid=");
    expect(res.headers.get("set-cookie")).toContain("HttpOnly");
    expect(res.headers.get("set-cookie")).toContain("SameSite=Lax");
  });
  it("database failure -> generic 500 with no internals leaked, nothing stored", async () => {
    s.fail = true;
    const res = await handleVote(post(vote()), fakeDb(s));
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(text).not.toMatch(/secret-host|rds\.amazonaws|terminated/);
    expect(s.votes).toHaveLength(0);
  });
  it("rate limits a single IP", async () => {
    const db = fakeDb(s);
    let last = 0;
    for (let i = 0; i < 31; i++)
      last = (await handleVote(post(vote(ID.o[0], key(100 + i))), db)).status;
    expect(last).toBe(429);
  });
});

describe("GET /api/questions/:id/results", () => {
  const get = (id: string, db: Db) =>
    handleResults(new Request(`http://x/api/questions/${id}/results`), id, db);
  it("zero votes: every option 0% / 0 votes, all six listed", async () => {
    const body = await (await get(ID.q, fakeDb(s))).json();
    expect(body.totalResponses).toBe(0);
    expect(body.results).toHaveLength(6);
    expect(
      body.results.every(
        (r: { percentage: number; voteCount: number }) => r.percentage === 0 && r.voteCount === 0,
      ),
    ).toBe(true);
  });
  it("exact counts, totals and largest-remainder percentages summing to 100; refreshes after new votes", async () => {
    process.env["RATE_LIMIT_VOTES_PER_MIN"] = "100000"; // bulk-loading test data, not testing the limiter
    const db = fakeDb(s);
    const counts = [64, 55, 40, 35, 30, 24];
    let n = 1000;
    for (const [i, c] of counts.entries())
      for (let j = 0; j < c; j++) await handleVote(post(vote(ID.o[i], key(n++))), db);
    let body = await (await get(ID.q, db)).json();
    expect(body.totalResponses).toBe(248);
    expect(body.results.map((r: { voteCount: number }) => r.voteCount)).toEqual(counts);
    expect(body.results.map((r: { percentage: number }) => r.percentage)).toEqual([
      26, 22, 16, 14, 12, 10,
    ]);
    await handleVote(post(vote(ID.o[5], key(n++))), db);
    body = await (await get(ID.q, db)).json();
    expect(body.totalResponses).toBe(249);
    expect(body.results[5].voteCount).toBe(25);
    expect(body.results.reduce((a: number, r: { percentage: number }) => a + r.percentage, 0)).toBe(
      100,
    );
    delete process.env["RATE_LIMIT_VOTES_PER_MIN"];
  });
  it("rejects a non-UUID id and 404s an unknown question", async () => {
    expect((await get("abc", fakeDb(s))).status).toBe(422);
    expect((await get(ID.q2, fakeDb(s))).status).toBe(404);
  });
});
