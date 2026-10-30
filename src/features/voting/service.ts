import { HttpVotingService } from "./http-service";
import { MockVotingService } from "./mock-service";
import type { VotingService } from "./types";

/**
 * Single place to swap the data source. When the backend API is ready, add an
 * HttpVotingService (fetch against import.meta.env["VITE_VOTE_API_URL"]) and return it here.
 * The browser must never connect to PostgreSQL directly.
 */
let instance: VotingService | null = null;

export function getVotingService(): VotingService {
  // Mock until a real API is deliberately configured via VITE_VOTE_API_URL.
  const apiUrl = (import.meta.env["VITE_VOTE_API_URL"] as string | undefined)?.trim();
  return (instance ??= apiUrl ? new HttpVotingService(apiUrl) : new MockVotingService());
}

/** Test helper to override or reset the singleton when testing HttpVotingService vs MockVotingService. */
export function _setVotingServiceForTests(svc: VotingService | null) {
  instance = svc;
}

export function newIdempotencyKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
      });
}

export const VOTE_ERROR_MESSAGES = {
  QUESTION_UNAVAILABLE: "Voting isn't open right now. Please try again shortly.",
  POLL_CLOSED: "Voting has closed for this question.",
  INVALID_OPTION: "That choice isn't available. Please pick another.",
  DUPLICATE_VOTE: "Your choice has already been recorded.",
  NETWORK: "No connection. Check your internet and try again.",
  TIMEOUT: "This is taking too long. Please try again.",
  SERVER: "Something went wrong. Please try again.",
} as const;
