import { computeResults } from "@/features/voting/results";

import { loadConfig } from "./config";
import type { Db } from "./db";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface ActiveQuestionPayload {
  event: { id: string; name: string; slug: string };
  question: { id: string; prompt: string; subtitle: string | null; status: string };
  hasVoted?: boolean;
  votedOption?: {
    id: string;
    label: string;
    description: string | null;
    imageUrl: string | null;
    iconKey: string | null;
    displayOrder: number;
  } | null;
  options: {
    id: string;
    label: string;
    description: string | null;
    imageUrl: string | null;
    iconKey: string | null;
    displayOrder: number;
  }[];
}

export interface ResultsPayload {
  questionId: string;
  totalResponses: number;
  generatedAt: string;
  results: { answerOptionId: string; label: string; voteCount: number; percentage: number }[];
}

export interface AcceptedVote {
  voteId: string;
  questionId: string;
  answerOptionId: string;
  acceptedAt: string;
  replayed: boolean;
}

export async function getActiveQuestion(
  db: Db,
  visitorIdHash?: string | null,
): Promise<ActiveQuestionPayload> {
  const cfg = loadConfig();
  const q = await db.query<{
    event_id: string;
    event_name: string;
    event_slug: string;
    id: string;
    prompt: string;
    subtitle: string | null;
    status: string;
  }>(
    `SELECT e.id AS event_id, e.name AS event_name, e.slug AS event_slug,
            q.id, q.prompt, q.subtitle, q.status
       FROM questions q JOIN events e ON e.id = q.event_id
      WHERE e.status = $1 AND q.status = $2
      ORDER BY q.display_order ASC, q.created_at ASC
      LIMIT 1`,
    [cfg.eventOpenStatus, cfg.questionActiveStatus],
  );
  const row = q.rows[0];
  if (!row)
    throw new ApiError(404, "QUESTION_UNAVAILABLE", "No active question is open for voting.");

  let hasVoted = false;
  let votedOption: ActiveQuestionPayload["votedOption"] = null;
  if (visitorIdHash) {
    const v = await db.query<{
      answer_option_id: string | null;
      label: string | null;
      description: string | null;
      image_url: string | null;
      icon_key: string | null;
      display_order: number | null;
    }>(
      `SELECT COALESCE(ep.answer_option_id, (
                SELECT v.answer_option_id FROM votes v
                 WHERE v.submitted_at = ep.created_at
                 LIMIT 1
              )) AS answer_option_id,
              ao.label, ao.description, ao.image_url, ao.icon_key, ao.display_order
         FROM event_participations ep
         LEFT JOIN answer_options ao ON ao.id = COALESCE(ep.answer_option_id, (
                SELECT v.answer_option_id FROM votes v
                 WHERE v.submitted_at = ep.created_at
                 LIMIT 1
              ))
        WHERE ep.event_id = $1 AND ep.visitor_id_hash = $2
        LIMIT 1`,
      [row.event_id, visitorIdHash],
    );
    if (v.rows.length > 0) {
      hasVoted = true;
      const r = v.rows[0];
      if (r?.answer_option_id && r.label) {
        votedOption = {
          id: r.answer_option_id,
          label: r.label,
          description: r.description,
          imageUrl: r.image_url,
          iconKey: r.icon_key,
          displayOrder: r.display_order ?? 1,
        };
      }
    }
  }

  const o = await db.query<{
    id: string;
    label: string;
    description: string | null;
    image_url: string | null;
    icon_key: string | null;
    display_order: number;
  }>(
    `SELECT id, label, description, image_url, icon_key, display_order
       FROM answer_options WHERE question_id = $1 AND is_active = true
      ORDER BY display_order ASC`,
    [row.id],
  );
  if (o.rows.length === 0)
    throw new ApiError(
      404,
      "QUESTION_UNAVAILABLE",
      "The active question has no active answer options.",
    );
  return {
    event: { id: row.event_id, name: row.event_name, slug: row.event_slug },
    question: { id: row.id, prompt: row.prompt, subtitle: row.subtitle, status: row.status },
    hasVoted,
    votedOption,
    options: o.rows.map((r) => ({
      id: r.id,
      label: r.label,
      description: r.description,
      imageUrl: r.image_url,
      iconKey: r.icon_key,
      displayOrder: r.display_order,
    })),
  };
}

export interface SubmitVoteInput {
  questionId: string;
  answerOptionId: string;
  idempotencyKey: string;
  visitorIdHash?: string | null;
}

export async function submitVote(db: Db, input: SubmitVoteInput): Promise<AcceptedVote> {
  const cfg = loadConfig();
  return db.transaction(async (tx) => {
    // 1. Replay of an already-committed request: same key + same payload => same result.
    const existing = await tx.query<{
      id: string;
      question_id: string;
      answer_option_id: string;
      submitted_at: Date;
    }>(
      "SELECT id, question_id, answer_option_id, submitted_at FROM votes WHERE idempotency_key = $1",
      [input.idempotencyKey],
    );
    const replay = (r: (typeof existing.rows)[number]): AcceptedVote => {
      if (r.question_id !== input.questionId || r.answer_option_id !== input.answerOptionId) {
        throw new ApiError(
          409,
          "IDEMPOTENCY_CONFLICT",
          "This idempotency key was already used for a different vote.",
        );
      }
      return {
        voteId: r.id,
        questionId: r.question_id,
        answerOptionId: r.answer_option_id,
        acceptedAt: new Date(r.submitted_at).toISOString(),
        replayed: true,
      };
    };
    if (existing.rows[0]) return replay(existing.rows[0]);

    // 2. Voting must be open: event open, question active. Fetch event_id.
    const q = await tx.query<{ event_id: string; q_status: string; e_status: string }>(
      `SELECT q.event_id, q.status AS q_status, e.status AS e_status
         FROM questions q JOIN events e ON e.id = q.event_id WHERE q.id = $1`,
      [input.questionId],
    );
    if (!q.rows[0]) throw new ApiError(404, "QUESTION_UNAVAILABLE", "Question not found.");
    if (
      q.rows[0].e_status !== cfg.eventOpenStatus ||
      q.rows[0].q_status !== cfg.questionActiveStatus
    ) {
      throw new ApiError(410, "POLL_CLOSED", "Voting is closed for this question.");
    }
    const eventId = q.rows[0].event_id;

    // 3. Answer must be active and belong to this question.
    const a = await tx.query(
      "SELECT 1 FROM answer_options WHERE id = $1 AND question_id = $2 AND is_active = true",
      [input.answerOptionId, input.questionId],
    );
    if (!a.rows[0])
      throw new ApiError(422, "INVALID_OPTION", "Answer option is not valid for this question.");

    // 4. One-vote-per-browser participation check and atomic persistence
    const enforceParticipation =
      cfg.votePolicy === "one_vote_per_browser" || Boolean(input.visitorIdHash);
    if (enforceParticipation) {
      if (!input.visitorIdHash) {
        throw new ApiError(400, "MISSING_VISITOR", "Visitor identification is required.");
      }
      // Check whether this visitor has already participated in this event
      const already = await tx.query(
        "SELECT 1 FROM event_participations WHERE event_id = $1 AND visitor_id_hash = $2",
        [eventId, input.visitorIdHash],
      );
      if (already.rows.length > 0) {
        throw new ApiError(
          409,
          "ALREADY_VOTED",
          "You've already voted! Your response has been successfully recorded. Thank you for participating.",
        );
      }

      // Record event participation; unique constraint enforces one vote per event & visitor
      const part = await tx.query(
        `INSERT INTO event_participations (event_id, visitor_id_hash, answer_option_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (event_id, visitor_id_hash) DO NOTHING
         RETURNING id`,
        [eventId, input.visitorIdHash, input.answerOptionId],
      );
      if (part.rows.length === 0) {
        // Lost race on event participation with another concurrent request
        const checkReplay = await tx.query<{
          id: string;
          question_id: string;
          answer_option_id: string;
          submitted_at: Date;
        }>(
          "SELECT id, question_id, answer_option_id, submitted_at FROM votes WHERE idempotency_key = $1",
          [input.idempotencyKey],
        );
        if (checkReplay.rows[0]) return replay(checkReplay.rows[0]);
        throw new ApiError(
          409,
          "ALREADY_VOTED",
          "You've already voted! Your response has been successfully recorded. Thank you for participating.",
        );
      }
    }

    // 5. Insert vote; the UNIQUE(idempotency_key) constraint arbitrates concurrent duplicates.
    const ins = await tx.query<{ id: string; submitted_at: Date }>(
      `INSERT INTO votes (question_id, answer_option_id, idempotency_key)
       VALUES ($1, $2, $3) ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id, submitted_at`,
      [input.questionId, input.answerOptionId, input.idempotencyKey],
    );
    if (ins.rows[0]) {
      return {
        voteId: ins.rows[0].id,
        questionId: input.questionId,
        answerOptionId: input.answerOptionId,
        acceptedAt: new Date(ins.rows[0].submitted_at).toISOString(),
        replayed: false,
      };
    }
    // Lost a race with an identical concurrent request: the winner has committed (conflict waits for it).
    const again = await tx.query<{
      id: string;
      question_id: string;
      answer_option_id: string;
      submitted_at: Date;
    }>(
      "SELECT id, question_id, answer_option_id, submitted_at FROM votes WHERE idempotency_key = $1",
      [input.idempotencyKey],
    );
    if (!again.rows[0]) throw new ApiError(503, "SERVER", "Vote could not be confirmed.");
    return replay(again.rows[0]);
  });
}

export async function getResults(db: Db, questionId: string): Promise<ResultsPayload> {
  const exists = await db.query("SELECT 1 FROM questions WHERE id = $1", [questionId]);
  if (!exists.rows[0]) throw new ApiError(404, "QUESTION_UNAVAILABLE", "Question not found.");
  const r = await db.query<{ id: string; label: string; vote_count: string }>(
    `SELECT a.id, a.label, COUNT(v.id) AS vote_count
       FROM answer_options a
       LEFT JOIN votes v ON v.answer_option_id = a.id AND v.question_id = a.question_id
      WHERE a.question_id = $1 AND a.is_active = true
      GROUP BY a.id, a.label, a.display_order
      ORDER BY a.display_order ASC`,
    [questionId],
  );
  const labels = new Map(r.rows.map((x) => [x.id, x.label]));
  const calc = computeResults(r.rows.map((x) => ({ optionId: x.id, count: Number(x.vote_count) })));
  return {
    questionId,
    totalResponses: calc.totalVotes,
    generatedAt: new Date().toISOString(),
    results: calc.results.map((x) => ({
      answerOptionId: x.optionId,
      label: labels.get(x.optionId) ?? "",
      voteCount: x.count,
      percentage: x.percent,
    })),
  };
}
