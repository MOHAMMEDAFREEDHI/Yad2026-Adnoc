// Controlled temporary test-data setup & cleanup for Phase 8 HTTP/Frontend integration verification.
// Strictly scoped to slug = 'adipec-2026-http-test'. Never touches 'adipec-2026'.
//   node --env-file=.env scripts/http-test-event.mjs --setup
//   node --env-file=.env scripts/http-test-event.mjs --cleanup
import fs from "node:fs";
import pg from "pg";

const TEST_SLUG = "adipec-2026-http-test";
const content = JSON.parse(fs.readFileSync("db/seed/voting-content.json", "utf8"));
const mode = process.argv.includes("--setup") ? "setup" : process.argv.includes("--cleanup") ? "cleanup" : null;
if (!mode) {
  console.error("Usage: node --env-file=.env scripts/http-test-event.mjs [--setup | --cleanup]");
  process.exit(1);
}

const ssl =
  (process.env.DB_SSL ?? "true") === "false"
    ? false
    : {
        rejectUnauthorized: (process.env.DB_SSL_REJECT_UNAUTHORIZED ?? "true") !== "false",
        ...(process.env.DB_SSL_CA_PATH ? { ca: fs.readFileSync(process.env.DB_SSL_CA_PATH, "utf8") } : {}),
      };
const client = new pg.Client({
  ...(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {}),
  ssl,
});

await client.connect();
try {
  await client.query("BEGIN");
  if (mode === "setup") {
    const e = await client.query(
      `INSERT INTO events (name, slug, status) VALUES ($1, $2, 'open')
       ON CONFLICT (slug) DO UPDATE SET status = 'open', updated_at = now() RETURNING id`,
      ["ADIPEC 2026 (HTTP Test)", TEST_SLUG],
    );
    const q = await client.query(
      `INSERT INTO questions (event_id, prompt, subtitle, display_order, status) VALUES ($1, $2, $3, 1, 'active')
       ON CONFLICT (event_id, display_order) DO UPDATE SET status = 'active', updated_at = now() RETURNING id`,
      [e.rows[0].id, content.question.prompt, content.question.subtitle],
    );
    const optionIds = [];
    for (const o of content.options) {
      const opt = await client.query(
        `INSERT INTO answer_options (question_id, label, description, image_url, icon_key, display_order, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, true)
         ON CONFLICT (question_id, display_order) DO UPDATE SET label = EXCLUDED.label, description = EXCLUDED.description,
           image_url = EXCLUDED.image_url, icon_key = EXCLUDED.icon_key, is_active = true
         RETURNING id, display_order, label, icon_key`,
        [q.rows[0].id, o.label, o.description, o.imageUrl, o.iconKey, o.displayOrder],
      );
      optionIds.push(opt.rows[0]);
    }
    await client.query("COMMIT");
    console.log(
      JSON.stringify(
        {
          action: "setup",
          slug: TEST_SLUG,
          eventId: e.rows[0].id,
          questionId: q.rows[0].id,
          options: optionIds,
        },
        null,
        2,
      ),
    );
  } else {
    // Cleanup strictly scoped to slug = 'adipec-2026-http-test'
    const delVotes = await client.query(
      `DELETE FROM votes
        WHERE question_id IN (
          SELECT q.id FROM questions q JOIN events e ON e.id = q.event_id WHERE e.slug = $1
        )`,
      [TEST_SLUG],
    );
    const delOpts = await client.query(
      `DELETE FROM answer_options
        WHERE question_id IN (
          SELECT q.id FROM questions q JOIN events e ON e.id = q.event_id WHERE e.slug = $1
        )`,
      [TEST_SLUG],
    );
    const delQuestions = await client.query(
      `DELETE FROM questions
        WHERE event_id IN (SELECT id FROM events WHERE slug = $1)`,
      [TEST_SLUG],
    );
    const delEvents = await client.query(`DELETE FROM events WHERE slug = $1`, [TEST_SLUG]);
    await client.query("COMMIT");
    console.log(
      JSON.stringify(
        {
          action: "cleanup",
          slug: TEST_SLUG,
          deleted: {
            votes: delVotes.rowCount,
            answer_options: delOpts.rowCount,
            questions: delQuestions.rowCount,
            events: delEvents.rowCount,
          },
        },
        null,
        2,
      ),
    );
  }
} catch (err) {
  await client.query("ROLLBACK");
  throw err;
} finally {
  await client.end();
}

