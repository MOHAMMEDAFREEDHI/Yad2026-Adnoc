# ADNOC Young Voting Microsite — Integration & Handover Notes

## Current Status

- **Mobile Attendee Flow (`/vote`)**: Complete and verified across reference and common phone viewports (`360×800`, `375×812`, `390×844`, `402×832`).
- **Venue LED Results Display (`/display`)**: Preserved for the portrait LED screen (`2160×3840`), compatible with the live results aggregation contract.
- **Backend API (`/api/*`) & AWS RDS PostgreSQL**: Integrated directly into server routes; verified end-to-end against the AWS RDS `postgres` instance (`events`, `questions`, `answer_options`, `votes`, `event_participations`).
- **Device Protection**: Fingerprint Pro Web SDK integrated with Server API v4 regional verification (`ap` region), server-side HMAC hashing, and unique constraint enforcement.
- **Production Database State**: Baseline migration (`0001_baseline.sql`) and participation migration (`0002_event_participations.sql`) applied; approved `adipec-2026` event, question, and 6 options seeded in `draft` status with `0` votes.
- **Default Local Mode**: `VITE_VOTE_API_URL` is left empty in `.env.example` during frontend-only development so `/vote` uses `MockVotingService` until cutover. Setting `VITE_VOTE_API_URL=/` activates the live `HttpVotingService`.

---

## Route Overview

- `/vote` — Mobile attendee voting journey (`welcome` &rarr; `choose` &rarr; `thanks`), single route with internal step management.
- `/display` — Venue portrait LED results stage (100% sum largest-remainder distribution).
- `/` — Permanent redirect to `/vote`.
- `/api/health`, `/api/questions/active`, `/api/votes`, `/api/questions/:id/results` — Server API endpoints (see [`docs/backend.md`](./backend.md) for complete JSON schemas).

---

## Data Layer & Switching to Live API

- **Service Interface**: Defined in [`src/features/voting/types.ts`](../src/features/voting/types.ts) (`VotingService`).
- **Implementation Switch**: [`src/features/voting/service.ts`](../src/features/voting/service.ts) dynamically provides `HttpVotingService` when `VITE_VOTE_API_URL` is set, and falls back to `MockVotingService` when unset.
- **Percentage Calculation**: [`src/features/voting/results.ts`](../src/features/voting/results.ts) (`computeResults` — largest-remainder integer rounding summing to `100%`, shared by both server repository and mock service).

---

## Verification & Handoff Checklist

1. **Independent Hosting & Subfolder Mount**:
   The voting microsite is self-contained. When deploying alongside the colleague's exhibition app, maintain separation via path routing (e.g., `/voting` or a dedicated subdomain) or configure the Nitro preset (`node-server`) for your hosting platform.
2. **Device Verification Configuration**:
   Ensure `VITE_FINGERPRINT_PUBLIC_API_KEY` and `FINGERPRINT_SECRET_API_KEY` are provided in production environment secrets.
3. **Database Secrets**:
   Provide `DATABASE_URL` (or `PG*` parameters) with TLS enabled (`DB_SSL=true`, `DB_SSL_REJECT_UNAUTHORIZED=true`).
4. **Brand Font Files**:
   `ADNOC Sans` font files can be loaded into `src/styles.css` under `--font-brand` (currently falling back cleanly to `Inter`).
