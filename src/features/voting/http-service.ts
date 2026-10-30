import {
  VoteError,
  type OptionKey,
  type Question,
  type ResultsSnapshot,
  type VoteAccepted,
  type VoteErrorCode,
  type VoteSubmission,
  type VotingService,
} from "./types";

/**
 * HTTP implementation of VotingService for the real backend API.
 * The browser only talks to the API; it never connects to PostgreSQL.
 * Endpoints follow the proposal in docs/voting-integration.md (to be agreed with the backend developer).
 * Activated only when VITE_VOTE_API_URL is set (see service.ts).
 */
const STATUS_TO_CODE: Record<number, VoteErrorCode> = {
  404: "QUESTION_UNAVAILABLE",
  409: "DUPLICATE_VOTE",
  410: "POLL_CLOSED",
  422: "INVALID_OPTION",
};

const POLL_INTERVAL_MS = 5000;

interface ApiActiveQuestion {
  event: { id: string };
  question: { id: string; prompt: string; subtitle: string | null };
  options: { id: string; label: string; description: string | null; iconKey: string | null; displayOrder: number }[];
}
interface ApiResults {
  questionId: string;
  totalResponses: number;
  generatedAt: string;
  results: { answerOptionId: string; voteCount: number; percentage: number }[];
}

export class HttpVotingService implements VotingService {
  readonly isSimulated = false;
  private base: string;

  constructor(baseUrl: string, private fetchImpl: typeof fetch = (...a) => fetch(...a)) {
    this.base = baseUrl.replace(/\/+$/, "");
  }

  private async request<T>(path: string, init?: RequestInit, signal?: AbortSignal): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base}${path}`, {
        ...init,
        signal: signal ?? null,
        headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}) },
      });
    } catch (e) {
      if (signal?.aborted) throw new VoteError("TIMEOUT");
      throw new VoteError("NETWORK", e instanceof Error ? e.message : undefined);
    }
    if (!res.ok) throw new VoteError(STATUS_TO_CODE[res.status] ?? "SERVER", `HTTP ${res.status}`);
    try {
      return (await res.json()) as T;
    } catch {
      throw new VoteError("SERVER", "Invalid JSON response");
    }
  }

  async getActiveQuestion(signal?: AbortSignal): Promise<Question> {
    const r = await this.request<ApiActiveQuestion>("/api/questions/active", undefined, signal);
    return {
      id: r.question.id,
      eventId: r.event.id,
      title: r.question.prompt,
      prompt: r.question.subtitle ?? "",
      status: "active", // the API only returns a question when it is open for voting
      options: r.options.map((o) => ({
        id: o.id,
        key: (o.iconKey ?? "") as OptionKey,
        label: o.label,
        description: o.description ?? "",
        sortOrder: o.displayOrder,
      })),
    };
  }

  async submitVote(input: VoteSubmission, signal?: AbortSignal): Promise<VoteAccepted> {
    const r = await this.request<{ voteId: string; questionId: string; answerOptionId: string; acceptedAt: string }>(
      "/api/votes",
      {
        method: "POST",
        body: JSON.stringify({
          questionId: input.questionId,
          answerOptionId: input.optionId,
          idempotencyKey: input.idempotencyKey,
        }),
      },
      signal,
    );
    return { voteId: r.voteId, questionId: r.questionId, optionId: r.answerOptionId, acceptedAt: r.acceptedAt };
  }

  async getResults(questionId: string, signal?: AbortSignal): Promise<ResultsSnapshot> {
    const r = await this.request<ApiResults>(`/api/questions/${encodeURIComponent(questionId)}/results`, undefined, signal);
    return {
      questionId: r.questionId,
      totalVotes: r.totalResponses,
      results: r.results.map((x) => ({ optionId: x.answerOptionId, count: x.voteCount, percent: x.percentage })),
      generatedAt: r.generatedAt,
    };
  }

  /** Polling fallback; swap for SSE/WebSocket once the backend offers realtime. */
  subscribeResults(questionId: string, onSnapshot: (s: ResultsSnapshot) => void) {
    if (typeof window === "undefined") return () => {};
    let stopped = false;
    const tick = () => {
      if (stopped || document.visibilityState === "hidden") return;
      this.getResults(questionId).then((s) => !stopped && onSnapshot(s)).catch(() => {});
    };
    const t = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }
}
