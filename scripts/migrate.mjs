// Minimal migration runner with baseline adoption.
//   node --env-file=.env scripts/migrate.mjs            apply pending migrations
//   node --env-file=.env scripts/migrate.mjs --baseline mark 0001 as applied WITHOUT running it (existing RDS)
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const dir = path.resolve("db/migrations");
const ssl =
  (process.env.DB_SSL ?? "true") === "false"
    ? false
    : {
        rejectUnauthorized: (process.env.DB_SSL_REJECT_UNAUTHORIZED ?? "true") !== "false",
        ...(process.env.DB_SSL_CA_PATH
          ? { ca: fs.readFileSync(process.env.DB_SSL_CA_PATH, "utf8") }
          : {}),
      };
const client = new pg.Client({
  ...(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {}),
  ssl,
});
const baseline = process.argv.includes("--baseline");

await client.connect();
try {
  await client.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now(), baselined boolean NOT NULL DEFAULT false)",
  );
  const done = new Set(
    (await client.query("SELECT name FROM schema_migrations")).rows.map((r) => r.name),
  );
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const existing =
    (await client.query("SELECT to_regclass('public.events') AS t")).rows[0].t !== null;

  for (const f of files) {
    if (done.has(f)) continue;
    if (baseline && f === "0001_baseline.sql") {
      if (!existing)
        throw new Error(
          "--baseline requested but the voting tables do not exist; run without --baseline.",
        );
      await client.query("INSERT INTO schema_migrations (name, baselined) VALUES ($1, true)", [f]);
      console.log(`baselined ${f} (not executed)`);
      continue;
    }
    if (f === "0001_baseline.sql" && existing) {
      throw new Error(
        "Voting tables already exist. Refusing to run the baseline; adopt it with --baseline.",
      );
    }
    await client.query("BEGIN");
    try {
      await client.query(fs.readFileSync(path.join(dir, f), "utf8"));
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [f]);
      await client.query("COMMIT");
      console.log(`applied ${f}`);
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    }
  }
} finally {
  await client.end();
}
