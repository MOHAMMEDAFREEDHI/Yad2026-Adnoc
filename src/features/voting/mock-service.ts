import { computeResults } from "./results";
import {
  VoteError,
  type Question,
  type ResultsSnapshot,
  type VoteAccepted,
  type VoteSubmission,
  type VotingService,
} from "./types";

/**
 * SIMULATED service for frontend development only.
 * Votes are stored in this browser's localStorage and shared between tabs of the
 * same browser via BroadcastChannel. Nothing is persisted to the AWS RDS database
 * and phones do not sync with the LED screen. Replace with the HTTP implementation
 * once the backend API is available.
 */

export const MOCK_QUESTION: Question = {
  id: "q-future-uae-industry",
  eventId: "adipec-2026",
  title: "YOUR FUTURE IN UAE INDUSTRY",
  prompt: "Which one is YOU?",
  status: "active",
  options: [
    {
      id: "opt-1",
      key: "business-owner",
      label: "Business owner",
      description: "Start your own factory or company",
      sortOrder: 1,
    },
    {
      id: "opt-2",
      key: "industrial-investor",
      label: "Industrial investor",
      description: "Invest in new UAE factories",
      sortOrder: 2,
    },
    {
      id: "opt-3",
      key: "private-sector",
      label: "Private-sector professional",
      description: "Work in a UAE company that supplies ADNOC",
      sortOrder: 3,
    },
    {
      id: "opt-4",
      key: "industrial-specialist",
      label: "Industrial specialist",
      description: "Engineer, technician or quality expert in a factory",
      sortOrder: 4,
    },
    {
      id: "opt-5",
      key: "data-ai",
      label: "Data & AI in industry",
      description: "Smart factories, robots and automation",
      sortOrder: 5,
    },
    {
      id: "opt-6",
      key: "something-else",
      label: "Something else",
      description: "Tell us your idea!",
      sortOrder: 6,
    },
  ],
};

/** Design-reference sample (248 responses → 26/22/16/14/12/10%). Mock only. */
const SEED_COUNTS: Record<string, number> = {
  "opt-1": 64,
  "opt-2": 55,
  "opt-3": 40,
  "opt-4": 35,
  "opt-5": 30,
  "opt-6": 24,
};

const STORAGE_KEY = "adipec-vote-mock-v1";
const CHANNEL = "adipec-vote-mock";

interface Store {
  counts: Record<string, number>;
  keys: Record<string, VoteAccepted>;
}

function delay(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new VoteError("TIMEOUT"));
    });
  });
}

export class MockVotingService implements VotingService {
  readonly isSimulated = true;
  private memory: Store | null = null;

  constructor(private opts: { latencyMs?: number; seed?: boolean } = {}) {}

  private read(): Store {
    const fresh: Store = { counts: this.opts.seed === false ? {} : { ...SEED_COUNTS }, keys: {} };
    if (typeof localStorage === "undefined") return (this.memory ??= fresh);
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Store) : fresh;
    } catch {
      return fresh;
    }
  }

  private write(s: Store) {
    if (typeof localStorage === "undefined") {
      this.memory = s;
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  }

  private snapshot(questionId: string): ResultsSnapshot {
    const s = this.read();
    const { totalVotes, results } = computeResults(
      MOCK_QUESTION.options.map((o) => ({ optionId: o.id, count: s.counts[o.id] ?? 0 })),
    );
    return { questionId, totalVotes, results, generatedAt: new Date().toISOString() };
  }

  async getActiveQuestion(
    _opts?: AbortSignal | { signal?: AbortSignal; eventId?: string },
    _maybeEventId?: string,
  ) {
    // Immediate return of the active mock question to avoid timing/abort race conditions.
    return Promise.resolve(MOCK_QUESTION);
  }

  async submitVote(input: VoteSubmission, signal?: AbortSignal): Promise<VoteAccepted> {
    await delay(this.opts.latencyMs ?? 700, signal);
    if (input.questionId !== MOCK_QUESTION.id) throw new VoteError("QUESTION_UNAVAILABLE");
    if (MOCK_QUESTION.status !== "active") throw new VoteError("POLL_CLOSED");
    if (!MOCK_QUESTION.options.some((o) => o.id === input.optionId))
      throw new VoteError("INVALID_OPTION");

    const s = this.read();
    const existing = s.keys[input.idempotencyKey];
    if (existing) return existing; // safe retry: same key never counts twice

    const accepted: VoteAccepted = {
      voteId: `mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      questionId: input.questionId,
      optionId: input.optionId,
      acceptedAt: new Date().toISOString(),
    };
    s.counts[input.optionId] = (s.counts[input.optionId] ?? 0) + 1;
    s.keys[input.idempotencyKey] = accepted;
    this.write(s);
    if (typeof BroadcastChannel !== "undefined") {
      const bc = new BroadcastChannel(CHANNEL);
      bc.postMessage("changed");
      bc.close();
    }
    return accepted;
  }

  async getResults(questionId: string, signal?: AbortSignal) {
    await delay(this.opts.latencyMs ?? 150, signal);
    return this.snapshot(questionId);
  }

  subscribeResults(questionId: string, onSnapshot: (s: ResultsSnapshot) => void) {
    if (typeof window === "undefined") return () => {};
    const push = () => onSnapshot(this.snapshot(questionId));
    const bc = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(CHANNEL) : null;
    bc?.addEventListener("message", push);
    const onStorage = (e: StorageEvent) => e.key === STORAGE_KEY && push();
    window.addEventListener("storage", onStorage);
    return () => {
      bc?.close();
      window.removeEventListener("storage", onStorage);
    };
  }
}
