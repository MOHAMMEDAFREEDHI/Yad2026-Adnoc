/**
 * Client-side error reporting utility.
 * Captures React boundary exceptions and logs diagnostics in development.
 */

export function reportClientError(error: unknown, context: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;

  const stack = error instanceof Error ? error.stack : undefined;
  const message = describeThrown(error);

  if (process.env["NODE_ENV"] !== "production") {
    console.error("[client-error]", message, { stack, ...context });
  }
}

const MAX_SERIALIZED_LENGTH = 2000;

function describeThrown(error: unknown): string {
  if (error instanceof Response) {
    return `Response ${error.status}${error.url ? ` at ${error.url}` : ""}`;
  }
  if (error instanceof Error) {
    return error.message || error.name;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    const serialized = JSON.stringify(error);
    return serialized.length > MAX_SERIALIZED_LENGTH
      ? `${serialized.slice(0, MAX_SERIALIZED_LENGTH)}...`
      : serialized;
  } catch {
    return String(error);
  }
}
