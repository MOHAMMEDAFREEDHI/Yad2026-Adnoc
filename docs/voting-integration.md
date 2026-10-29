# ADIPEC 2026 voting — integration notes

Status: frontend complete against **simulated** data. Nothing is written to AWS RDS yet.

## Routes
- `/vote` — mobile flow (welcome → choose → thank-you), single route with internal steps.
- `/display` — 1920x1080 LED results stage, scaled to fit the screen; context menu, drag and clicks blocked; cursor hides after 3s idle.
- `/` redirects to `/vote`. Final `/vote` + `/interactive` hosting paths still to be confirmed with the repo owner.

## Data layer
- Contracts: `src/features/voting/types.ts` (`VotingService`).
- Swap point: `src/features/voting/service.ts` → replace `MockVotingService` with an HTTP client.
- Mock: localStorage + BroadcastChannel; only syncs tabs in the same browser. Seeded with the design sample (248 votes).
- Percentages: `computeResults` (largest remainder, always sums to 100). Backend should return the same shape.

## Expected API (proposal — to agree with backend developer)
- `GET  /api/questions/active` → `Question`
- `POST /api/votes` `{questionId, optionId, idempotencyKey}` → `201 VoteAccepted` only after commit.
  Errors: `409 DUPLICATE_VOTE`, `410 POLL_CLOSED`, `422 INVALID_OPTION`, `404 QUESTION_UNAVAILABLE`, `5xx SERVER`.
  `idempotencyKey` should be unique in `votes` so retries never double count.
- `GET  /api/questions/:id/results` → `ResultsSnapshot` (computed from accepted votes).
- Realtime: WebSocket/SSE pushing `ResultsSnapshot`; the display always refetches on reconnect.

## Open items
- Original assets: backgrounds (Asset 2@3x.png, LED background), card images, logo (Adnoc Logo 2.png), icon set, ADNOC Sans font. Interim crops/fallbacks are in `src/assets/interim`.
- Duplicate-vote policy (currently: per-submission idempotency only; "Back to home" allows another vote).
- Backend hosting, network path to RDS, DB user permissions, migrations capturing existing tables.
- Production QR code URL (not generated until the domain is confirmed).
