# Repository Guidelines

## Project Overview

newBeing is a local-first AI-native trading research workstation built as a pnpm monorepo. It provides public market data, deterministic backtests and Replay, Paper accounts, saved research, and a local MCP server. Trading is Paper-only; there is no live order route or exchange credential handling. Local SQLite state defaults to `.newbeing/` and can be moved with `NEWBEING_DATA_DIR`.

## Architecture & Data Flow

```mermaid
flowchart LR
  browser[Browser UI] --> web[Next.js UI and API routes]
  web --> app[@newbeing/application]
  app --> core[@newbeing/core]
  app --> market[@newbeing/market-data]
  app --> storage[@newbeing/storage]
  mcp[Local MCP stdio server] --> app
  browser -. public klines .-> stream[Binance public WebSocket]
```

- `core` owns domain contracts and deterministic strategy, backtest, Paper, and Replay behavior. Backtests evaluate signals on a safe candle prefix; preserve the no-lookahead and explicit execution assumptions.
- `application` composes shared research and execution use cases. `market-data` normalizes public exchange data through adapters such as CCXT. `storage` persists workspace and experiment state with Drizzle and SQLite.
- The web server handles public exchange requests; the browser subscribes directly only to Binance's public kline stream. MCP reuses application services over local stdio and does not expose an HTTP listener.

## Key Directories

- `apps/web/src/app/` — Next.js App Router pages and API routes; `components/`, `lib/`, and `store/` hold UI, client helpers, and shared Zustand state.
- `packages/core/src/` — shared types, strategies, deterministic backtests, ledger rules, Paper, Replay, and factor evaluation.
- `packages/application/src/` — backtest, sweep, evaluation, Replay, derivatives, and Paper use cases.
- `packages/market-data/src/` — normalized market contracts and exchange adapters.
- `packages/storage/src/` — SQLite schema, migrations, repositories, and immutable research snapshots.
- `packages/mcp/src/` — local MCP server, tool registration, and stdio smoke client.
- `e2e/` — Playwright browser and API flows. `docs/` — architecture, feature boundaries, research decisions, and workflows.
- `packages/core/bench/` — informational strategy benchmarks.

## Development Commands

Run from the repository root with pnpm:

```sh
pnpm install
pnpm dev                 # Build shared packages, then start the web app
pnpm start               # Start the built web app
pnpm build
pnpm typecheck
pnpm lint
pnpm test                # Build shared packages, then run package tests serially
pnpm exec playwright install chromium  # Once per machine
pnpm test:e2e
pnpm mcp
pnpm mcp:smoke
pnpm bench
```

A single package can be checked with `pnpm --filter @newbeing/<package> test` or the corresponding `typecheck` script; the web package is `@newbeing/web`.

## Code Conventions & Common Patterns

- TypeScript is strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`); ESLint treats explicit `any` as an error. Keep types and return cases explicit.
- Respect package boundaries and each manifest's declared exports; packages with `src/index.ts` expose their public API there. Use `.js` extensions for package-relative TypeScript imports; web code uses the `@/` alias.
- Keep core calculations synchronous and deterministic. Keep network and filesystem I/O at adapter, application, storage, or route boundaries. Use existing abort/timeout handling for asynchronous network calls.
- Application services expose dependency objects or adapter parameters where needed for deterministic execution and testing; retain those seams when changing service behavior. Keep related SQLite mutations transactional.
- Shared browser state lives in `apps/web/src/store/workspace.ts` as typed Zustand state and actions. Follow component selector patterns, including `useShallow` for grouped selections.
- Keep order/replay transitions, market assumptions, fees, and precision rules explicit. Invalid domain transitions and ledger values are rejected; do not silently substitute data or expose future candles during research or Replay.
- Preserve product boundaries: Paper-only execution, loopback-only local API, and local stdio MCP. Source Draft text is saved for research and is not executable.

## Important Files

- `README.md` — setup, safety boundaries, commands, and workspace map.
- `package.json`, `pnpm-workspace.yaml`, and `pnpm-lock.yaml` — workspace scripts, package manager, and dependency lock.
- `tsconfig.base.json`, `eslint.config.mjs`, and `playwright.config.ts` — shared compiler, lint, and E2E settings.
- Follow the Next.js-specific rules in `apps/web/AGENTS.md`; resolve the relevant installed guide under `node_modules/next/dist/docs/` from `apps/web/` before editing web code.
- `docs/research/references.md`, `docs/derivatives.md`, `docs/sweeps.md`, and `docs/research-evaluations.md` — design and behavior decisions for those areas.

## Runtime/Tooling Preferences

- Use Node.js 22.12+ and pnpm 12.10.1 (Node 24 is also documented as tested). Use pnpm workspace commands rather than npm or yarn.
- The web app uses Next.js 16.4.3 with Webpack for development; dev and production servers bind to `127.0.0.1`.
- Public exchange access requires network access to Binance and other configured public endpoints. No API key is needed for the documented workflows.

## Testing & QA

- Vitest 5 unit/integration tests use `*.test.ts` in package `tests/` directories and `apps/web/tests/`. Run `pnpm test` for the workspace or `pnpm --filter @newbeing/<package> test` for one package.
- Playwright tests use `e2e/*.e2e.ts`. `pnpm test:e2e` builds packages, starts a loopback web server, enables deterministic fixtures, and uses an isolated SQLite data directory. The suite runs with one worker; install Chromium once as shown above.
- MCP's package test runs its stdio smoke client; `pnpm mcp:smoke` runs that check explicitly.
- Storage-backed tests should use a fresh temporary `NEWBEING_DATA_DIR`, close the test database, and remove the directory during cleanup. No separate root coverage command is configured.
