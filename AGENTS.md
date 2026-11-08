# Repository Guidelines

newBeing is a local-first, AI-native trading research workstation: a pnpm monorepo with a Next.js workbench, deterministic research/Replay engines, Paper-only execution, and a local MCP server. Trading is **Paper-only** — there is no live order route and no exchange credential handling. Saved strategy source is text, never executable.

## Project Overview

- Public market data, deterministic backtests, Replay, Paper accounts, saved research, local AI/MCP access.
- Everything runs on the operator's machine; SQLite defaults to `.newbeing/` and moves with `NEWBEING_DATA_DIR`.
- One rule outranks convenience: never invent data. No fabricated fills, no inferred balances or FX rates, no future candles, no silent substitution when a lookup fails.

## Architecture & Data Flow

```mermaid
flowchart LR
  browser[Browser UI] --> web[Next.js UI + API routes]
  web --> app[@newbeing/application]
  app --> core[@newbeing/core]
  app --> market[@newbeing/market-data]
  app --> storage[@newbeing/storage]
  mcp[Local MCP stdio server] --> app
  browser -. public klines .-> stream[Binance public WebSocket]
```

- `core` is pure and synchronous: types, strategies, backtest, ledger, Paper, Replay, spot, policy, factors. No network, filesystem, or adapter work belongs here.
- `application` composes use cases (research, sweep, evaluation, Replay, Paper, spot, derivatives) behind dependency objects so tests can inject clocks, adapters, and failure points.
- `market-data` owns public transport and normalization (`ccxt` adapters plus native derivatives/options clients).
- `storage` owns SQLite schema, migrations, transactions, and immutable research snapshots via Drizzle + `better-sqlite3`.
- `web` and `mcp` are callers only — neither is an execution engine nor a secret store. Web serves public exchange requests; the browser subscribes directly only to Binance's public kline stream.
- Determinism contracts to preserve: strategies see a candle prefix ending at the evaluated bar, signals fill at the **next bar open**, stops win ambiguous ranges, fees/slippage/precision are explicit, and Replay exposes only the revealed prefix of a frozen dataset.

## Key Directories

- `apps/web/src/app/` — App Router pages and `api/*` route handlers; `components/` UI, `lib/` client helpers, `store/workspace.ts` Zustand state.
- `packages/core/src/` — domain contracts and all deterministic math; `packages/core/bench/` holds informational benchmarks.
- `packages/application/src/` — use cases and orchestration seams.
- `packages/market-data/src/` — exchange adapters, normalized contracts, derivatives normalization and fixtures.
- `packages/storage/src/` — `db.ts` migrations, `schema.ts`, `repositories.ts`, `spot.ts`, `derivatives.ts`, `snapshots.ts`, `research.ts`.
- `packages/mcp/src/` — stdio server (`server.ts`), tool registration (`tools.ts`, `ai-guidance.ts`, `derivatives-tools.ts`), smoke client (`smoke.ts`).
- `e2e/` — Playwright browser/API flows and API stubs. `docs/` — decision records (see Important Files).

## Development Commands

Run from the repository root with pnpm:

```sh
pnpm install
pnpm dev          # build:packages, then next dev on 127.0.0.1
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

- `build:packages` builds `core → market-data → storage → application`. Packages declare types from `src/` but runtime entry points from `dist/`, so build before running or typechecking a consumer.
- Single package: `pnpm --filter @newbeing/storage test`.
- Single file / test name: `pnpm --filter @newbeing/core exec vitest run tests/backtest.test.ts -t "fees"`.
- Single E2E file: `pnpm exec playwright test e2e/workstation.e2e.ts`.

## Code Conventions & Common Patterns

- TypeScript is strict: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch` (`tsconfig.base.json`, target ES2022, `moduleResolution: "Bundler"`). ESLint makes explicit `any` an error (`eslint.config.mjs`).
- Use `.js` extensions on package-relative imports, even for types; web code uses the `@/` alias. Respect manifest export maps and keep the public API in each `src/index.ts`.
- Keep core calculations synchronous and side-effect free. Network, clock, filesystem, and randomness belong at adapter/application/storage/route boundaries.
- Retain dependency-object seams in `packages/application/src/*` (for example `{ now, marketAdapter }`, injected `ExchangeAdapter`, cache and snapshot hooks). Tests and failure injection depend on them.
- Fail explicitly. Invalid domain transitions throw `Error`; money/precision violations throw `LedgerValidationError` (`packages/core/src/ledger.ts`); routes translate these into 400/409/422 rather than degrading to empty results.
- Persist through one immediate SQLite transaction per mutation. Replay guards must be re-checked **inside** the transaction, not only in the route, so a concurrent workspace switch cannot interleave (`packages/storage/src/spot.ts`, `repositories.ts`).
- Keep read paths read-only: an existing wallet/account is served without an upsert, so polling never contends for the write lock.
- Browser state lives in `apps/web/src/store/workspace.ts` as typed Zustand actions; select grouped fields with `useShallow`. Server state is written through `/api/workspace` with optimistic timestamps.
- Polling components pause on `document.hidden` and use the narrowest API view available (for example `/api/paper?view=positions`).
- Name component files in kebab-case (`bottom-dock.tsx`), tests as `*.test.ts` / `*.e2e.ts`.

## Important Files

- `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml` — scripts, workspaces, native build allowlist.
- `tsconfig.base.json`, `eslint.config.mjs`, `playwright.config.ts` — shared compiler, lint, and E2E settings.
- `apps/web/next.config.ts` — `NEWBEING_NEXT_DIST_DIR`, `transpilePackages`, tracing externals.
- `apps/web/AGENTS.md` — binding Next.js rule: read the relevant guide under `node_modules/next/dist/docs/` from `apps/web/` before writing web code (this Next version differs from training data).
- `docs/functional-architecture.md` — package responsibilities and safety invariants; `docs/cross-venue-plan.md` — venue/workspace decisions.
- `docs/derivatives.md`, `docs/sweeps.md`, `docs/research-evaluations.md`, `docs/paper-recovery.md`, `docs/spot-foundation-closure.md` — behavior contracts for those areas.
- `docs/ai-interaction-design.md` (MCP workflow), `docs/design-plan.md` (UI hierarchy), `docs/research/references.md` (research decisions).

## Runtime/Tooling Preferences

- Node `>=22.12` (CI pins Node 24); `packageManager: pnpm@12.10.1`. Use pnpm workspace commands — never npm or yarn.
- Next.js 16.4.3 with the Webpack dev bundler; dev and production servers bind `127.0.0.1` only.
- SQLite via `better-sqlite3` + Drizzle in WAL mode with `busy_timeout`; `pnpm-workspace.yaml` `allowBuilds` controls native dependency builds.
- Public exchange access needs network reachability (Binance, OKX, Deribit, Coinbase, Kraken); no API keys are required for documented workflows.
- CI (`.github/workflows/ci.yml`) runs, in order: `pnpm install --frozen-lockfile`, `test`, `typecheck`, `lint`, `build`, Chromium install, `test:e2e`, `mcp:smoke`.

## Testing & QA

- Vitest 5 for packages and web routes (`*.test.ts`); Playwright 1.64.1 for browser/API E2E (`*.e2e.ts`, `workers: 1`).
- Suites: `packages/*/tests/`, `apps/web/tests/`, `e2e/`. `pnpm test` runs them serially after building packages; there is no coverage threshold configured.
- Storage-backed tests must isolate state: `closeDatabaseForTests()`, a fresh `mkdtempSync` directory, `process.env.NEWBEING_DATA_DIR = directory`, then close and remove it in cleanup.
- Crash/restart behavior is tested with subprocess stages in `packages/storage/tests/paper-recovery.test.ts` (`crashAt`).
- E2E: `NEWBEING_E2E_FIXTURES=1` enables deterministic provider fixtures outside production; `e2e/api-mocks.ts` provides stubbed API mode. `PLAYWRIGHT_BASE_URL` is rejected unless the host is `localhost`, `127.0.0.1`, or `::1`.
- MCP verification is the stdio smoke client (`packages/mcp/src/smoke.ts`); it checks the approved tool set, snapshot identity, draft non-executability, and Replay restrictions.
- Before claiming a change works, run the specific test or scenario that exercises it — a passing unrelated suite is not proof.
