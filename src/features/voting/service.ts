import { MockVotingService } from "./mock-service";
import type { VotingService } from "./types";

/**
 * Single place to swap the data source. When the backend API is ready, add an
 * HttpVotingService (fetch against import.meta.env.VITE_VOTE_API_URL) and return it here.
 * The browser must never connect to PostgreSQL directly.
 */
let instance: VotingService | null = null;

export function getVotingService(): VotingService {
  return (instance ??= new MockVotingService());
}

export function newIdempotencyKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
