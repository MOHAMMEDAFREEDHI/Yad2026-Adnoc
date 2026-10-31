import { z } from "zod";

import { loadConfig } from "./config";
import { healthCheck, pgDb, type Db } from "./db";
import { verifyFingerprintEvent } from "./fingerprint";
import { ApiError, getActiveQuestion, getResults, submitVote } from "./repository";
import { getOrCreateVisitor, hashFingerprintVisitorId, hashVisitorId } from "./visitor";

const uuid = z.string().uuid();
const voteBody = z.object({
  questionId: uuid,
  answerOptionId: uuid,
  idempotencyKey: uuid,
  fingerprintEventId: z.string().min(1).max(256).optional(),
});

/** Fixed-window per-IP limiter (in-memory: per server instance; use an edge/WAF limit for multi-instance). */
const hits = new Map<string, { n: number; reset: number }>();
export function rateLimited(key: string, limit: number, now = Date.now()): boolean {
  const h = hits.get(key);
  if (!h || h.reset <= now) {
    hits.set(key, { n: 1, reset: now + 60_000 });
    if (hits.size > 10_000) for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
    return false;
  }
  return ++h.n > limit;
}
export const _resetRateLimits = () => hits.clear();

function clientIp(req: Request) {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  if (!origin) return {};
  const cfg = loadConfig();
  const isAllowed =
    cfg.corsOrigins.includes(origin) ||
    origin === "http://localhost:8081" ||
    origin === "https://yad2026.vercel.app";
  if (!isAllowed) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-fingerprint-event-id",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

function json(req: Request, status: number, body: unknown, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...corsHeaders(req),
      ...extra,
    },
  });
}

const fail = (
  req: Request,
  status: number,
  code: string,
  message: string,
  extra: Record<string, string> = {},
) => json(req, status, { error: { code, message } }, extra);

async function guard(
  req: Request,
  kind: "vote" | "read",
  run: (visitor: ReturnType<typeof getOrCreateVisitor>) => Promise<Response>,
): Promise<Response> {
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  const cfg = loadConfig();
  if (
    rateLimited(`${kind}:${clientIp(req)}`, kind === "vote" ? cfg.votesPerMin : cfg.readsPerMin)
  ) {
    return json(
      req,
      429,
      { error: { code: "RATE_LIMITED", message: "Too many requests." } },
      { "Retry-After": "60" },
    );
  }
  const visitor = getOrCreateVisitor(req);
  const extraHeaders: Record<string, string> = {};
  if (visitor.cookieToSet) {
    extraHeaders["Set-Cookie"] = visitor.cookieToSet;
  }
  try {
    return await run(visitor);
  } catch (e) {
    if (e instanceof ApiError) return fail(req, e.status, e.code, e.message, extraHeaders);
    // Never leak DB internals to the client; log only the message.
    console.error("[api] unexpected error:", e instanceof Error ? e.message : "unknown");
    return fail(req, 500, "SERVER", "Something went wrong.", extraHeaders);
  }
}

export const handleActiveQuestion = (req: Request, db: Db = pgDb) =>
  guard(req, "read", async (visitor) => {
    const cfg = loadConfig();
    const url = new URL(req.url, "http://localhost");
    const fpEventId = url.searchParams.get("eventId") || req.headers.get("x-fingerprint-event-id");

    let visitorIdHash: string | null = null;

    if (fpEventId) {
      if (cfg.fingerprintSecretApiKey) {
        const fpData = await verifyFingerprintEvent(
          fpEventId,
          cfg.fingerprintSecretApiKey,
          cfg.fingerprintRegion,
          cfg.corsOrigins,
        );
        visitorIdHash = hashFingerprintVisitorId(fpData.visitorId, cfg.visitorHmacSecret);
      } else {
        // Fallback for tests / unconfigured dev environment
        visitorIdHash = hashFingerprintVisitorId(fpEventId, cfg.visitorHmacSecret);
      }
    } else if (!cfg.fingerprintSecretApiKey && visitor.visitorId) {
      // In legacy test mode without Fingerprint keys, check participation using legacy cookie
      visitorIdHash = hashVisitorId(visitor.visitorId, cfg.visitorHmacSecret);
    }

    const payload = await getActiveQuestion(db, visitorIdHash);
    const extraHeaders: Record<string, string> = {};
    if (visitor.cookieToSet) {
      extraHeaders["Set-Cookie"] = visitor.cookieToSet;
    }
    return json(req, 200, payload, extraHeaders);
  });

export const handleResults = (req: Request, questionId: string, db: Db = pgDb) =>
  guard(req, "read", async () => {
    if (!uuid.safeParse(questionId).success)
      throw new ApiError(422, "INVALID_QUESTION", "Question id must be a UUID.");
    return json(req, 200, await getResults(db, questionId));
  });

export const handleVote = (req: Request, db: Db = pgDb) =>
  guard(req, "vote", async (visitor) => {
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      throw new ApiError(400, "INVALID_REQUEST", "Body must be valid JSON.");
    }
    const parsed = voteBody.safeParse(raw);
    if (!parsed.success)
      throw new ApiError(
        422,
        "INVALID_REQUEST",
        "questionId, answerOptionId and idempotencyKey must be UUIDs.",
      );

    const cfg = loadConfig();
    const fpEventId = parsed.data.fingerprintEventId || req.headers.get("x-fingerprint-event-id");

    let visitorIdHash: string;

    if (cfg.fingerprintSecretApiKey) {
      if (!fpEventId) {
        throw new ApiError(
          400,
          "MISSING_FINGERPRINT_EVENT",
          "Fingerprint identification is required.",
        );
      }
      const fpData = await verifyFingerprintEvent(
        fpEventId,
        cfg.fingerprintSecretApiKey,
        cfg.fingerprintRegion,
        cfg.corsOrigins,
      );
      visitorIdHash = hashFingerprintVisitorId(fpData.visitorId, cfg.visitorHmacSecret);
    } else if (fpEventId) {
      // Test environment with eventId but no real FP secret key configured
      visitorIdHash = hashFingerprintVisitorId(fpEventId, cfg.visitorHmacSecret);
    } else {
      // Test environment or legacy cookie fallback when no Fingerprint secret is set
      visitorIdHash = hashVisitorId(visitor.visitorId, cfg.visitorHmacSecret);
    }

    const v = await submitVote(db, {
      questionId: parsed.data.questionId,
      answerOptionId: parsed.data.answerOptionId,
      idempotencyKey: parsed.data.idempotencyKey,
      visitorIdHash,
    });
    const extraHeaders: Record<string, string> = {};
    if (visitor.cookieToSet) {
      extraHeaders["Set-Cookie"] = visitor.cookieToSet;
    }
    return json(req, v.replayed ? 200 : 201, v, extraHeaders);
  });

export const handleHealth = (req: Request, db: Db = pgDb) =>
  guard(req, "read", async () => {
    const res = await healthCheck(db);
    return json(req, res.ok ? 200 : 503, {
      status: res.ok ? "ok" : "unavailable",
      ...(res.database ? { database: res.database } : {}),
      ...(typeof res.ssl === "boolean" ? { ssl: res.ssl } : {}),
    });
  });
