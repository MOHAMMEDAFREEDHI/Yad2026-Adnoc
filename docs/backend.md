# ADNOC Voting Microsite — Backend & API Documentation

## 1. Architecture Overview

The backend is integrated directly into the TanStack Start application and never exposes PostgreSQL credentials or database connections to the browser:

- **Server Routes (`src/routes/api.*.ts`)**:
  - [`src/routes/api.questions.active.ts`](../src/routes/api.questions.active.ts) → `GET /api/questions/active`
  - [`src/routes/api.votes.ts`](../src/routes/api.votes.ts) → `POST /api/votes`
  - [`src/routes/api.questions.$id.results.ts`](../src/routes/api.questions.$id.results.ts) → `GET /api/questions/:id/results`
  - [`src/routes/api.health.ts`](../src/routes/api.health.ts) → `GET /api/health`
- **HTTP Handlers ([`src/server/handlers.ts`](../src/server/handlers.ts))**: Zod input validation, CORS origin allow-list, fixed-window per-IP rate limiting, and structured error mapping (`{ error: { code, message } }`).
- **Repository ([`src/server/repository.ts`](../src/server/repository.ts))**: SQL queries, transaction-safe vote submission, idempotency verification, and authoritative vote-count aggregation using [`computeResults`](../src/features/voting/results.ts).
- **Database Pool ([`src/server/db.ts`](../src/server/db.ts))**: Shared singleton `pg.Pool` with AWS RDS TLS support (`DB_SSL=true`, `DB_SSL_CA_BASE64` on serverless/Vercel, or `DB_SSL_CA_PATH` locally).
- **Frontend Client ([`src/features/voting/http-service.ts`](../src/features/voting/http-service.ts))**: Implements [`VotingService`](../src/features/voting/types.ts). Activated in [`src/features/voting/service.ts`](../src/features/voting/service.ts) when `VITE_VOTE_API_URL` is set (`VITE_VOTE_API_URL=/` for same-origin deployment). When `VITE_VOTE_API_URL` is empty, the frontend uses [`MockVotingService`](../src/features/voting/mock-service.ts).

---

## 2. Environment Configuration & Database Setup

1. Copy [`.env.example`](../.env.example) to `.env` (which is git-ignored) and configure `DATABASE_URL` (or `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`). Never prefix backend secrets with `VITE_`.
2. For full AWS RDS TLS verification:
   - On serverless/Vercel: set `DB_SSL_CA_BASE64` to the base64-encoded PEM CA certificate.
   - In local development: set `DB_SSL_CA_PATH` to the certificate file path (e.g. `./certs/aws-rds/ap-south-1-bundle.pem`).
   - Always keep `DB_SSL=true` and `DB_SSL_REJECT_UNAUTHORIZED=true`.
3. **Read-Only Health Check**:
   ```bash
   npm run db:health
   ```
   Verifies connectivity, TLS status (`pg_stat_ssl`), and presence of `events`, `questions`, `answer_options`, and `votes`. Run this both locally and in the target deployment host.
4. **Migration Baseline & Reproducibility**:
   - **Existing AWS RDS database**: Run `npm run db:baseline` to record [`db/migrations/0001_baseline.sql`](../db/migrations/0001_baseline.sql) in `schema_migrations` (`baselined = true`) without executing `CREATE TABLE` against existing tables.
   - **Fresh database**: Run `npm run db:migrate`. (The runner refuses to execute `0001_baseline.sql` if `public.events` already exists.)
5. **Seeding Approved Voting Content**:
   - **Draft mode (safe default)**: `npm run db:seed` — upserts the `adipec-2026` event (`status = 'draft'`), question (`status = 'draft'`), and 6 active answer options from [`db/seed/voting-content.json`](../db/seed/voting-content.json). Inserts zero votes.
   - **Activate for live voting**: `npm run db:seed -- --activate` — sets event status to `EVENT_OPEN_STATUS` (`open`) and question status to `QUESTION_ACTIVE_STATUS` (`active`).

---

## 3. API Endpoints & Exact JSON Contracts

All responses include `Content-Type: application/json` and `Cache-Control: no-store`.
All error responses follow the envelope:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable description."
  }
}
```

### 3.1 `GET /api/questions/active`

Returns the currently open event, its first active question, and all active answer options ordered by `display_order ASC`.

- **Success (`200 OK`)**:
  ```json
  {
    "event": {
      "id": "eb6723bf-a46c-4955-9510-d51627aba2a2",
      "name": "ADIPEC 2026",
      "slug": "adipec-2026"
    },
    "question": {
      "id": "ffbad129-5b4e-40fe-94d8-cf5e68976d02",
      "prompt": "Your future in UAE industry",
      "subtitle": "Which one is YOU?",
      "status": "active"
    },
    "options": [
      {
        "id": "2ab88c3f-3f66-4ca6-9c4d-e9cdced0bb3f",
        "label": "Business owner",
        "description": "Start your own factory or company",
        "imageUrl": null,
        "iconKey": "business-owner",
        "displayOrder": 1
      }
    ]
  }
  ```
- **Frontend Mapping (`HttpVotingService.getActiveQuestion`)**:
  - `question.id` → `Question.id`
  - `event.id` → `Question.eventId`
  - `question.prompt` → `Question.title`
  - `question.subtitle` → `Question.prompt`
  - `options[].iconKey` → `AnswerOption.key`
  - `options[].displayOrder` → `AnswerOption.sortOrder`
- **Errors**:
  - `404 Not Found` (`code: "QUESTION_UNAVAILABLE"`): No open event / active question exists, or the active question has no active options. Draft/closed questions are never returned as active.
  - `429 Too Many Requests` (`code: "RATE_LIMITED"`): Exceeded `RATE_LIMIT_READS_PER_MIN`.
  - `500 Internal Server Error` (`code: "SERVER"`): Unexpected server/database error.

---

### 3.2 `POST /api/votes`

Validates and persists a vote inside a PostgreSQL transaction (`BEGIN ... COMMIT`). Returns success **only after** the transaction commits.

- **Request Body** (all fields required UUID strings):
  ```json
  {
    "questionId": "ffbad129-5b4e-40fe-94d8-cf5e68976d02",
    "answerOptionId": "2ab88c3f-3f66-4ca6-9c4d-e9cdced0bb3f",
    "idempotencyKey": "10000000-0000-4000-8000-000000000001"
  }
  ```
  _(Note: `HttpVotingService.submitVote` maps frontend `input.optionId` to `answerOptionId` in the POST body, and maps `answerOptionId` back to `VoteAccepted.optionId`.)_
- **Success — First Submission (`201 Created`)**:
  ```json
  {
    "voteId": "1037a729-9e39-4dcc-b5a5-3254f7249efa",
    "questionId": "ffbad129-5b4e-40fe-94d8-cf5e68976d02",
    "answerOptionId": "2ab88c3f-3f66-4ca6-9c4d-e9cdced0bb3f",
    "acceptedAt": "2026-10-30T10:48:36.945Z",
    "replayed": false
  }
  ```
- **Success — Idempotent Replay (`200 OK`)**:
  - When a request with an already-committed `idempotencyKey` is received with the **same** `questionId` and `answerOptionId`, the original committed record is returned with `"replayed": true` and HTTP `200`. No second row is inserted.
- **Errors**:
  - `400 Bad Request` (`code: "INVALID_REQUEST"`): Malformed JSON body → mapped by `HttpVotingService` to `SERVER`.
  - `422 Unprocessable Entity` (`code: "INVALID_REQUEST"` or `"INVALID_OPTION"`): Non-UUID fields, inactive option, or option does not belong to `questionId` → mapped by `HttpVotingService` to `INVALID_OPTION`.
  - `404 Not Found` (`code: "QUESTION_UNAVAILABLE"`): `questionId` does not exist → mapped by `HttpVotingService` to `QUESTION_UNAVAILABLE`.
  - `410 Gone` (`code: "POLL_CLOSED"`): Event is not `open` or question is not `active` → mapped by `HttpVotingService` to `POLL_CLOSED`.
  - `409 Conflict` (`code: "IDEMPOTENCY_CONFLICT"`): Same `idempotencyKey` reused with a different `questionId` or `answerOptionId` → mapped by `HttpVotingService` to `DUPLICATE_VOTE`.
  - `429 Too Many Requests` (`code: "RATE_LIMITED"`): Exceeded `RATE_LIMIT_VOTES_PER_MIN`.
  - `500 Internal Server Error` (`code: "SERVER"`): Database error (transaction rolled back; no partial write).

---

### 3.3 `GET /api/questions/:id/results`

Computes authoritative vote counts and largest-remainder integer percentages from committed rows in `votes` for all active `answer_options` of question `:id`.

- **Success (`200 OK`)**:
  ```json
  {
    "questionId": "ffbad129-5b4e-40fe-94d8-cf5e68976d02",
    "totalResponses": 248,
    "generatedAt": "2026-10-30T10:48:40.001Z",
    "results": [
      {
        "answerOptionId": "2ab88c3f-3f66-4ca6-9c4d-e9cdced0bb3f",
        "label": "Business owner",
        "voteCount": 64,
        "percentage": 26
      }
    ]
  }
  ```
- **Calculation Guarantees**:
  - Every active option (`is_active = true`) is included in `display_order ASC`, even when `voteCount === 0`.
  - `totalResponses` is the exact sum of committed votes across active options.
  - When `totalResponses === 0`, every option returns `voteCount: 0` and `percentage: 0`.
  - When `totalResponses > 0`, integer percentages are computed via the largest-remainder method (`(voteCount / totalResponses) * 100`) and always sum to **100%**.
- **Frontend Mapping (`HttpVotingService.getResults`)**:
  - `totalResponses` → `ResultsSnapshot.totalVotes`
  - `results[].answerOptionId` → `OptionResult.optionId`
  - `results[].voteCount` → `OptionResult.count`
  - `results[].percentage` → `OptionResult.percent`
- **Errors**:
  - `422 Unprocessable Entity` (`code: "INVALID_QUESTION"`): `:id` is not a valid UUID.
  - `404 Not Found` (`code: "QUESTION_UNAVAILABLE"`): Question `:id` does not exist.

---

### 3.4 `GET /api/health`

Executes a read-only database check (`current_database()` and `pg_stat_ssl`).

- **Success (`200 OK`)**:
  ```json
  {
    "status": "ok",
    "database": "postgres",
    "ssl": true
  }
  ```
- **Failure (`503 Service Unavailable`)**:
  ```json
  {
    "status": "unavailable"
  }
  ```

---

## 4. Voting Policy & Idempotency vs. Visitor Restrictions

- **Request Idempotency (Implemented & Enforced)**:
  - Before submitting a vote, the frontend generates a v4 UUID (`idempotencyKey`) and keeps that same key in memory (`keyRef`) if the user retries a failed submission for the same option.
  - PostgreSQL enforces `UNIQUE (idempotency_key)` on `votes`. Network retries or duplicate packet delivery can never create a second vote row.
  - Same `idempotencyKey` + same option returns HTTP `200` with `"replayed": true`.
  - Same `idempotencyKey` + different option returns HTTP `409` with code `"IDEMPOTENCY_CONFLICT"`.

- **Anonymous One-Time Voting with Fingerprint Pro & HMAC Integrity**:
  - **Device Identification**: When an attendee interacts with `/vote`, Fingerprint Pro identifies the browser/device and issues an identification event ID.
  - **Authoritative Server Verification (`src/server/fingerprint.ts`)**:
    - The backend validates the event ID via HTTPS with the Fingerprint Server API v4 regional endpoint (`https://ap.api.fpjs.io/v4/events/{event_id}`) using Bearer authentication (`Authorization: Bearer <secretKey>`).
    - The event origin is strictly validated against allowed origins (`CORS_ALLOWED_ORIGINS`). Events from unapproved origins return HTTP `403 FINGERPRINT_ORIGIN_MISMATCH`.
    - If the event does not exist in the configured workspace, the backend returns HTTP `403 FINGERPRINT_EVENT_NOT_FOUND`.
    - If the verification service is temporarily down, the backend returns HTTP `503 FINGERPRINT_UNAVAILABLE` (votes are never accepted without verification).
  - **Server-Side Namespaced HMAC-SHA256 (`src/server/visitor.ts`)**:
    - The backend computes a server-side HMAC-SHA256 hash using the secret salt:
      $$\text{hash} = \text{HMAC-SHA256}("fp:" + \text{visitorId}, \text{VISITOR\_HMAC\_SECRET})$$
    - Raw visitor IDs are never saved in AWS RDS, guaranteeing attendee privacy.
  - **Event Participation Storage (`event_participations`)**:
    - Stores `(id, event_id, visitor_id_hash, created_at)`.
    - Enforces database constraint `CONSTRAINT event_participations_event_visitor_unique UNIQUE (event_id, visitor_id_hash)`.
  - **Atomic Transaction**: The event participation record and vote record are saved atomically inside a single PostgreSQL transaction (`BEGIN ... COMMIT`). If either write fails, the entire transaction rolls back.
  - **Subsequent Visit & Repeat Voting Rejection**:
    - Subsequent visits to `/api/questions/active` from the same device (including across Chrome, Edge, Safari, and incognito sessions) return `"hasVoted": true`.
    - Duplicate vote submissions are rejected with HTTP `409` and error code `"ALREADY_VOTED"`:
      ```json
      {
        "error": {
          "code": "ALREADY_VOTED",
          "message": "You've already voted! Your response has been successfully recorded. Thank you for participating."
        }
      }
      ```
    - The voting UI displays: _"You've already voted! Your response has been successfully recorded. Thank you for participating."_ and disables the Proceed button.
  - **Fallback / Unconfigured Mode**: In local development when `FINGERPRINT_SECRET_API_KEY` is not set, the backend falls back to standard HTTP-only cookie HMAC tracking (`adnoc_vid`) or simulated mode.
  - Setting `VOTE_POLICY=unrestricted` disables the one-vote-per-visitor restriction while preserving request idempotency.

---

## 5. Subfolder & Shared Repository Integration Notes

- All application imports use relative paths or the `@/` alias mapped to `./src` in `tsconfig.json`.
- Server database modules live strictly under `src/server/` and are dynamically imported inside TanStack Start `server.handlers` in `src/routes/api.*.ts`, keeping `pg` and `node:fs` out of client bundles.
- The Nitro build preset in `vite.config.ts` is kept at its default until the other developer confirms the target Node.js hosting platform (where `node-server` preset and RDS security-group rules will be finalised).
