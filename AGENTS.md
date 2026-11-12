# Repository Guidelines

## Project Overview

newBeing is a local-first, AI-native trading research workstation: a pnpm monorepo with a Next.js workbench, deterministic research/Replay engines, Paper-only execution, SQLite persistence, and a local stdio MCP server. Trading is **Paper-only** — there is no live order route and no exchange credential handling. Saved strategy source is text, never executable.

- Public market data, deterministic backtests, Replay, Paper accounts, saved research, and local AI/MCP access.
- Everything runs on the operator's machine; SQLite defaults to `.newbeing/` and moves with `NEWBEING_DATA_DIR`.
- One rule outranks convenience: never invent data. No fabricated fills, inferred balances or FX rates, future candles, or silent substitution when a lookup fails.

## Architecture & Data Flow

```mermaid
flowchart LR
  browser[Browser UI] --> web[Next.js UI + API routes]
  web --> app[@newbeing/application]
  app --> core[@newbeing/core]
  app --> market[@newbeing/market-data]
  app --> storage[@newbeing/storage]
  mcp[Local MCP stdio server] --> app
  browser -. public klines .-> binance[Binance public WebSocket]
```

- Dependency direction is one-way: `core` is the base; `market-data` and `storage` depend on `core`; `application` composes all three; `web` and `mcp` are callers only. `web` and `mcp` are never execution engines or secret stores.
- `core` is pure and synchronous: types, strategies, backtest, ledger, Paper, Replay, spot, policy, factors. No network, filesystem, clock, or randomness.
- `market-data` owns public transport and normalization: CCXT adapters, native derivatives/options clients, completed-window helpers, request coalescing.
- `storage` owns SQLite schema, migrations, transactions, repositories, and immutable research snapshots (Drizzle + `better-sqlite3`).
- `application` contains use cases behind dependency objects so tests can inject clocks, adapters, and failure points.
- `web` serves public exchange requests server-side; the browser subscribes directly only to Binance's public kline stream. `mcp` exposes application/storage operations over local stdio; it must not duplicate domain calculations or accept executable model output.
- Determinism contracts: strategies see a candle prefix ending at the evaluated bar, signals fill at the **next bar open**, stops win ambiguous ranges, fees/slippage/precision are explicit, and Replay exposes only the revealed prefix of a frozen dataset.

## Key Directories

- `apps/web/src/app/` — App Router pages and `api/*` route handlers; `components/` UI; `lib/` client/server helpers; `store/workspace.ts` Zustand state.
- `apps/web/tests/` — Vitest route, guard, and helper contracts.
- `packages/core/src/` — domain contracts and deterministic math; `packages/core/bench/` informational benchmarks.
- `packages/application/src/` — use cases and orchestration seams (`research`, `sweep`, `evaluations`, `replay`, `paper`, `spot`, `derivatives`).
- `packages/market-data/src/` — exchange adapters, normalized contracts, derivatives normalization and fixtures.
- `packages/storage/src/` — `db.ts` migrations, `schema.ts`, repositories, `spot.ts`, `derivatives.ts`, `snapshots.ts`, `research.ts`.
- `packages/mcp/src/` — `server.ts`, `tools.ts`, `derivatives-tools.ts`, `ai-guidance.ts`, `smoke.ts`.
- `e2e/` — Playwright browser/API flows and API stubs; `docs/` — behavior specs and decision records; `.agents/skills/ak-ui/` — the ak-ui design skill.

## Development Commands

Run from the repository root with pnpm:

```sh
pnpm install
pnpm dev          # build:packages, then next dev (webpack) on 127.0.0.1
pnpm start        # serve the built web app
pnpm build
pnpm typecheck
pnpm lint
pnpm test         # build:packages, then package suites serially
pnpm exec playwright install chromium   # once per machine
pnpm test:e2e
pnpm mcp
pnpm mcp:smoke
pnpm bench
```

- `build:packages` builds sequentially: `core → market-data → storage → application`. Packages declare types from `src/` but runtime entry points from `dist/`, so build before running or typechecking a consumer.
- Single package: `pnpm --filter @newbeing/storage test`.
- Single file / test name: `pnpm --filter @newbeing/core exec vitest run tests/backtest.test.ts -t "fees"`.
- Single E2E file: `pnpm exec playwright test e2e/workstation.e2e.ts`.
- Playwright starts its own dev server on `127.0.0.1:3100` with `.next-e2e` and fixtures unless `PLAYWRIGHT_BASE_URL` points at an existing loopback server.

## Code Conventions & Common Patterns

- TypeScript is strict: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch` (`tsconfig.base.json`, ES2022, `moduleResolution: "Bundler"`). ESLint makes explicit `any` an error (`eslint.config.mjs`).
- Use `.js` extensions on package-relative imports, even for types; web code uses the `@/` alias. Respect manifest export maps and keep the public API in each `src/index.ts`.
- Keep core calculations synchronous and side-effect free. Network, clock, filesystem, and randomness belong at adapter/application/storage/route boundaries.
- Retain dependency-object seams in `packages/application/src/*` (for example `{ now, marketAdapter }`, injected `ExchangeAdapter`, cache and snapshot hooks). Tests and failure injection depend on them.
- Fail explicitly. Invalid domain transitions throw `Error`; money/precision violations throw `LedgerValidationError` (`packages/core/src/ledger.ts`); routes translate these into 400/409/422 rather than degrading to empty results.
- Persist through one immediate SQLite transaction per mutation. Replay guards must be re-checked **inside** the transaction, not only in the route, so a concurrent workspace switch cannot interleave (`packages/storage/src/spot.ts`, `repositories.ts`).
- Keep read paths read-only: an existing wallet/account is served without an upsert, so polling never contends for the write lock.
- Snapshots are canonical-JSON SHA-256 content-addressed and write-once; publication flushes a temp file and uses a non-overwriting hard link. Readers verify bytes/hash (`packages/storage/src/snapshots.ts`).
- Web route handlers parse with Zod, return explicit statuses, and set `Cache-Control: no-store` where required. Shared mapping sends syntax errors to 400, typed `ResearchError` to its status, other research failures to 422 (`apps/web/src/lib/research-route.ts`); Replay mismatches return 409, missing resources 404, and public market fetch failures 502.
- Browser state lives in `apps/web/src/store/workspace.ts` as typed Zustand actions; select grouped fields with `useShallow`. The URL owns the active workspace; persisted client state excludes it. Server sync is optimistic on `updatedAt`; a stale write gets 409, adopts the server version, and retries once.
- Polling components pause on `document.hidden` and use the narrowest API view available (for example `/api/paper?view=positions`).
- Name component files in kebab-case (`bottom-dock.tsx`), tests as `*.test.ts` / `*.e2e.ts`.
- UI work follows the local ak-ui contract: CSS imported into the `ak-ui` Tailwind layer, brand values mapped to `--ak-*` tokens, desktop density retained, and 44px touch targets restored under `(hover: none), (pointer: coarse)`.

## Important Files

- `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml` — scripts, workspaces, native build allowlist.
- `tsconfig.base.json`, `eslint.config.mjs`, `playwright.config.ts` — shared compiler, lint, and E2E settings.
- `apps/web/next.config.ts` — `NEWBEING_NEXT_DIST_DIR`, `transpilePackages`, tracing and server externals.
- `apps/web/AGENTS.md` — binding Next.js rule: read the relevant guide under `node_modules/next/dist/docs/` from `apps/web/` before writing web code (this Next version differs from training data).
- `apps/web/src/lib/research-route.ts`, `derivatives-http.ts` — route error/status and Replay guard helpers.
- `packages/storage/src/schema.ts`, `db.ts`, `snapshots.ts` — schema, transactional migrations, immutable snapshots.
- `docs/functional-architecture.md` — audit/delivery plan (package responsibilities, target boundaries, safety invariants); `docs/derivatives.md`, `docs/sweeps.md`, `docs/research-evaluations.md`, `docs/paper-recovery.md`, `docs/spot-foundation-closure.md` — behavior specs and closure evidence.
- `docs/ai-interaction-design.md` (MCP workflow; tool counts dated), `docs/design-plan.md` (UI hierarchy), `docs/cross-venue-plan.md` / `docs/cross-venue-audit.md` (dated decision and audit records), `docs/research/references.md` (research decisions). Treat dated status claims as historical; verify current behavior in source.
- `README.md` — product boundaries and local workflow; `e2e/HANDOFF.md` — fixture-backend limits.
- `e2e/api-mocks.ts` — deterministic UI fixtures; `e2e/replay-api.ts` — real fixture-backed Replay helpers.

## Runtime/Tooling Preferences

- Node `>=22.12` (CI pins Node 24); `packageManager: pnpm@12.10.1`. Use pnpm workspace commands — never npm or yarn.
- Next.js 16.4.3; dev and the Playwright server use the Webpack dev bundler and bind `127.0.0.1`/loopback only. `pnpm build` runs `next build`.
- SQLite via `better-sqlite3` + Drizzle in WAL mode with `busy_timeout`; `pnpm-workspace.yaml` `allowBuilds` controls native dependency builds.
- Environment: `NEWBEING_DATA_DIR` (state root, default `.newbeing/`), `NEWBEING_NEXT_DIST_DIR`, `NEWBEING_E2E_FIXTURES=1` (deterministic providers outside production), `NEWBEING_DERIVATIVES_LIVE=1` (opt-in live market-data test), `PLAYWRIGHT_BASE_URL` (loopback only), `PLAYWRIGHT_API_STUBS=1` (browser-only mocks).
- Public exchange access needs network reachability (Binance, OKX, Deribit, Coinbase, Kraken); no API keys are required for documented workflows.
- CI (`.github/workflows/ci.yml`) runs in order: `pnpm install --frozen-lockfile`, `test`, `typecheck`, `lint`, `build`, Chromium install, `test:e2e`, `mcp:smoke`.

## Testing & QA

- Vitest 5 for packages and web routes (`*.test.ts`); Playwright 1.64.1 for browser/API E2E (`*.e2e.ts`, one worker, 120s test/navigation timeouts). No coverage threshold is configured.
- Suites: `packages/*/tests/`, `apps/web/tests/`, `e2e/`. `pnpm test` builds packages first and runs suites serially; the MCP `test` script runs its smoke program via `tsx`.
- Storage-backed tests must isolate state: `closeDatabaseForTests()`, a fresh `mkdtempSync` directory, `process.env.NEWBEING_DATA_DIR = directory`, then close and remove it in cleanup. Never run storage tests against the default/shared database.
- Crash/restart behavior uses subprocess stages in `packages/storage/tests/paper-recovery.test.ts` (`crashAt`: `created`, `submitted`, `wallet-write`, `committed`), asserting persisted recovery and idempotency.
- E2E defaults to `NEWBEING_E2E_FIXTURES=1`, a fresh `.newbeing/e2e-<NEWBEING_E2E_RUN_ID>` directory (`NEWBEING_E2E_DATA_DIR` overrides) shared by server and workers, port 3100, and `.next-e2e`. `PLAYWRIGHT_BASE_URL` must be `localhost`, `127.0.0.1`, or `::1`. `PLAYWRIGHT_API_STUBS=1` selects browser-only mocks; real-ledger/backend cases deliberately skip in that mode.
- Derivatives fixtures also honor `NEWBEING_MARKET_DATA_FIXTURE=1` outside production. Never present either fixture source as live data.
- MCP verification is the stdio smoke client (`packages/mcp/src/smoke.ts`); it checks the approved tool set, snapshot identity, draft non-executability, and Replay restrictions.
- Before claiming a change works, run the specific test or scenario that exercises it — a passing unrelated suite is not proof. For UI changes, inspect the real browser at desktop and narrow widths, including keyboard focus, open/closed, disabled, error, and loading states.
