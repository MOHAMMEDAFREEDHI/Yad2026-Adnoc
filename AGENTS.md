# ADNOC Young Voting Microsite — Engineering Guidelines

## Architecture & Code Boundaries

- **Voting UI Contract**: The frontend voting UI components interact exclusively through the `VotingService` interface (`src/features/voting/types.ts`). Swap between simulated mode (`MockVotingService`) and live HTTP mode (`HttpVotingService`) in `src/features/voting/service.ts` via `VITE_VOTE_API_URL`.
- **Database Isolation**: Browser bundles must never import `pg`, database pools, or server secrets. All PostgreSQL access is strictly confined to server-side routes (`src/server/` and `src/routes/api.*.ts`).
- **Visitor Identification & Anti-Abuse**:
  - Browser identification is powered by Fingerprint Pro (`@fingerprint/react`) on the client and verified server-side (`src/server/fingerprint.ts`).
  - Visitor IDs are never stored raw in AWS RDS; all participation records store server-side HMAC-SHA256 hashes (`src/server/visitor.ts`).
  - Database transactions enforce atomic participation and vote insertion with unique constraints.
- **Design System**: Visual values and typography live as CSS tokens and utilities in `src/styles.css`.
- **Documentation**: For backend schema and API specifications, refer to `docs/backend.md`. For overall integration details, refer to `docs/voting-integration.md`.
