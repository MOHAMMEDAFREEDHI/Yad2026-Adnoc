import { Pool, type PoolClient, type QueryResultRow } from "pg";

import { loadConfig } from "./config";

/** Minimal DB surface the repository needs; lets tests inject a fake. */
export interface Db {
  query<T extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  transaction<T>(fn: (tx: Pick<Db, "query">) => Promise<T>): Promise<T>;
}

let pool: Pool | null = null;

/** One shared pool per server process (never one connection per request). */
export function getPool(): Pool {
  if (pool) return pool;
  const cfg = loadConfig();
  pool = new Pool({
    ...(cfg.databaseUrl ? { connectionString: cfg.databaseUrl } : {}), // else PGHOST/PGUSER/... from env
    ssl: cfg.ssl,
    max: cfg.poolMax,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 10_000,
  });
  // An idle client error must not crash the process; log the message only (never connection details).
  pool.on("error", (err) => console.error("[db] idle client error:", err.message));
  return pool;
}

export const pgDb: Db = {
  query: (sql, params) => getPool().query(sql, params as unknown[]),
  async transaction(fn) {
    const client: PoolClient = await getPool().connect();
    try {
      await client.query("BEGIN");
      const out = await fn({ query: (s, p) => client.query(s, p as unknown[]) });
      await client.query("COMMIT");
      return out;
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  },
};

export interface HealthCheckResult {
  ok: boolean;
  database?: string;
  ssl?: boolean;
}

export async function healthCheck(db: Db = pgDb): Promise<HealthCheckResult> {
  try {
    const r = await db.query<{ db: string; ssl: boolean | null }>(
      "SELECT current_database() AS db, (SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()) AS ssl",
    );
    const row = r.rows[0];
    return {
      ok: true,
      ...(row?.db ? { database: row.db } : {}),
      ...(typeof row?.ssl === "boolean" ? { ssl: row.ssl } : {}),
    };
  } catch (e) {
    console.error("[db] health check failed:", e instanceof Error ? e.message : "unknown");
    return { ok: false };
  }
}
