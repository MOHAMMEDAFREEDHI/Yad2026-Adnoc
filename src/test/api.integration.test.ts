// @vitest-environment node
// Integration tests against a REAL PostgreSQL. SKIPPED unless TEST_DATABASE_URL (or RUN_PG_INTEGRATION=1) is set.
// They run in a throw-away schema (created from db/migrations/0001_baseline.sql and dropped afterwards),
// so they never touch the public voting tables.
import fs from "node:fs";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadConfig } from "@/server/config";
import type { Db } from "@/server/db";
import { handleResults, handleVote, _resetRateLimits } from "@/server/handlers";
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
  let opts: string[] = [];

  beforeAll(async () => {
    const cfg = loadConfig();
    const ssl =
      process.env["TEST_DB_SSL"] === "true"
        ? { rejectUnauthorized: false }
        : process.env["TEST_DB_SSL"] === "false"
          ? false
          : cfg.ssl;
    pool = new Pool({
      ...(url ? { connectionString: url } : cfg.databaseUrl ? { connectionString: cfg.databaseUrl } : {}),
      ssl,
      max: 15,
    });
    await pool.query(`CREATE SCHEMA ${schema}`);
    const c = await pool.connect();
    try {
      await c.query(`SET search_path TO ${schema}, public`);
      await c.query(fs.readFileSync("db/migrations/0001_baseline.sql", "utf8"));
      const e = await c.query("INSERT INTO events (name, slug, status) VALUES ('T','t','open') RETURNING id");
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

  const post = (b: object) =>
    new Request("http://x/api/votes", {
      method: "POST",
      body: JSON.stringify(b),
      headers: { "x-forwarded-for": `9.9.9.${Math.floor(Math.random() * 250)}` },
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
    expect(body.results.every((r: { voteCount: number; percentage: number }) => r.voteCount === 0 && r.percentage === 0)).toBe(true);
  });

  it("3. successful vote persistence + duplicate idempotency replay (200) and conflict (409)", async () => {
    _resetRateLimits();
    const k = uuid();
    const first = await handleVote(post({ questionId: qid, answerOptionId: opts[0], idempotencyKey: k }), db);
    expect(first.status).toBe(201);
    const firstBody = await first.json();
    expect(firstBody.replayed).toBe(false);

    // Same key + same option => 200 replayed, still 1 row
    const replay = await handleVote(post({ questionId: qid, answerOptionId: opts[0], idempotencyKey: k }), db);
    expect(replay.status).toBe(200);
    const replayBody = await replay.json();
    expect(replayBody.replayed).toBe(true);
    expect(replayBody.voteId).toBe(firstBody.voteId);

    // Same key + different option => 409 conflict, still 1 row
    const conflict = await handleVote(post({ questionId: qid, answerOptionId: opts[1], idempotencyKey: k }), db);
    expect(conflict.status).toBe(409);

    const cnt = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM votes WHERE idempotency_key = $1", [k]);
    expect(cnt.rows[0]?.n).toBe(1);
  });

  it("4. transaction rollback leaves zero uncommitted writes when an error occurs mid-transaction", async () => {
    const before = (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM votes")).rows[0]!.n;
    const k = uuid();
    await expect(
      db.transaction(async (tx) => {
        await tx.query("INSERT INTO votes (question_id, answer_option_id, idempotency_key) VALUES ($1, $2, $3)", [
          qid,
          opts[0],
          k,
        ]);
        throw new Error("simulated failure after insert");
      }),
    ).rejects.toThrow("simulated failure after insert");

    const after = (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM votes")).rows[0]!.n;
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
      db.query("INSERT INTO votes (question_id,answer_option_id,idempotency_key) VALUES ($1,$2,$3)", [
        q2,
        opts[0],
        uuid(),
      ]),
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
        (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM votes WHERE idempotency_key=$1", [k])).rows[0]!.n,
      ).toBe(1);

      // Submit 15 distinct concurrent votes across the 6 options (total votes = 1 from test 3 + 1 from above + 15 = 17)
      // 17 is prime, so percentages have non-trivial remainders and must still sum to 100% via largest-remainder.
      const distinct = await Promise.all(
        Array.from({ length: 15 }, (_, i) =>
          handleVote(post({ questionId: qid, answerOptionId: opts[i % 6], idempotencyKey: uuid() }), db),
        ),
      );
      expect(distinct.every((r) => r.status === 201)).toBe(true);

      const res = await handleResults(new Request("http://x"), qid, db);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.totalResponses).toBe(17);
      // Option counts: opt0=1+3=4, opt1=1+3=4, opt2=3, opt3=2, opt4=2, opt5=2 => sum = 17
      expect(body.results.map((r: { voteCount: number }) => r.voteCount)).toEqual([4, 4, 3, 2, 2, 2]);
      const sumPct = body.results.reduce((a: number, r: { percentage: number }) => a + r.percentage, 0);
      expect(sumPct).toBe(100);
      // 4/17=23.529%, 3/17=17.647%, 2/17=11.764% -> floors: 23,23,17,11,11,11 (sum=96, 4 leftover -> +1 to top 4 remainders: indices 3,4,5 (0.764) and index 2 (0.647)) -> [23, 23, 18, 12, 12, 12]
      expect(body.results.map((r: { percentage: number }) => r.percentage)).toEqual([23, 23, 18, 12, 12, 12]);
    } finally {
      delete process.env["RATE_LIMIT_VOTES_PER_MIN"];
    }
  });
});
