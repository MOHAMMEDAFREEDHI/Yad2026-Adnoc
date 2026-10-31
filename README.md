# ADNOC Young Voting Microsite

Interactive voting microsite and real-time LED results display engineered for the ADNOC Young presentation at ADIPEC 2026.

This project delivers an interactive voting journey for attendees on mobile devices and feeds aggregated voting telemetry into the main venue's portrait LED display.

---

## 1. Project Overview & Features

- **Mobile Attendee Experience (`/vote`)**:
  - Three-step progressive flow: **Welcome** &rarr; **Question / Choices** &rarr; **Thank You**.
  - Dynamic responsive layouts optimized for mobile devices (`360×800`, `375×812`, `390×844`, `402×832`).
  - Seamless background video loop playback with accessible static poster fallback.
- **Venue Portrait LED Stage (`/display`)**:
  - Real-time animated tally for the 9:16 portrait LED venue screen (`2160×3840` native resolution).
  - Largest-remainder percentage distribution guaranteeing all option tallies sum to exactly 100%.
  - Kiosk hygiene controls (cursor hiding on inactivity, context-menu prevention).
- **Abuse Prevention & Anonymous Voter Identity**:
  - Integrated with **Fingerprint Pro** (`@fingerprint/react` and Server API v4) for cross-browser, incognito, and cleared-cookie device identification.
  - Authoritative server-side verification: the client event ID is validated via secure HTTPS to Fingerprint Pro Server API before accepting any vote.
  - Zero raw visitor IDs stored in the database: server computes an authoritative HMAC-SHA256 (`"fp:" + visitorId`) using `VISITOR_HMAC_SECRET`.
  - Atomic database transactions in PostgreSQL ensuring exactly one vote per verified device with idempotent retry protection.
- **Standalone Architecture**:
  - The voting microsite is completely decoupled from adjacent interactive exhibition apps, connecting through clean HTTP REST contracts.

---

## 2. Technology Stack

- **Framework**: [React 19](https://react.dev/) + [TanStack Start](https://tanstack.com/start) / [TanStack Router](https://tanstack.com/router)
- **Styling**: [Tailwind CSS v4](https://tailwindcss.com/) with curated CSS tokens in `src/styles.css`
- **Component Primitives**: Radix UI primitives & Lucide Icons
- **Database**: AWS RDS PostgreSQL with TLS verification (`pg` connection pool)
- **Device Identification**: Fingerprint Pro Web SDK & Server API v4 (Asia Pacific region)
- **Server Runtime / Deployment**: Node.js & Nitro (configured for Cloudflare / Node server deployments)
- **Testing & Tooling**: [Vitest](https://vitest.dev/), React Testing Library, ESLint, TypeScript 5.8

---

## 3. Project Structure

```
├── certs/                      # TLS certificates / CA bundles for AWS RDS
├── db/
│   ├── migrations/             # SQL schema migrations (0001_baseline.sql, 0002_event_participations.sql)
│   └── seed/                   # Approved ADIPEC 2026 seed questions and options
├── docs/
│   ├── backend.md              # Detailed API specifications, JSON contracts, and database architecture
│   └── voting-integration.md   # Developer handoff notes and integration checklist
├── scripts/
│   ├── health.mjs              # Read-only database connectivity and TLS health check script
│   ├── migrate.mjs             # Idempotent database migration runner
│   └── seed.mjs                # Content seeder (draft mode and --activate flag)
├── src/
│   ├── assets/                 # Approved video, logo, and artwork assets
│   ├── components/             # Reusable UI components and FingerprintAppProvider
│   ├── features/voting/        # Core voting domain logic, interfaces, presentation, and mock services
│   ├── lib/                    # Error capture, reporting, and utility helpers
│   ├── routes/                 # File-based TanStack routes (/vote, /display, /api/*)
│   ├── server/                 # Server-only modules (database pool, repository, visitor HMAC, fingerprint)
│   ├── test/                   # Comprehensive unit, integration, and flow test suites
│   ├── server.ts               # Server entry point with SSR error boundaries and cookie management
│   └── styles.css              # Global styles, design tokens, and theme definitions
├── package.json
├── tsconfig.json
└── vite.config.ts
```

---

## 4. Local Development Setup

### Prerequisites

- **Node.js**: Version 20.x or higher (Node 22+ recommended)
- **npm**: Version 10+

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd blueprint-pixel-garden

# Install dependencies
npm install
```

### Environment Configuration

Copy the example environment file:

```bash
cp .env.example .env
```

Key environment settings in `.env`:

```env
# Frontend: leave empty for local development using MockVotingService
# Set to "/" or full URL when connecting to the live backend API
VITE_VOTE_API_URL=

# Fingerprint Pro Configuration
VITE_FINGERPRINT_PUBLIC_API_KEY=your_public_browser_key
FINGERPRINT_SECRET_API_KEY=your_server_secret_key
FINGERPRINT_REGION=ap

# Database Connection (AWS RDS PostgreSQL)
DATABASE_URL=postgresql://user:password@your-rds-host:5432/postgres
DB_SSL=true
DB_SSL_REJECT_UNAUTHORIZED=true

# Security & Anti-Abuse
VOTE_POLICY=one_vote_per_browser
VISITOR_HMAC_SECRET=your_secure_server_hmac_secret
CORS_ALLOWED_ORIGINS=http://localhost:8081,https://yad2026.vercel.app
```

### Starting the Dev Server

```bash
npm run dev
```

The application will be accessible at:
- **Mobile Voting**: [http://localhost:8081/vote](http://localhost:8081/vote)
- **LED Stage Display**: [http://localhost:8081/display](http://localhost:8081/display)
- **API Health**: [http://localhost:8081/api/health](http://localhost:8081/api/health)

---

## 5. Database Setup & Migrations

The application manages PostgreSQL schema migrations through dedicated scripts:

1. **Verify Database Connectivity**:
   ```bash
   npm run db:health
   ```
   Validates TLS handshake (`pg_stat_ssl`) and confirms existing schema tables.

2. **Baseline an Existing Database**:
   ```bash
   npm run db:baseline
   ```
   Records `0001_baseline.sql` as applied without re-running `CREATE TABLE` commands against an existing database.

3. **Run Migrations on a Fresh Database**:
   ```bash
   npm run db:migrate
   ```
   Applies pending migrations in sequence (e.g. `0002_event_participations.sql` for visitor participation tracking).

4. **Seed Content**:
   ```bash
   # Safe default: seeds event and question in 'draft' status with 0 votes
   npm run db:seed

   # Open the poll for live voting:
   npm run db:seed -- --activate
   ```

---

## 6. One-Vote-per-Visitor Protection

To ensure integrity during live voting at ADIPEC 2026:

1. **Frontend Identification**: When an attendee loads `/vote`, Fingerprint Pro evaluates hardware attributes, browser signals, and device fingerprints to generate an identification event.
2. **Server Verification**: The backend verifies this `eventId` directly against the Fingerprint Server API (`https://ap.api.fpjs.io/v4/events/{id}`) with Bearer authentication and origin verification.
3. **HMAC Cryptographic Anonymization**: The server hashes the returned visitor ID:
   $$\text{HMAC-SHA256}(\text{"fp:"} + \text{visitorId}, \text{VISITOR\_HMAC\_SECRET})$$
   Raw visitor identifiers and IP addresses are discarded, protecting attendee privacy while establishing a persistent identity.
4. **Atomic Transaction Enforcement**:
   - The hash is inserted into `event_participations` with a database unique constraint `UNIQUE (event_id, visitor_id_hash)`.
   - The vote and the participation record commit atomically in a single PostgreSQL transaction.
   - Any duplicate submission attempt from the same browser, incognito window, or alternate browser on the same device is rejected with HTTP `409` (`ALREADY_VOTED`).

---

## 7. Quality Assurance & Verification

Run the verification suites:

```bash
# Type checking
npx tsc --noEmit

# Linting & code style
npm run lint

# Automated unit & contract tests
npm test

# Run PostgreSQL integration tests against live RDS
RUN_PG_INTEGRATION=1 npm test
```

---

## 8. Production Build & Deployment

Generate the production bundle:

```bash
npm run build
```

This compiles:
- Optimized client assets in `.output/public/`
- Server-side rendering (SSR) artifacts in `.output/server/`

For previewing the production build locally:

```bash
npm run preview
```

Refer to [`docs/backend.md`](docs/backend.md) and [`docs/voting-integration.md`](docs/voting-integration.md) for full endpoint specifications, JSON payload schemas, and deployment notes.
