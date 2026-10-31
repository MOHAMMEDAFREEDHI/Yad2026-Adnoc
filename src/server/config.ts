import fs from "node:fs";

export type EventStatus = "draft" | "open" | "closed";
export type QuestionStatus = "draft" | "active" | "closed";

const EVENT_STATUSES: readonly EventStatus[] = ["draft", "open", "closed"];
const QUESTION_STATUSES: readonly QuestionStatus[] = ["draft", "active", "closed"];

/** Server-only configuration. Reads process.env lazily; never imported by client code. */
export interface ServerConfig {
  databaseUrl: string | undefined;
  ssl: false | { rejectUnauthorized: boolean; ca?: string };
  poolMax: number;
  eventOpenStatus: EventStatus;
  questionActiveStatus: QuestionStatus;
  votePolicy: "unrestricted" | "one_vote_per_browser";
  visitorHmacSecret: string;
  fingerprintSecretApiKey: string;
  fingerprintRegion: string;
  corsOrigins: string[];
  votesPerMin: number;
  readsPerMin: number;
}

const int = (v: string | undefined, d: number) =>
  v && Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d;

let dotEnvLoaded = false;
function ensureLocalDotEnvLoaded(env: NodeJS.ProcessEnv) {
  if (dotEnvLoaded || env !== process.env) return;
  dotEnvLoaded = true;
  if (
    process.env["NODE_ENV"] !== "test" &&
    typeof process.loadEnvFile === "function" &&
    fs.existsSync(".env")
  ) {
    try {
      process.loadEnvFile(".env");
    } catch {
      // Ignore if .env cannot be parsed; existing process.env takes precedence.
    }
  }
}

export function resolveCaCertificate(env: NodeJS.ProcessEnv): string | undefined {
  const caBase64 = env["DB_SSL_CA_BASE64"];
  if (caBase64 !== undefined) {
    if (caBase64.length > 0 && caBase64.trim() === "") {
      throw new Error("DB_SSL_CA_BASE64 is configured but contains only whitespace.");
    }
    if (caBase64.trim() !== "") {
      const trimmed = caBase64.trim();
      let decoded: string;
      try {
        decoded = Buffer.from(trimmed, "base64").toString("utf8");
      } catch (err) {
        throw new Error(
          `Failed to decode DB_SSL_CA_BASE64: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      if (!decoded.trim()) {
        throw new Error("DB_SSL_CA_BASE64 is malformed: decoded certificate is empty.");
      }
      if (
        !decoded.includes("-----BEGIN CERTIFICATE-----") ||
        !decoded.includes("-----END CERTIFICATE-----")
      ) {
        throw new Error(
          "DB_SSL_CA_BASE64 is malformed: decoded content does not contain a valid PEM certificate ('-----BEGIN CERTIFICATE-----' and '-----END CERTIFICATE-----' required).",
        );
      }
      return decoded;
    }
  }

  const caPath = env["DB_SSL_CA_PATH"];
  if (caPath !== undefined) {
    if (caPath.length > 0 && caPath.trim() === "") {
      throw new Error("DB_SSL_CA_PATH is configured but contains only whitespace.");
    }
    if (caPath.trim() !== "") {
      const trimmedPath = caPath.trim();
      if (!fs.existsSync(trimmedPath)) {
        throw new Error(
          `DB_SSL_CA_PATH certificate file not found: "${trimmedPath}". Ensure the file exists or configure DB_SSL_CA_BASE64.`,
        );
      }
      let content: string;
      try {
        content = fs.readFileSync(trimmedPath, "utf8");
      } catch (err) {
        throw new Error(
          `Failed to read certificate from DB_SSL_CA_PATH "${trimmedPath}": ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      if (!content.trim()) {
        throw new Error(`DB_SSL_CA_PATH certificate file "${trimmedPath}" is empty.`);
      }
      if (
        !content.includes("-----BEGIN CERTIFICATE-----") ||
        !content.includes("-----END CERTIFICATE-----")
      ) {
        throw new Error(
          `DB_SSL_CA_PATH certificate file "${trimmedPath}" does not contain a valid PEM certificate ('-----BEGIN CERTIFICATE-----' and '-----END CERTIFICATE-----' required).`,
        );
      }
      return content;
    }
  }

  return undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  ensureLocalDotEnvLoaded(env);
  const policy = (env["VOTE_POLICY"] ?? "one_vote_per_browser") as
    "unrestricted" | "one_vote_per_browser";
  if (policy !== "unrestricted" && policy !== "one_vote_per_browser") {
    throw new Error(
      `VOTE_POLICY "${policy}" is invalid. Allowed values: one_vote_per_browser, unrestricted.`,
    );
  }
  const visitorHmacSecret = env["VISITOR_HMAC_SECRET"] || "adnoc-voting-secret-salt-adipec-2026";
  const eventOpenStatus = (env["EVENT_OPEN_STATUS"] || "open") as EventStatus;
  if (!EVENT_STATUSES.includes(eventOpenStatus)) {
    throw new Error(
      `EVENT_OPEN_STATUS "${eventOpenStatus}" is invalid. Allowed values: ${EVENT_STATUSES.join(", ")}.`,
    );
  }
  const questionActiveStatus = (env["QUESTION_ACTIVE_STATUS"] || "active") as QuestionStatus;
  if (!QUESTION_STATUSES.includes(questionActiveStatus)) {
    throw new Error(
      `QUESTION_ACTIVE_STATUS "${questionActiveStatus}" is invalid. Allowed values: ${QUESTION_STATUSES.join(", ")}.`,
    );
  }
  const isSslEnabled = (env["DB_SSL"] ?? "true") !== "false";
  let ssl: ServerConfig["ssl"] = false;
  if (isSslEnabled) {
    const ca = resolveCaCertificate(env);
    ssl = {
      rejectUnauthorized: (env["DB_SSL_REJECT_UNAUTHORIZED"] ?? "true") !== "false",
      ...(ca ? { ca } : {}),
    };
  }
  return {
    databaseUrl: env["DATABASE_URL"] || undefined,
    ssl,
    poolMax: int(env["DB_POOL_MAX"], 10),
    eventOpenStatus,
    questionActiveStatus,
    votePolicy: policy,
    visitorHmacSecret,
    fingerprintSecretApiKey: env["FINGERPRINT_SECRET_API_KEY"]?.trim() || "",
    fingerprintRegion: env["FINGERPRINT_REGION"]?.trim() || "ap",
    corsOrigins: (env["CORS_ALLOWED_ORIGINS"] ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    votesPerMin: int(env["RATE_LIMIT_VOTES_PER_MIN"], 30),
    readsPerMin: int(env["RATE_LIMIT_READS_PER_MIN"], 120),
  };
}
