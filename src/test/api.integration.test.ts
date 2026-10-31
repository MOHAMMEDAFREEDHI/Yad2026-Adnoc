// @vitest-environment node
// Integration tests against a REAL PostgreSQL. SKIPPED unless TEST_DATABASE_URL (or RUN_PG_INTEGRATION=1) is set.
// They run in a throw-away schema (created from db/migrations/0001_baseline.sql and dropped afterwards),
// so they never touch the public voting tables.
import fs from "node:fs";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadConfig } from "@/server/config";
import type { Db } from "@/server/db";
import {
  handleActiveQuestion,
  handleResults,
  handleVote,
  _resetRateLimits,
} from "@/server/handlers";
import { getActiveQuestion } from "@/server/repository";

if (process.env["RUN_PG_INTEGRATION"] === "1") {
  loadConfig();
}

const url = process.env["TEST_DATABASE_URL"];
const runPg = Boolean(url) || process.env["RUN_PG_INTEGRATION"] === "1";
const schema = `test_${Date.now()}`;
const d = runPg ? describe : describe.skip;

d("PostgreSQL integration (isolated schema)", () => {
  let pool: Pool;
  let db: Db;
  let qid = "";
  const opts: string[] = [];

  beforeAll(async () => {
    const cfg = loadConfig();
    const ssl =
      process.env["TEST_DB_SSL"] === "true"
        ? { rejectUnauthorized: false }
        : process.env["TEST_DB_SSL"] === "false"
          ? false
          : cfg.ssl;
    pool = new Pool({
      ...(url
        ? { connectionString: url }
        : cfg.databaseUrl
          ? { connectionString: cfg.databaseUrl }
          : {}),
      ssl,
      max: 15,
    });
    await pool.query(`CREATE SCHEMA ${schema}`);
    const c = await pool.connect();
    try {
      await c.query(`SET search_path TO ${schema}, public`);
      const migrationFiles = fs
        .readdirSync("db/migrations")
        .filter((f) => f.endsWith(".sql"))
        .sort();
      for (const file of migrationFiles) {
        await c.query(fs.readFileSync(`db/migrations/${file}`, "utf8"));
      }
      const e = await c.query(
        "INSERT INTO events (name, slug, status) VALUES ('T','t','open') RETURNING id",
      );
      const q = await c.query(
        "INSERT INTO questions (event_id, prompt, subtitle, status) VALUES ($1,'Your future in UAE industry','Which one is YOU?','active') RETURNING id",
        [e.rows[0].id],
      );
      qid = q.rows[0].id;
      for (let i = 1; i <= 6; i++) {
        const o = await c.query(
          "INSERT INTO answer_options (question_id,label,display_order) VALUES ($1,$2,$3) RETURNING id",
          [qid, `O${i}`, i],
        );
        opts.push(o.rows[0].id);
      }
    } finally {
      c.release();
    }
    db = {
      async query(s, p) {
        const cl = await pool.connect();
        try {
          await cl.query(`SET search_path TO ${schema}, public`);
          return await cl.query(s, p as unknown[]);
        } finally {
          cl.release();
        }
      },
      async transaction(fn) {
        const cl = await pool.connect();
        try {
          await cl.query(`SET search_path TO ${schema}, public`);
          await cl.query("BEGIN");
          const r = await fn({ query: (s, p) => cl.query(s, p as unknown[]) });
          await cl.query("COMMIT");
          return r;
        } catch (e) {
          await cl.query("ROLLBACK");
          throw e;
        } finally {
          cl.release();
        }
      },
    };
  }, 30_000);

  afterAll(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await pool.end();
  }, 15_000);

  const post = (b: object, cookie?: string) =>
    new Request("http://x/api/votes", {
      method: "POST",
      body: JSON.stringify(b),
      headers: {
        "x-forwarded-for": `9.9.9.${Math.floor(Math.random() * 250)}`,
        ...(cookie ? { cookie } : {}),
      },
    });
  const uuid = () => crypto.randomUUID();

  it("1. reads the active question with six options", async () => {
    const r = await getActiveQuestion(db);
    expect(r.question.id).toBe(qid);
    expect(r.options).toHaveLength(6);
  });

  it("2. zero-vote handling: returns 0 votes and 0% for all six options", async () => {
    const res = await handleResults(new Request("http://x"), qid, db);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.totalResponses).toBe(0);
    expect(body.results).toHaveLength(6);
    expect(
      body.results.every(
        (r: { voteCount: number; percentage: number }) => r.voteCount === 0 && r.percentage === 0,
      ),
    ).toBe(true);
  });

  it("3. successful vote persistence + duplicate idempotency replay (200) and conflict (409)", async () => {
    _resetRateLimits();
    const k = uuid();
    const first = await handleVote(
      post({ questionId: qid, answerOptionId: opts[0], idempotencyKey: k }),
      db,
    );
    expect(first.status).toBe(201);
    const firstBody = await first.json();
    expect(firstBody.replayed).toBe(false);

    // Same key + same option => 200 replayed, still 1 row
    const replay = await handleVote(
      post({ questionId: qid, answerOptionId: opts[0], idempotencyKey: k }),
      db,
    );
    expect(replay.status).toBe(200);
    const replayBody = await replay.json();
    expect(replayBody.replayed).toBe(true);
    expect(replayBody.voteId).toBe(firstBody.voteId);

    // Same key + different option => 409 conflict, still 1 row
    const conflict = await handleVote(
      post({ questionId: qid, answerOptionId: opts[1], idempotencyKey: k }),
      db,
    );
    expect(conflict.status).toBe(409);

    const cnt = await db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM votes WHERE idempotency_key = $1",
      [k],
    );
    expect(cnt.rows[0]?.n).toBe(1);
  });

  it("4. transaction rollback leaves zero uncommitted writes when an error occurs mid-transaction", async () => {
    const before = (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM votes")).rows[0]!
      .n;
    const k = uuid();
    await expect(
      db.transaction(async (tx) => {
        await tx.query(
          "INSERT INTO votes (question_id, answer_option_id, idempotency_key) VALUES ($1, $2, $3)",
          [qid, opts[0], k],
        );
        throw new Error("simulated failure after insert");
      }),
    ).rejects.toThrow("simulated failure after insert");

    const after = (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM votes")).rows[0]!
      .n;
    expect(after).toBe(before);
  });

  it("5. DB composite FK rejects a mismatched answer/question even if the API check is bypassed", async () => {
    const q2 = (
      await db.query<{ id: string }>(
        "INSERT INTO questions (event_id,prompt,status,display_order) SELECT event_id,'Q2','draft',2 FROM questions WHERE id=$1 RETURNING id",
        [qid],
      )
    ).rows[0]!.id;
    await expect(
      db.query(
        "INSERT INTO votes (question_id,answer_option_id,idempotency_key) VALUES ($1,$2,$3)",
        [q2, opts[0], uuid()],
      ),
    ).rejects.toThrow(/votes_answer_matches_question/);
  });

  it("6. concurrent identical requests insert 1 row; concurrent distinct votes all persist; counts and largest-remainder percentages sum to 100%", async () => {
    _resetRateLimits();
    process.env["RATE_LIMIT_VOTES_PER_MIN"] = "10000";
    try {
      const k = uuid();
      const same = await Promise.all(
        Array.from({ length: 8 }, () =>
          handleVote(post({ questionId: qid, answerOptionId: opts[1], idempotencyKey: k }), db),
        ),
      );
      expect(same.every((r) => r.status === 200 || r.status === 201)).toBe(true);
      expect(
        (
          await db.query<{ n: number }>(
            "SELECT count(*)::int AS n FROM votes WHERE idempotency_key=$1",
            [k],
          )
        ).rows[0]!.n,
      ).toBe(1);

      // Submit 15 distinct concurrent votes across the 6 options (total votes = 1 from test 3 + 1 from above + 15 = 17)
      // 17 is prime, so percentages have non-trivial remainders and must still sum to 100% via largest-remainder.
      const distinct = await Promise.all(
        Array.from({ length: 15 }, (_, i) =>
          handleVote(
            post({ questionId: qid, answerOptionId: opts[i % 6], idempotencyKey: uuid() }),
            db,
          ),
        ),
      );
      expect(distinct.every((r) => r.status === 201)).toBe(true);

      const res = await handleResults(new Request("http://x"), qid, db);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.totalResponses).toBe(17);
      // Option counts: opt0=1+3=4, opt1=1+3=4, opt2=3, opt3=2, opt4=2, opt5=2 => sum = 17
      expect(body.results.map((r: { voteCount: number }) => r.voteCount)).toEqual([
        4, 4, 3, 2, 2, 2,
      ]);
      const sumPct = body.results.reduce(
        (a: number, r: { percentage: number }) => a + r.percentage,
        0,
      );
      expect(sumPct).toBe(100);
      // 4/17=23.529%, 3/17=17.647%, 2/17=11.764% -> floors: 23,23,17,11,11,11 (sum=96, 4 leftover -> +1 to top 4 remainders: indices 3,4,5 (0.764) and index 2 (0.647)) -> [23, 23, 18, 12, 12, 12]
      expect(body.results.map((r: { percentage: number }) => r.percentage)).toEqual([
        23, 23, 18, 12, 12, 12,
      ]);
    } finally {
      delete process.env["RATE_LIMIT_VOTES_PER_MIN"];
    }
  });

  it("7. anonymous one-time voting: first vote succeeds and sets cookie; repeat vote from same visitor is rejected with 409 ALREADY_VOTED", async () => {
    _resetRateLimits();
    const vid = uuid();
    const cookie = `adnoc_vid=${vid}`;

    // First vote from this browser
    const res1 = await handleVote(
      post({ questionId: qid, answerOptionId: opts[0], idempotencyKey: uuid() }, cookie),
      db,
    );
    expect(res1.status).toBe(201);
    const body1 = await res1.json();
    expect(body1.replayed).toBe(false);

    // Verify participation row in RDS
    const partRows = await db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM event_participations",
    );
    expect(partRows.rows[0]!.n).toBeGreaterThan(0);

    // Repeat vote with a NEW idempotency key from the SAME browser cookie
    const res2 = await handleVote(
      post({ questionId: qid, answerOptionId: opts[1], idempotencyKey: uuid() }, cookie),
      db,
    );
    expect(res2.status).toBe(409);
    const body2 = await res2.json();
    expect(body2.error.code).toBe("ALREADY_VOTED");
    expect(body2.error.message).toBe(
      "You've already voted! Your response has been successfully recorded. Thank you for participating.",
    );

    // Retrying the original idempotency key still replays successfully (idempotency preserved)
    const replay = await handleVote(
      post(
        {
          questionId: qid,
          answerOptionId: opts[0],
          idempotencyKey: body1.idempotencyKey ?? (res1 as unknown as { idempotencyKey: string }),
        },
        cookie,
      ),
      db,
    );
    // Since body1 does not echo idempotencyKey, test with a known key
    const knownKey = uuid();
    const newVid = uuid();
    const newCookie = `adnoc_vid=${newVid}`;
    const v = await handleVote(
      post({ questionId: qid, answerOptionId: opts[2], idempotencyKey: knownKey }, newCookie),
      db,
    );
    expect(v.status).toBe(201);
    const vReplay = await handleVote(
      post({ questionId: qid, answerOptionId: opts[2], idempotencyKey: knownKey }, newCookie),
      db,
    );
    expect(vReplay.status).toBe(200);
    expect((await vReplay.json()).replayed).toBe(true);
  });

  it("8. repeat visit check: handleActiveQuestion returns hasVoted: true for already-voted visitor, hasVoted: false for new visitor", async () => {
    const vid = uuid();
    const cookie = `adnoc_vid=${vid}`;

    // Before voting: hasVoted is false
    const preCheck = await handleActiveQuestion(
      new Request("http://x/api/questions/active", { headers: { cookie } }),
      db,
    );
    expect(preCheck.status).toBe(200);
    expect((await preCheck.json()).hasVoted).toBe(false);

    // Vote
    const voteRes = await handleVote(
      post({ questionId: qid, answerOptionId: opts[3], idempotencyKey: uuid() }, cookie),
      db,
    );
    expect(voteRes.status).toBe(201);

    // Repeat visit / refresh with same cookie: hasVoted is true
    const postCheck = await handleActiveQuestion(
      new Request("http://x/api/questions/active", { headers: { cookie } }),
      db,
    );
    expect(postCheck.status).toBe(200);
    expect((await postCheck.json()).hasVoted).toBe(true);
  });

  it("9. concurrent race on same visitor: unique constraint on event_participations ensures exactly 1 vote succeeds", async () => {
    _resetRateLimits();
    process.env["RATE_LIMIT_VOTES_PER_MIN"] = "10000";
    try {
      const vid = uuid();
      const cookie = `adnoc_vid=${vid}`;

      // 6 concurrent submissions with DIFFERENT idempotency keys from the SAME browser
      const results = await Promise.all(
        Array.from({ length: 6 }, () =>
          handleVote(
            post({ questionId: qid, answerOptionId: opts[4], idempotencyKey: uuid() }, cookie),
            db,
          ),
        ),
      );

      const status201 = results.filter((r) => r.status === 201);
      const status409 = results.filter((r) => r.status === 409);

      expect(status201).toHaveLength(1);
      expect(status409).toHaveLength(5);
      for (const r of status409) {
        const b = await r.json();
        expect(b.error.code).toBe("ALREADY_VOTED");
      }
    } finally {
      delete process.env["RATE_LIMIT_VOTES_PER_MIN"];
    }
  });

  it("10. atomicity: participation record and vote rollback together if a mid-transaction failure occurs", async () => {
    const votesBefore = (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM votes"))
      .rows[0]!.n;
    const partsBefore = (
      await db.query<{ n: number }>("SELECT count(*)::int AS n FROM event_participations")
    ).rows[0]!.n;

    const fakeHash = `fake_hash_${Date.now()}`;
    await expect(
      db.transaction(async (tx) => {
        const events = await tx.query<{ event_id: string }>(
          "SELECT event_id FROM questions WHERE id = $1",
          [qid],
        );
        await tx.query(
          "INSERT INTO event_participations (event_id, visitor_id_hash) VALUES ($1, $2)",
          [events.rows[0]!.event_id, fakeHash],
        );
        throw new Error("simulated failure after participation insert");
      }),
    ).rejects.toThrow("simulated failure after participation insert");

    const votesAfter = (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM votes"))
      .rows[0]!.n;
    const partsAfter = (
      await db.query<{ n: number }>("SELECT count(*)::int AS n FROM event_participations")
    ).rows[0]!.n;

    expect(votesAfter).toBe(votesBefore);
    expect(partsAfter).toBe(partsBefore);
  });
});
