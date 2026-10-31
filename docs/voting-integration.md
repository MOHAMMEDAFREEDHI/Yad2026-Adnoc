# ADIPEC 2026 Voting — Integration & Handover Notes

## Current Status

- **Mobile Frontend (`/vote`)**: Complete and verified across reference and common phone viewports (`360×800`, `375×812`, `390×844`, `402×832`).
- **LED Results Display (`/display`)**: Route and implementation preserved; visual redesign paused pending revised LED screen specifications.
- **Backend API (`/api/*`) & AWS RDS PostgreSQL**: Implemented and verified end-to-end against the existing AWS RDS `postgres` database (`events`, `questions`, `answer_options`, `votes`).
- **Production Database State**: Baseline migration (`0001_baseline.sql`) recorded in `schema_migrations`; approved `adipec-2026` event, question, and 6 options seeded in **`draft`** status with **`0` votes**.
- **Default Local Mode**: `VITE_VOTE_API_URL` is left empty in `.env.example` / `.env` during UI development so `/vote` uses `MockVotingService` until live cutover.

## Routes

- `/vote` — Mobile flow (`welcome` → `choose` → `thanks`), single route with internal step state.
- `/display` — LED results stage (currently paused for specification updates; compatible with the live results contract).
- `/` — Redirects to `/vote`.
- `/api/health`, `/api/questions/active`, `/api/votes`, `/api/questions/:id/results` — Server-only API routes (see [`docs/backend.md`](./backend.md) for full JSON schemas).

## Data Layer & Switching to Live API

- Contracts: [`src/features/voting/types.ts`](../src/features/voting/types.ts) (`VotingService`).
- Swap point: [`src/features/voting/service.ts`](../src/features/voting/service.ts) returns `HttpVotingService` when `VITE_VOTE_API_URL` is non-empty (e.g., `VITE_VOTE_API_URL=/` for same-origin deployment) and `MockVotingService` when empty.
- Percentages: [`src/features/voting/results.ts`](../src/features/voting/results.ts) (`computeResults` — largest-remainder integer rounding summing to `100%`, shared by both backend and mock service).

## Pending External Dependencies

1. **Shared Hosting & Subfolder Integration**: Confirm the target Node.js hosting environment and subfolder path with the repository owner so the Nitro preset (`node-server`) and RDS security-group rules can be finalised.
2. **Repeat-Voting Policy**: Anonymous one-vote-per-browser is implemented and active (`VOTE_POLICY=one_vote_per_browser`) using backend HttpOnly cookies, server-side HMAC-SHA256, and atomic `event_participations` RDS table with unique constraints. Request-level UUID idempotency remains active.
3. **Brand Font Files**: `ADNOC Sans` font files (currently falling back cleanly to `Inter` in `--font-brand`).
4. **LED Display Revision**: Revised dimensions and assets for `/display` (currently paused).
