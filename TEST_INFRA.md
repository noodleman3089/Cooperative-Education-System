# Test Infrastructure — Cooperative Education System (ระบบสหกิจศึกษา)

## Architecture Overview

The end-to-end testing infrastructure is powered by **Playwright** with a fully isolated multi-worker execution model. To ensure high test throughput without cross-test interference, each worker thread runs in a completely segregated sandbox consisting of dedicated web server ports, dedicated PostgreSQL databases, and independent filesystem roots.

```
                  ┌──────────────────────────────────────────────┐
                  │          Playwright Test Runner              │
                  │   (playwright.config.ts · 4 Workers)        │
                  └──────┬────────────┬────────────┬─────────────┘
                         │            │            │
           ┌─────────────┘            │            └─────────────┐
           ▼                          ▼                          ▼
     [Worker 0]                 [Worker 1]                 [Worker 2..N]
  Frontend :5173             Frontend :5174             Frontend :5175..
  Backend  :5000             Backend  :5001             Backend  :5002..
  Database :coop_edu_db      Database :..._e2e_w1       Database :..._e2e_w2..
  Root     :backend/         Root     :e2e/.workers/w1  Root     :e2e/.workers/w2..
```

---

## Isolation Matrix & Worker Slots

Worker allocation is managed centrally via `e2e/helpers/env.ts` and initialized in `playwright.config.ts`:

| Worker Index | Frontend Port | Backend Port | Child Server Port | PostgreSQL Database | Storage Root |
|---|---|---|---|---|---|
| **0** (Primary) | `5173` | `5000` | `5090` | `coop_edu_db` | `backend/` |
| **1** | `5174` | `5001` | `5091` | `coop_edu_db_e2e_w1` | `e2e/.workers/w1/` |
| **2** | `5175` | `5002` | `5092` | `coop_edu_db_e2e_w2` | `e2e/.workers/w2/` |
| **3** | `5176` | `5003` | `5093` | `coop_edu_db_e2e_w3` | `e2e/.workers/w3/` |

### Key Isolation Mechanisms
1. **Database Isolation (`getWorkerDatabaseName`)**:
   - Each worker connects strictly to its assigned database.
   - Worker 0 uses the standard development database `coop_edu_db`.
   - Workers 1..N operate on clone databases with suffix `_e2e_w<N>`.
   - Initial database structure and migrations are seeded automatically via `seedTestData()`.
2. **Port & Vite Bundle Cache Isolation**:
   - Frontends run on `5173 + N` with strict port binding (`--strictPort`).
   - Workers 1..N use isolated Vite cache directories (`node_modules/.vite-e2e-w<N>`) to prevent concurrent cache race conditions.
3. **Filesystem Assets Mirroring**:
   - Private assets (fonts, emblems, PDF templates, simulated signatures) are synced from `backend/secure_private/` to each worker's `e2e/.workers/w<N>/secure_private/` before test execution starts.
4. **Email Suppression Safety (`MAIL_DRY_RUN=true`)**:
   - `backend/.env` is configured with credentials for a live Gmail account.
   - To strictly guarantee zero live emails are sent during automated testing, `MAIL_DRY_RUN: 'true'` is enforced at process start in `playwright.config.ts` and in every spawned backend process.

---

## Concurrency & Reseeding

Database resets occur per-test or per-suite using `seedTestData()` and `reseedDatabase()` (`e2e/helpers/db.ts`):
- **Fast Table Truncation**: Truncates transactional tables (`CASCADE`) while preserving static master tables (provinces, districts, faculties, majors).
- **Deadlock Mitigation**: Parallel `TRUNCATE` operations on PostgreSQL may encounter deadlock (`40P01`). The helper implements automatic exponential backoff retry (up to 3 attempts) to guarantee test suite resilience under high load.

---

## Test Directory Layout

```
e2e/
├── fixtures/               # Mock evidence, sample PDF documents, certificates
├── helpers/                # Core test infrastructure
│   ├── auth.ts             # Authentication helpers (API & UI login)
│   ├── db.ts               # Database query wrappers, transaction helpers, truncate
│   ├── env.ts              # Worker slot allocation and port resolution
│   ├── fixtures.ts         # Custom Playwright fixtures
│   ├── intent.ts           # Placement intent lifecycle helpers
│   ├── nav.ts              # Navigation helpers, role switching, menus
│   ├── semesters.ts        # Academic semester and calendar event helpers
│   └── test-seeder.ts      # Fast database reset and baseline seed
├── documents/              # Official document generation, request forms, removal tests
├── security/               # RBAC, endpoint access controls, removed role guards
├── student/                # Student-facing workflows (01 intent, 06 accommodation, 09 logs, 11 outline, memos)
├── staff/                  # Staff review queues, Dean signing, mentor follow-up, student summary
├── mentor/                 # Workplace mentor certification and evaluation (15 & 16)
└── workflows/              # End-to-end integration journeys
    ├── placement-happy-path.spec.ts         # Placement phase
    ├── assignment-dispatch-accommodation.spec.ts # Dispatch & accommodation phase
    ├── during-internship.spec.ts            # Internship logbook & outline phase
    ├── final-report-and-evaluation.spec.ts  # Final report & mentor grading phase
    ├── placement-replacement.spec.ts        # Off-track placement replacement phase
    ├── memo-to-replacement-flow.spec.ts     # Student memo to placement replacement chain
    └── full-student-journey-e2e.spec.ts     # Unbroken single-journey student lifecycle test
```

---

## Running Tests

All commands must be executed using `npm.cmd` or `npx.cmd` on Windows environments.

### 1. Test Syntax Verification (List Mode - Non-destructive)
Verifies test discovery, file parsing, and syntax validity without launching dev servers or connecting to databases:
```pwsh
npx.cmd playwright test --list
```

### 2. Running a Single Spec File
```pwsh
npx.cmd playwright test e2e/workflows/full-student-journey-e2e.spec.ts
```

### 3. Running Focused Test Suites
```pwsh
# Run all workflow specs
npx.cmd playwright test e2e/workflows/

# Run student feature specs
npx.cmd playwright test e2e/student/
```

### 4. Running the Full E2E Test Suite (Authorized Runs Only)
Ensure backend ports `5000-5003` and frontend ports `5173-5176` are unblocked:
```pwsh
npm.cmd run test:e2e
```

### 5. Inspecting HTML Test Report
```pwsh
npx.cmd playwright show-report e2e/playwright-report
```

---

## Guardrails & Authoring Standards

1. **Deterministic Expected Outputs**:
   - Every assertion must verify observable UI elements (`data-testid`), database records, or HTTP response statuses.
   - Do not write facade tests that pass unconditionally.
2. **No Hardcoded Worker Ports**:
   - Always import `API_URL`, `APP_URL`, or `SERVER_URL` from `e2e/helpers/env.ts`.
   - Never hardcode `http://localhost:5000` or `http://localhost:5173`.
3. **No Unsafe Fallbacks**:
   - Assert failure states explicitly (e.g. 400 with descriptive error message, 404 for removed endpoints).
   - Verify empty states when data is missing rather than relying on mock fallbacks.
4. **Thai Localization Integrity**:
   - Do not use shell scripts or tools that alter file encoding. Preserve UTF-8 Thai text formatting.
