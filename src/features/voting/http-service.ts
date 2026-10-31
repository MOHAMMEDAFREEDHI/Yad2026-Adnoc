import {
  VoteError,
  type ActiveQuestionOptions,
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
  409: "DUPLICATE_VOTE",
  410: "POLL_CLOSED",
  422: "INVALID_OPTION",
};

const API_ERROR_CODE_MAP: Record<string, VoteErrorCode> = {
  QUESTION_UNAVAILABLE: "QUESTION_UNAVAILABLE",
  DUPLICATE_VOTE: "DUPLICATE_VOTE",
  ALREADY_VOTED: "ALREADY_VOTED",
  IDEMPOTENCY_CONFLICT: "DUPLICATE_VOTE",
  POLL_CLOSED: "POLL_CLOSED",
  INVALID_OPTION: "INVALID_OPTION",
};

const POLL_INTERVAL_MS = 5000;

interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
  };
}

interface ApiActiveQuestion {
  event: { id: string };
  question: { id: string; prompt: string; subtitle: string | null };
  options: {
    id: string;
    label: string;
    description: string | null;
    iconKey: string | null;
    displayOrder: number;
  }[];
  hasVoted?: boolean;
  votedOption?: {
    id: string;
    label: string;
    description: string | null;
    iconKey: string | null;
    displayOrder: number;
  } | null;
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

  constructor(
    baseUrl: string,
    private fetchImpl: typeof fetch = (...a) => fetch(...a),
  ) {
    this.base = baseUrl.replace(/\/+$/, "");
  }

  private async request<T>(path: string, init?: RequestInit, signal?: AbortSignal): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base}${path}`, {
        cache: "no-store",
        credentials: "include",
        ...init,
        signal: signal ?? null,
        headers: {
          Accept: "application/json",
          ...(init?.body ? { "Content-Type": "application/json" } : {}),
          ...init?.headers,
        },
      });
    } catch (e) {
      if (signal?.aborted) throw new VoteError("TIMEOUT");
      throw new VoteError("NETWORK", e instanceof Error ? e.message : undefined);
    }
    if (!res.ok) {
      let body: ApiErrorBody | null = null;
      try {
        body = (await res.json()) as ApiErrorBody;
      } catch {
        // Non-JSON error payload (e.g. HTML 404/502 page from proxy or wrong port)
      }
      const apiCode = body?.error?.code ? API_ERROR_CODE_MAP[body.error.code] : undefined;
      const mappedCode = apiCode ?? STATUS_TO_CODE[res.status] ?? "SERVER";
      throw new VoteError(mappedCode, body?.error?.message ?? `HTTP ${res.status}`);
    }
    try {
      return (await res.json()) as T;
    } catch {
      throw new VoteError("SERVER", "Invalid JSON response");
    }
  }

  async getActiveQuestion(
    opts?: AbortSignal | ActiveQuestionOptions,
    maybeEventId?: string,
  ): Promise<Question> {
    let signal: AbortSignal | undefined;
    let eventId: string | undefined;

    if (opts instanceof AbortSignal) {
      signal = opts;
      eventId = maybeEventId;
    } else if (opts && typeof opts === "object") {
      signal = opts.signal;
      eventId = opts.eventId ?? maybeEventId;
    }

    const query = eventId ? `?eventId=${encodeURIComponent(eventId)}` : "";
    const headers: Record<string, string> = eventId ? { "x-fingerprint-event-id": eventId } : {};
    const r = await this.request<ApiActiveQuestion>(
      `/api/questions/active${query}`,
      { headers },
      signal,
    );
    return {
      id: r.question.id,
      eventId: r.event.id,
      title: r.question.prompt,
      prompt: r.question.subtitle ?? "",
      status: "active", // the API only returns a question when it is open for voting
      hasVoted: Boolean(r.hasVoted),
      votedOption: r.votedOption
        ? {
            id: r.votedOption.id,
            key: (r.votedOption.iconKey ?? "") as OptionKey,
            label: r.votedOption.label,
            description: r.votedOption.description ?? "",
            sortOrder: r.votedOption.displayOrder,
          }
        : null,
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
    const headers: Record<string, string> = input.fingerprintEventId
      ? { "x-fingerprint-event-id": input.fingerprintEventId }
      : {};
    const r = await this.request<{
      voteId: string;
      questionId: string;
      answerOptionId: string;
      acceptedAt: string;
    }>(
      "/api/votes",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          questionId: input.questionId,
          answerOptionId: input.optionId,
          idempotencyKey: input.idempotencyKey,
          ...(input.fingerprintEventId ? { fingerprintEventId: input.fingerprintEventId } : {}),
        }),
      },
      signal,
    );
    return {
      voteId: r.voteId,
      questionId: r.questionId,
      optionId: r.answerOptionId,
      acceptedAt: r.acceptedAt,
    };
  }

  async getResults(questionId: string, signal?: AbortSignal): Promise<ResultsSnapshot> {
    const r = await this.request<ApiResults>(
      `/api/questions/${encodeURIComponent(questionId)}/results`,
      undefined,
      signal,
    );
    return {
      questionId: r.questionId,
      totalVotes: r.totalResponses,
      results: r.results.map((x) => ({
        optionId: x.answerOptionId,
        count: x.voteCount,
        percent: x.percentage,
      })),
      generatedAt: r.generatedAt,
    };
  }

  /** Polling fallback; swap for SSE/WebSocket once the backend offers realtime. */
  subscribeResults(questionId: string, onSnapshot: (s: ResultsSnapshot) => void) {
    if (typeof window === "undefined") return () => {};
    let stopped = false;
    const tick = () => {
      if (stopped || document.visibilityState === "hidden") return;
      this.getResults(questionId)
        .then((s) => !stopped && onSnapshot(s))
        .catch(() => {});
    };
    const t = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }
}
