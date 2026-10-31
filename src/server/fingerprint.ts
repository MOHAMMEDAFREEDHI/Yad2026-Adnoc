import { ApiError } from "./repository";

export interface FingerprintEventData {
  visitorId: string;
  requestId?: string | undefined;
  confidence?: { score: number } | undefined;
  url?: string | undefined;
  ip?: string | undefined;
  suspectScore?: number | undefined;
  raw?: unknown;
}

type VerifierFn = (
  eventId: string,
  secretApiKey: string,
  region?: string,
  allowedOrigins?: string[],
) => Promise<FingerprintEventData>;

let testVerifier: VerifierFn | null = null;

/** Test helper to mock server-side Fingerprint verification in unit tests. */
export function _setFingerprintVerifierForTests(verifier: VerifierFn | null) {
  testVerifier = verifier;
}

/**
 * Validates an identification event ID with Fingerprint Pro Server API.
 * Ensures the event exists, belongs to the configured Fingerprint workspace,
 * and contains an authoritative visitor ID.
 */
export async function verifyFingerprintEvent(
  eventId: string,
  secretApiKey: string,
  region = "ap",
  allowedOrigins: string[] = [],
  fetchImpl: typeof fetch = fetch,
): Promise<FingerprintEventData> {
  if (testVerifier) {
    return testVerifier(eventId, secretApiKey, region, allowedOrigins);
  }

  if (!eventId || typeof eventId !== "string" || eventId.trim() === "") {
    throw new ApiError(
      400,
      "INVALID_FINGERPRINT_EVENT",
      "Fingerprint identification event ID is required.",
    );
  }

  const sanitizedEventId = eventId.trim();
  if (sanitizedEventId.length > 256 || !/^[a-zA-Z0-9_.-]+$/.test(sanitizedEventId)) {
    throw new ApiError(
      400,
      "INVALID_FINGERPRINT_EVENT",
      "Identification event ID format is invalid.",
    );
  }

  if (!secretApiKey || secretApiKey.trim() === "") {
    throw new ApiError(
      500,
      "FINGERPRINT_CONFIG_ERROR",
      "Server is not configured with a Fingerprint secret API key.",
    );
  }

  // Regional endpoint for Fingerprint Pro Server API v4
  // - ap: Asia Pacific (Mumbai): https://ap.api.fpjs.io/v4
  // - eu: EU: https://eu.api.fpjs.io/v4
  // - global / us: https://api.fpjs.io/v4
  const host =
    region === "global" || region === "us" || !region ? "api.fpjs.io" : `${region}.api.fpjs.io`;
  const endpoint = `https://${host}/v4/events/${encodeURIComponent(sanitizedEventId)}`;

  let res: Response;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    res = await fetchImpl(endpoint, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${secretApiKey}`,
        "Auth-API-Key": secretApiKey,
        Accept: "application/json",
      },
      signal: ctrl.signal,
    }).finally(() => clearTimeout(timer));
  } catch (err) {
    const isTimeout =
      err instanceof Error &&
      (err.name === "AbortError" || err.name === "TimeoutError" || "code" in err);
    console.error(
      "[fingerprint] server verification network error:",
      isTimeout ? "timeout" : "network",
    );
    throw new ApiError(
      503,
      "FINGERPRINT_UNAVAILABLE",
      "Device verification is temporarily unavailable. Please try again.",
    );
  }

  if (res.status === 400) {
    throw new ApiError(
      400,
      "INVALID_FINGERPRINT_EVENT",
      "Fingerprint identification event ID is invalid.",
    );
  }

  if (res.status === 404) {
    throw new ApiError(
      403,
      "FINGERPRINT_EVENT_NOT_FOUND",
      "Identification event not found or does not belong to configured workspace.",
    );
  }

  if (res.status === 401 || res.status === 403) {
    console.error("[fingerprint] server authentication error status:", res.status);
    throw new ApiError(
      500,
      "FINGERPRINT_AUTH_FAILED",
      "Fingerprint server authentication failed. Verify server secret key.",
    );
  }

  if (!res.ok) {
    console.error("[fingerprint] server error status:", res.status);
    throw new ApiError(
      502,
      "FINGERPRINT_SERVER_ERROR",
      `Fingerprint server returned error status ${res.status}.`,
    );
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new ApiError(
      502,
      "FINGERPRINT_SERVER_ERROR",
      "Invalid response from Fingerprint server.",
    );
  }

  interface IdentificationData {
    visitor_id?: string | undefined;
    visitorId?: string | undefined;
    url?: string | undefined;
    ip?: string | undefined;
    ip_address?: string | undefined;
    confidence?: { score: number } | undefined;
    visitor_found?: boolean | undefined;
    first_seen_at?: number | undefined;
    last_seen_at?: number | undefined;
  }

  const payload = body as {
    event_id?: string | undefined;
    identification?: (IdentificationData & { data?: IdentificationData | undefined }) | undefined;
    url?: string | undefined;
    ip_address?: string | undefined;
    products?:
      | {
          identification?:
            (IdentificationData & { data?: IdentificationData | undefined }) | undefined;
        }
      | undefined;
    visitor_id?: string | undefined;
    visitorId?: string | undefined;
    suspect_score?: number | undefined;
    suspect?: boolean | { score?: number } | undefined;
  };

  // Fingerprint Server API v4 documents identification.visitor_id directly (without data wrapper).
  // We check v4 direct properties first, then fallback to nested data or products structures.
  const visitorId =
    payload.identification?.visitor_id ??
    payload.identification?.visitorId ??
    payload.identification?.data?.visitor_id ??
    payload.identification?.data?.visitorId ??
    payload.products?.identification?.visitor_id ??
    payload.products?.identification?.visitorId ??
    payload.products?.identification?.data?.visitorId ??
    payload.products?.identification?.data?.visitor_id ??
    payload.visitor_id ??
    payload.visitorId;

  if (!visitorId || typeof visitorId !== "string" || visitorId.trim() === "") {
    throw new ApiError(
      422,
      "INVALID_FINGERPRINT_EVENT",
      "Fingerprint event does not contain a valid visitor ID.",
    );
  }

  // Extract event URL for origin verification (in v4 Event schema, url is at root level or in identification)
  const eventUrl =
    payload.url ??
    payload.identification?.url ??
    payload.identification?.data?.url ??
    payload.products?.identification?.url ??
    payload.products?.identification?.data?.url;

  const confidence =
    payload.identification?.confidence ??
    payload.identification?.data?.confidence ??
    payload.products?.identification?.confidence ??
    payload.products?.identification?.data?.confidence;

  const ip =
    payload.ip_address ??
    payload.identification?.ip_address ??
    payload.identification?.ip ??
    payload.identification?.data?.ip ??
    payload.products?.identification?.ip ??
    payload.products?.identification?.data?.ip;
  if (eventUrl && allowedOrigins.length > 0) {
    try {
      const eventOrigin = new URL(eventUrl).origin;
      const isAllowed = allowedOrigins.some((ao) => {
        try {
          return new URL(ao).origin === eventOrigin;
        } catch {
          return ao === eventOrigin;
        }
      });
      if (!isAllowed) {
        throw new ApiError(
          403,
          "FINGERPRINT_ORIGIN_MISMATCH",
          `Identification event originated from unapproved origin: ${eventOrigin}`,
        );
      }
    } catch (e) {
      if (e instanceof ApiError) throw e;
      // If parsing fails, do not throw unless it was an explicit ApiError
    }
  }

  return {
    visitorId: visitorId.trim(),
    confidence,
    url: eventUrl,
    ip,
    suspectScore: payload.suspect_score,
    raw: payload,
  };
}
