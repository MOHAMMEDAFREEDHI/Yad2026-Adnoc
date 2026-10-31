// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Db } from "@/server/db";
import { _setFingerprintVerifierForTests, verifyFingerprintEvent } from "@/server/fingerprint";
import {
  _resetRateLimits,
  handleActiveQuestion,
  handleResults,
  handleVote,
} from "@/server/handlers";
import { hashFingerprintVisitorId } from "@/server/visitor";

const ID = {
  q: "11111111-1111-4111-8111-111111111111",
  o: Array.from({ length: 6 }, (_, i) => `aaaaaaaa-aaaa-4aaa-8aaa-00000000000${i + 1}`),
};

interface State {
  eStatus: string;
  qStatus: string;
  votes: { id: string; q: string; o: string; k: string; at: Date }[];
  participations: { id: string; eventId: string; visitorIdHash: string }[];
}

function fakeDb(s: State): Db {
  const exec = async (sql: string, p: unknown[] = []) => {
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
    if (sql.includes("FROM event_participations WHERE event_id = $1 AND visitor_id_hash = $2")) {
      const part = s.participations.find((x) => x.eventId === p[0] && x.visitorIdHash === p[1]);
      return { rows: part ? [{ "?column?": 1 }] : [] };
    }
    if (sql.startsWith("INSERT INTO event_participations")) {
      if (s.participations.some((x) => x.eventId === p[0] && x.visitorIdHash === p[1])) {
        return { rows: [] }; // Unique constraint violation
      }
      const ep = {
        id: `ep-${s.participations.length + 1}`,
        eventId: p[0] as string,
        visitorIdHash: p[1] as string,
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
    if (sql.includes("FROM questions WHERE id = $1")) {
      return { rows: p[0] === ID.q ? [{ x: 1 }] : [] };
    }
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
  let lock = Promise.resolve();
  return {
    query: exec as Db["query"],
    async transaction(fn) {
      const run = async () => {
        const snapVotes = [...s.votes];
        const snapPart = [...s.participations];
        try {
          return await fn({ query: exec as Db["query"] });
        } catch (e) {
          s.votes = snapVotes;
          s.participations = snapPart;
          throw e;
        }
      };
      const result = lock.then(run);
      lock = result.then(
        () => {},
        () => {},
      );
      return result;
    },
  };
}

const key = (n: number) => `cccccccc-cccc-4ccc-8ccc-${String(n).padStart(12, "0")}`;
const postVote = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://localhost:8081/api/votes", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": "1.1.1.1",
      ...headers,
    },
  });

describe("Fingerprint Pro Server-Side Event Verification", () => {
  it("authenticates with Bearer token against AP endpoint and extracts identification.visitor_id (Server API v4 direct schema)", async () => {
    let calledUrl = "";
    let authHeader = "";
    let apiKeyHeader = "";

    const mockFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calledUrl = String(input);
      authHeader = (init?.headers as Record<string, string>)?.["Authorization"] ?? "";
      apiKeyHeader = (init?.headers as Record<string, string>)?.["Auth-API-Key"] ?? "";

      return new Response(
        JSON.stringify({
          event_id: "1768992558661.2J0stP",
          identification: {
            visitor_id: "fp_visitor_abc123",
            url: "http://localhost:8081/vote",
            confidence: { score: 0.99 },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const result = await verifyFingerprintEvent(
      "1768992558661.2J0stP",
      "secret_api_key_test",
      "ap",
      ["http://localhost:8081"],
      mockFetch as unknown as typeof fetch,
    );

    expect(calledUrl).toBe("https://ap.api.fpjs.io/v4/events/1768992558661.2J0stP");
    expect(authHeader).toBe("Bearer secret_api_key_test");
    expect(apiKeyHeader).toBe("secret_api_key_test");
    expect(result.visitorId).toBe("fp_visitor_abc123");
    expect(result.url).toBe("http://localhost:8081/vote");
    expect(result.confidence?.score).toBe(0.99);
  });

  it("extracts root-level url and ip_address directly from Server API v4 Event schema", async () => {
    const mockFetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            event_id: "1768992558661.2J0stP",
            timestamp: 1768992558661,
            url: "https://yad2026.vercel.app/vote",
            ip_address: "194.170.1.5",
            identification: {
              visitor_id: "Ibk1527CUFmcnjLwIs4A9",
              confidence: { score: 0.98 },
              visitor_found: true,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );

    const result = await verifyFingerprintEvent(
      "1768992558661.2J0stP",
      "secret_api_key_test",
      "ap",
      ["https://yad2026.vercel.app"],
      mockFetch as unknown as typeof fetch,
    );

    expect(result.visitorId).toBe("Ibk1527CUFmcnjLwIs4A9");
    expect(result.url).toBe("https://yad2026.vercel.app/vote");
    expect(result.ip).toBe("194.170.1.5");
    expect(result.confidence?.score).toBe(0.98);
  });

  it("routes global/us regions to api.fpjs.io and eu to eu.api.fpjs.io", async () => {
    let globalUrl = "";
    let euUrl = "";

    const mockFetchGlobal = vi.fn(async (input: RequestInfo | URL) => {
      globalUrl = String(input);
      return new Response(JSON.stringify({ identification: { visitor_id: "vid_global" } }), {
        status: 200,
      });
    });

    const mockFetchEu = vi.fn(async (input: RequestInfo | URL) => {
      euUrl = String(input);
      return new Response(JSON.stringify({ identification: { visitor_id: "vid_eu" } }), {
        status: 200,
      });
    });

    await verifyFingerprintEvent(
      "evt_global",
      "secret_test",
      "global",
      [],
      mockFetchGlobal as unknown as typeof fetch,
    );
    await verifyFingerprintEvent(
      "evt_eu",
      "secret_test",
      "eu",
      [],
      mockFetchEu as unknown as typeof fetch,
    );

    expect(globalUrl).toBe("https://api.fpjs.io/v4/events/evt_global");
    expect(euUrl).toBe("https://eu.api.fpjs.io/v4/events/evt_eu");
  });

  it("rejects invalid event ID when Fingerprint API returns HTTP 400", async () => {
    const mockFetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ error: { code: "RequestCannotBeParsed", message: "Event ID invalid" } }),
          { status: 400 },
        ),
    );

    await expect(
      verifyFingerprintEvent(
        "invalid_id_format",
        "secret_test",
        "ap",
        [],
        mockFetch as unknown as typeof fetch,
      ),
    ).rejects.toThrow(/Fingerprint identification event ID is invalid/);
  });

  it("extracts visitor_id from identification.data nested schema", async () => {
    const mockFetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            event_id: "1768992558661.2J0stP",
            identification: {
              data: {
                visitor_id: "fp_visitor_nested_456",
                url: "http://localhost:8081/vote",
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );

    const result = await verifyFingerprintEvent(
      "1768992558661.2J0stP",
      "secret_api_key_test",
      "ap",
      ["http://localhost:8081"],
      mockFetch as unknown as typeof fetch,
    );

    expect(result.visitorId).toBe("fp_visitor_nested_456");
  });

  it("extracts visitorId from legacy v3 payload structure if returned", async () => {
    const mockFetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            products: {
              identification: {
                data: {
                  visitorId: "fp_legacy_visitor_999",
                  url: "https://yad2026.vercel.app/vote",
                },
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );

    const result = await verifyFingerprintEvent(
      "event_v3_xyz",
      "secret_api_key_test",
      "ap",
      ["https://yad2026.vercel.app"],
      mockFetch as unknown as typeof fetch,
    );

    expect(result.visitorId).toBe("fp_legacy_visitor_999");
  });

  it("rejects forged or nonexistent event ID (HTTP 404 from Fingerprint)", async () => {
    const mockFetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { code: "event_not_found" } }), { status: 404 }),
    );

    await expect(
      verifyFingerprintEvent(
        "forged_event_id",
        "secret_api_key_test",
        "ap",
        [],
        mockFetch as unknown as typeof fetch,
      ),
    ).rejects.toThrow(/not found or does not belong to configured workspace/);
  });

  it("handles Fingerprint server outage gracefully with 503 temporary error", async () => {
    const mockFetch = vi.fn(async () => {
      throw new Error("connect ECONNREFUSED");
    });

    await expect(
      verifyFingerprintEvent(
        "event_during_outage",
        "secret_api_key_test",
        "ap",
        [],
        mockFetch as unknown as typeof fetch,
      ),
    ).rejects.toThrow(/temporarily unavailable/);
  });

  it("rejects event when origin does not match configured allowed origins", async () => {
    const mockFetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            identification: {
              data: {
                visitor_id: "fp_visitor_unauthorized",
                url: "https://malicious-phishing-site.com/vote",
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );

    await expect(
      verifyFingerprintEvent(
        "event_from_malicious_site",
        "secret_api_key_test",
        "ap",
        ["http://localhost:8081", "https://yad2026.vercel.app"],
        mockFetch as unknown as typeof fetch,
      ),
    ).rejects.toThrow(/unapproved origin/);
  });
});

describe("Cross-Browser Anonymous Voting with Fingerprint Pro", () => {
  let s: State;
  const originalEnv = process.env;

  beforeEach(() => {
    _resetRateLimits();
    s = { eStatus: "open", qStatus: "active", votes: [], participations: [] };
    process.env = {
      ...originalEnv,
      FINGERPRINT_SECRET_API_KEY: "test_fp_secret_key",
      FINGERPRINT_REGION: "ap",
      VISITOR_HMAC_SECRET: "test_hmac_secret_key_12345",
      CORS_ALLOWED_ORIGINS: "http://localhost:8081,https://yad2026.vercel.app",
    };
  });

  afterEach(() => {
    _setFingerprintVerifierForTests(null);
    process.env = originalEnv;
  });

  it("1. First visit with a new Fingerprint visitor: voting allowed", async () => {
    _setFingerprintVerifierForTests(async (eventId) => ({
      visitorId: eventId === "fp_event_chrome_user1" ? "phone_visitor_device_1" : "unknown",
    }));

    const req = new Request(
      "http://localhost:8081/api/questions/active?eventId=fp_event_chrome_user1",
    );
    const res = await handleActiveQuestion(req, fakeDb(s));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hasVoted).toBe(false);
    expect(body.options).toHaveLength(6);
  });

  it("2. Submit a vote: participation and vote saved atomically using namespaced HMAC", async () => {
    _setFingerprintVerifierForTests(async (eventId) => ({
      visitorId: eventId === "fp_event_chrome_user1" ? "phone_visitor_device_1" : "unknown",
    }));

    const db = fakeDb(s);
    const res = await handleVote(
      postVote({
        questionId: ID.q,
        answerOptionId: ID.o[0],
        idempotencyKey: key(1),
        fingerprintEventId: "fp_event_chrome_user1",
      }),
      db,
    );

    expect(res.status).toBe(201);
    expect(s.votes).toHaveLength(1);
    expect(s.participations).toHaveLength(1);

    // Verify hash uses the "fp:" namespace
    const expectedHash = hashFingerprintVisitorId(
      "phone_visitor_device_1",
      process.env["VISITOR_HMAC_SECRET"]!,
    );
    expect(s.participations[0]!.visitorIdHash).toBe(expectedHash);
  });

  it("3. Return using the same Chrome profile: duplicate vote blocked with 409 ALREADY_VOTED", async () => {
    _setFingerprintVerifierForTests(async () => ({
      visitorId: "phone_visitor_device_1",
    }));

    const db = fakeDb(s);
    // 1st vote
    const v1 = await handleVote(
      postVote({
        questionId: ID.q,
        answerOptionId: ID.o[0],
        idempotencyKey: key(1),
        fingerprintEventId: "fp_event_chrome_1",
      }),
      db,
    );
    expect(v1.status).toBe(201);

    // 2nd vote attempt with new idempotency key from same Chrome profile
    const v2 = await handleVote(
      postVote({
        questionId: ID.q,
        answerOptionId: ID.o[1],
        idempotencyKey: key(2),
        fingerprintEventId: "fp_event_chrome_2",
      }),
      db,
    );
    expect(v2.status).toBe(409);
    const body = await v2.json();
    expect(body.error.code).toBe("ALREADY_VOTED");
    expect(body.error.message).toBe(
      "You've already voted! Your response has been successfully recorded. Thank you for participating.",
    );
    expect(s.votes).toHaveLength(1); // No second vote added
  });

  it("4. Cross-browser protection (Chrome to Edge on same phone): recognizes identical visitorId and blocks duplicate", async () => {
    const db = fakeDb(s);

    // User visits in Chrome on phone -> Fingerprint returns phone visitor ID
    _setFingerprintVerifierForTests(async (eventId) => ({
      visitorId: "phone_device_physical_hardware_id_42",
      raw: { browser: eventId.includes("chrome") ? "Chrome" : "Edge" },
    }));

    const chromeVote = await handleVote(
      postVote(
        {
          questionId: ID.q,
          answerOptionId: ID.o[0],
          idempotencyKey: key(1),
          fingerprintEventId: "fp_event_phone_chrome",
        },
        { cookie: "adnoc_vid=chrome-cookie-1111" },
      ),
      db,
    );
    expect(chromeVote.status).toBe(201);
    expect(s.votes).toHaveLength(1);

    // User now opens Microsoft Edge on the same phone (with a completely different browser cookie):
    // Fingerprint hardware & smart signals identify the same physical phone visitor ID
    const edgeVote = await handleVote(
      postVote(
        {
          questionId: ID.q,
          answerOptionId: ID.o[2],
          idempotencyKey: key(2),
          fingerprintEventId: "fp_event_phone_edge",
        },
        { cookie: "adnoc_vid=edge-different-cookie-2222" },
      ),
      db,
    );

    expect(edgeVote.status).toBe(409);
    const body = await edgeVote.json();
    expect(body.error.code).toBe("ALREADY_VOTED");
    expect(s.votes).toHaveLength(1);
  });

  it("5. Incognito mode: recognizes same visitor ID and blocks duplicate", async () => {
    const db = fakeDb(s);

    _setFingerprintVerifierForTests(async () => ({
      visitorId: "phone_device_physical_hardware_id_42",
    }));

    // Standard session vote
    await handleVote(
      postVote({
        questionId: ID.q,
        answerOptionId: ID.o[0],
        idempotencyKey: key(1),
        fingerprintEventId: "fp_event_standard",
      }),
      db,
    );

    // Open Incognito tab (zero cookies present) -> Fingerprint Pro still identifies device
    const incognitoCheck = await handleActiveQuestion(
      new Request("http://localhost:8081/api/questions/active?eventId=fp_event_incognito"),
      db,
    );
    expect(incognitoCheck.status).toBe(200);
    const checkBody = await incognitoCheck.json();
    expect(checkBody.hasVoted).toBe(true);

    const incognitoVote = await handleVote(
      postVote({
        questionId: ID.q,
        answerOptionId: ID.o[1],
        idempotencyKey: key(3),
        fingerprintEventId: "fp_event_incognito",
      }),
      db,
    );
    expect(incognitoVote.status).toBe(409);
    expect((await incognitoVote.json()).error.code).toBe("ALREADY_VOTED");
  });

  it("6. Refresh page: existing participation recognised", async () => {
    const db = fakeDb(s);
    _setFingerprintVerifierForTests(async () => ({
      visitorId: "visitor_page_refresh_test",
    }));

    // Vote once
    await handleVote(
      postVote({
        questionId: ID.q,
        answerOptionId: ID.o[0],
        idempotencyKey: key(1),
        fingerprintEventId: "fp_event_1",
      }),
      db,
    );

    // Subsequent page refresh fetches active question with the visitor's event ID
    const res = await handleActiveQuestion(
      new Request("http://localhost:8081/api/questions/active?eventId=fp_event_2"),
      db,
    );
    const body = await res.json();
    expect(body.hasVoted).toBe(true);
  });

  it("7. Clear browser cookies: verify that Fingerprint identification still blocks duplicate vote", async () => {
    const db = fakeDb(s);
    _setFingerprintVerifierForTests(async () => ({
      visitorId: "visitor_cleared_cookies_test",
    }));

    // Vote with cookie A
    await handleVote(
      postVote(
        {
          questionId: ID.q,
          answerOptionId: ID.o[0],
          idempotencyKey: key(1),
          fingerprintEventId: "fp_event_before_clear",
        },
        { cookie: "adnoc_vid=cookie-to-be-deleted" },
      ),
      db,
    );

    // Cookies cleared: request has NO cookie header
    const afterClearVote = await handleVote(
      postVote({
        questionId: ID.q,
        answerOptionId: ID.o[2],
        idempotencyKey: key(2),
        fingerprintEventId: "fp_event_after_clear",
      }),
      db,
    );

    expect(afterClearVote.status).toBe(409);
    expect((await afterClearVote.json()).error.code).toBe("ALREADY_VOTED");
  });

  it("8. Invalid or forged event ID: backend rejects it with 403 or 400 and commits no vote", async () => {
    const db = fakeDb(s);
    // Forged event ID not found in workspace
    _setFingerprintVerifierForTests(async () => {
      const { ApiError } = await import("@/server/repository");
      throw new ApiError(
        403,
        "FINGERPRINT_EVENT_NOT_FOUND",
        "Identification event not found or does not belong to configured workspace.",
      );
    });

    const res = await handleVote(
      postVote({
        questionId: ID.q,
        answerOptionId: ID.o[0],
        idempotencyKey: key(1),
        fingerprintEventId: "forged_malicious_event_id",
      }),
      db,
    );

    expect(res.status).toBe(403);
    expect(s.votes).toHaveLength(0);
    expect(s.participations).toHaveLength(0);
  });

  it("9. Invalid server API verification (Fingerprint outage): no vote is accepted (no silent cookie fallback)", async () => {
    const db = fakeDb(s);
    _setFingerprintVerifierForTests(async () => {
      const { ApiError } = await import("@/server/repository");
      throw new ApiError(
        503,
        "FINGERPRINT_UNAVAILABLE",
        "Device verification is temporarily unavailable. Please try again.",
      );
    });

    // Client attempts to vote with cookie present, but Fingerprint server fails
    const res = await handleVote(
      postVote(
        {
          questionId: ID.q,
          answerOptionId: ID.o[0],
          idempotencyKey: key(1),
          fingerprintEventId: "fp_event_outage",
        },
        { cookie: "adnoc_vid=attempt-fallback-cookie" },
      ),
      db,
    );

    // Must NOT silently accept vote using cookie
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe("FINGERPRINT_UNAVAILABLE");
    expect(s.votes).toHaveLength(0);
    expect(s.participations).toHaveLength(0);
  });

  it("10. Two simultaneous submissions: only one vote commits inside single database transaction", async () => {
    const db = fakeDb(s);
    _setFingerprintVerifierForTests(async () => ({
      visitorId: "race_condition_visitor_id",
    }));

    // Send two concurrent vote submissions with different options
    const [res1, res2] = await Promise.all([
      handleVote(
        postVote({
          questionId: ID.q,
          answerOptionId: ID.o[0],
          idempotencyKey: key(1),
          fingerprintEventId: "fp_event_concurrent_1",
        }),
        db,
      ),
      handleVote(
        postVote({
          questionId: ID.q,
          answerOptionId: ID.o[1],
          idempotencyKey: key(2),
          fingerprintEventId: "fp_event_concurrent_2",
        }),
        db,
      ),
    ]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([201, 409]);
    expect(s.votes).toHaveLength(1);
    expect(s.participations).toHaveLength(1);
  });

  it("11. Existing idempotent retry: same idempotency key replays 200 without creating a duplicate vote", async () => {
    const db = fakeDb(s);
    _setFingerprintVerifierForTests(async () => ({
      visitorId: "retry_visitor_id",
    }));

    const votePayload = {
      questionId: ID.q,
      answerOptionId: ID.o[0],
      idempotencyKey: key(1),
      fingerprintEventId: "fp_event_retry",
    };

    const first = await handleVote(postVote(votePayload), db);
    expect(first.status).toBe(201);

    // Network retry with exact same idempotency key and option
    const retry = await handleVote(postVote(votePayload), db);
    expect(retry.status).toBe(200);
    const body = await retry.json();
    expect(body.replayed).toBe(true);
    expect(s.votes).toHaveLength(1);
  });

  it("12. Results API and LED display: unaffected by Fingerprint voting", async () => {
    const db = fakeDb(s);
    _setFingerprintVerifierForTests(async () => ({
      visitorId: "voter_for_results_check",
    }));

    // Submit a vote
    await handleVote(
      postVote({
        questionId: ID.q,
        answerOptionId: ID.o[0],
        idempotencyKey: key(1),
        fingerprintEventId: "fp_event_results_check",
      }),
      db,
    );

    const res = await handleResults(
      new Request(`http://localhost:8081/api/questions/${ID.q}/results`),
      ID.q,
      db,
    );
    expect(res.status).toBe(200);
    const results = await res.json();
    expect(results.totalResponses).toBe(1);
    expect(results.results[0]!.voteCount).toBe(1);
    expect(results.results[0]!.percentage).toBe(100);
  });
});
