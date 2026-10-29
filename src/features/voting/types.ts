// Shared data contracts. These mirror the intended backend API (see docs/voting-integration.md)
// and the existing RDS tables: events, questions, answer_options, votes.

export type OptionKey =
  | "business-owner"
  | "industrial-investor"
  | "private-sector"
  | "industrial-specialist"
  | "data-ai"
  | "something-else";

export interface AnswerOption {
  id: string;
  key: OptionKey;
  label: string;
  description: string;
  sortOrder: number;
}

export interface Question {
  id: string;
  eventId: string;
  title: string;
  prompt: string;
  status: "active" | "closed" | "draft";
  options: AnswerOption[];
}

export interface VoteSubmission {
  questionId: string;
  optionId: string;
  /** Client-generated key so a retried request cannot create a second vote. */
  idempotencyKey: string;
}

export interface VoteAccepted {
  voteId: string;
  questionId: string;
  optionId: string;
  acceptedAt: string;
}

export interface OptionResult {
  optionId: string;
  count: number;
  percent: number;
}

export interface ResultsSnapshot {
  questionId: string;
  totalVotes: number;
  results: OptionResult[];
  generatedAt: string;
}

export type VoteErrorCode =
  | "QUESTION_UNAVAILABLE"
  | "POLL_CLOSED"
  | "INVALID_OPTION"
  | "DUPLICATE_VOTE"
  | "NETWORK"
  | "TIMEOUT"
  | "SERVER";

export class VoteError extends Error {
  constructor(public code: VoteErrorCode, message?: string) {
    super(message ?? code);
    this.name = "VoteError";
  }
}

export interface VotingService {
  /** True when the implementation is local/simulated and not persisted to the real database. */
  readonly isSimulated: boolean;
  getActiveQuestion(signal?: AbortSignal): Promise<Question>;
  submitVote(input: VoteSubmission, signal?: AbortSignal): Promise<VoteAccepted>;
  getResults(questionId: string, signal?: AbortSignal): Promise<ResultsSnapshot>;
  /** Pushes a fresh authoritative snapshot whenever results change. Returns unsubscribe. */
  subscribeResults(questionId: string, onSnapshot: (s: ResultsSnapshot) => void): () => void;
}
