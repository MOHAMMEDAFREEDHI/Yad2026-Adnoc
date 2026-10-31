import crypto from "node:crypto";

export const VISITOR_COOKIE_NAME = "adnoc_vid";
export const VISITOR_COOKIE_MAX_AGE_SECONDS = 34_560_000; // 400 days (maximum standard browser cookie lifetime)

/**
 * Extracts and validates the anonymous visitor ID from the request Cookie header.
 * Rejects empty or malformed values.
 */
export function parseVisitorCookie(req: Request): string | null {
  const cookieHeader = req.headers.get("cookie");
  if (!cookieHeader) return null;

  const match = cookieHeader.match(/(?:^|;\s*)adnoc_vid=([^;]+)/);
  if (!match || !match[1]) return null;

  try {
    const val = decodeURIComponent(match[1].trim());
    // Require standard UUID or safe 16-128 character hex/token
    if (
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val) ||
      /^[a-zA-Z0-9_-]{16,128}$/.test(val)
    ) {
      return val;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Generates a cryptographically secure random visitor ID.
 */
export function generateVisitorId(): string {
  return crypto.randomUUID();
}

/**
 * Serializes the visitor ID into an HttpOnly, SameSite=Lax persistent cookie header.
 */
export function buildVisitorCookieHeader(visitorId: string, isProduction: boolean): string {
  const expires = new Date(Date.now() + VISITOR_COOKIE_MAX_AGE_SECONDS * 1000).toUTCString();
  const secureFlag = isProduction ? "; Secure" : "";
  return `${VISITOR_COOKIE_NAME}=${encodeURIComponent(visitorId)}; Path=/; Max-Age=${VISITOR_COOKIE_MAX_AGE_SECONDS}; Expires=${expires}; SameSite=Lax; HttpOnly${secureFlag}`;
}

/**
 * Computes a server-side HMAC-SHA256 hash of the visitor ID using the server secret.
 * The raw visitor ID is never stored in AWS RDS.
 */
export function hashVisitorId(visitorId: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(visitorId).digest("hex");
}

export const FINGERPRINT_HASH_PREFIX = "fp:";

/**
 * Computes a namespaced server-side HMAC-SHA256 hash of a validated Fingerprint visitor ID.
 * The "fp:" namespace guarantees that Fingerprint visitor identities are never confused
 * with legacy cookie-derived participation hashes.
 */
export function hashFingerprintVisitorId(visitorId: string, secret: string): string {
  return hashVisitorId(`${FINGERPRINT_HASH_PREFIX}${visitorId}`, secret);
}

export interface VisitorResolution {
  visitorId: string;
  cookieToSet: string | null;
}

/**
 * Resolves the visitor ID for an incoming request.
 * If the visitor cookie already exists, it is preserved.
 * If missing, a new cryptographically secure random visitor ID is generated and the Set-Cookie string is returned.
 */
export function getOrCreateVisitor(
  req: Request,
  isProduction = process.env["NODE_ENV"] === "production",
): VisitorResolution {
  const existing = parseVisitorCookie(req);
  if (existing) {
    return { visitorId: existing, cookieToSet: null };
  }
  const fresh = generateVisitorId();
  return {
    visitorId: fresh,
    cookieToSet: buildVisitorCookieHeader(fresh, isProduction),
  };
}
