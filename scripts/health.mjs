// Read-only connectivity, TLS and schema verification against the configured PostgreSQL database.
// Safe to run against production AWS RDS: executes SELECT queries only (never modifies tables or rows).
import fs from "node:fs";
import pg from "pg";

const hasEnvConfig = Boolean(
  process.env.DATABASE_URL || process.env.PGHOST || process.env.PGUSER || process.env.PGDATABASE,
);
if (!hasEnvConfig) {
  console.error(
    "Missing database configuration. Copy .env.example to .env and set DATABASE_URL (or PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD).",
  );
  process.exit(1);
}

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

const c = new pg.Client({
  ...(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {}),
  ssl,
  connectionTimeoutMillis: 5000,
});

const EXPECTED_TABLES = ["events", "questions", "answer_options", "votes", "event_participations"];

try {
  await c.connect();
  const connInfo = await c.query(
    "SELECT current_database() AS db, (SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()) AS ssl",
  );
  const tablesRes = await c.query(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY($1::text[])
      ORDER BY table_name`,
    [EXPECTED_TABLES],
  );
  const foundTables = tablesRes.rows.map((r) => r.table_name);
  const missingTables = EXPECTED_TABLES.filter((t) => !foundTables.includes(t));

  console.log("connected:", {
    ...connInfo.rows[0],
    tablesPresent: foundTables,
    ...(missingTables.length > 0 ? { missingTables } : {}),
  });

  if (missingTables.length > 0) {
    console.error("warning: expected tables missing from public schema:", missingTables.join(", "));
    process.exitCode = 1;
  }
} catch (e) {
  console.error("connection failed:", e.code ?? "", e.message);
  process.exitCode = 1;
} finally {
  await c.end().catch(() => {});
}
