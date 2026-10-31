// Idempotent seed for the approved event / question / six options. Never inserts votes.
//   node --env-file=.env scripts/seed.mjs            seeds as DRAFT (safe default)
//   node --env-file=.env scripts/seed.mjs --activate sets event=EVENT_OPEN_STATUS, question=QUESTION_ACTIVE_STATUS
import fs from "node:fs";
import pg from "pg";

const content = JSON.parse(
  fs.readFileSync(process.env.SEED_FILE ?? "db/seed/voting-content.json", "utf8"),
);
const activate = process.argv.includes("--activate");
const eventStatus = activate ? (process.env.EVENT_OPEN_STATUS ?? "open") : "draft";
const questionStatus = activate ? (process.env.QUESTION_ACTIVE_STATUS ?? "active") : "draft";
function getCa() {
  const caBase64 = process.env.DB_SSL_CA_BASE64;
  if (caBase64 && caBase64.trim()) {
    const decoded = Buffer.from(caBase64.trim(), "base64").toString("utf8");
    if (!decoded.includes("-----BEGIN CERTIFICATE-----")) {
      throw new Error("Invalid DB_SSL_CA_BASE64: not a valid PEM certificate.");
    }
    return decoded;
  }
  const caPath = process.env.DB_SSL_CA_PATH;
  if (caPath && caPath.trim()) {
    if (!fs.existsSync(caPath.trim())) {
      throw new Error(`DB_SSL_CA_PATH certificate file not found: "${caPath.trim()}".`);
    }
    const content = fs.readFileSync(caPath.trim(), "utf8");
    if (!content.includes("-----BEGIN CERTIFICATE-----")) {
      throw new Error(
        `DB_SSL_CA_PATH certificate file "${caPath.trim()}" is not a valid PEM certificate.`,
      );
    }
    return content;
  }
  return undefined;
}

const ca = getCa();
const ssl =
  (process.env.DB_SSL ?? "true") === "false"
    ? false
    : {
        rejectUnauthorized: (process.env.DB_SSL_REJECT_UNAUTHORIZED ?? "true") !== "false",
        ...(ca ? { ca } : {}),
      };
const client = new pg.Client({
  ...(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {}),
  ssl,
});

await client.connect();
try {
  await client.query("BEGIN");
  const e = await client.query(
    `INSERT INTO events (name, slug, status) VALUES ($1,$2,$3)
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, status = EXCLUDED.status, updated_at = now() RETURNING id`,
    [content.event.name, content.event.slug, eventStatus],
  );
  const q = await client.query(
    `INSERT INTO questions (event_id, prompt, subtitle, display_order, status) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (event_id, display_order) DO UPDATE SET prompt = EXCLUDED.prompt, subtitle = EXCLUDED.subtitle, status = EXCLUDED.status, updated_at = now() RETURNING id`,
    [
      e.rows[0].id,
      content.question.prompt,
      content.question.subtitle,
      content.question.displayOrder,
      questionStatus,
    ],
  );
  for (const o of content.options) {
    await client.query(
      `INSERT INTO answer_options (question_id, label, description, image_url, icon_key, display_order, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,true)
       ON CONFLICT (question_id, display_order) DO UPDATE SET label = EXCLUDED.label, description = EXCLUDED.description,
         image_url = EXCLUDED.image_url, icon_key = EXCLUDED.icon_key, is_active = true`,
      [q.rows[0].id, o.label, o.description, o.imageUrl, o.iconKey, o.displayOrder],
    );
  }
  await client.query("COMMIT");
  console.log(
    `seeded event=${content.event.slug} (${eventStatus}), question=${q.rows[0].id} (${questionStatus}), options=${content.options.length}`,
  );
} catch (err) {
  await client.query("ROLLBACK");
  throw err;
} finally {
  await client.end();
}
