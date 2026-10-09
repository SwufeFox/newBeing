# newBeing — AI-Native Trading Workstation

**Trade. Research. Replay. Evolve.** A local-first research terminal. The current vertical slice ships real Binance Spot public data, an interactive Lightweight Charts workspace, deterministic bar-by-bar backtests, cursor-gated historical replay with session-isolated paper fills, SQLite-backed experiments, synchronized workspace state, and a local stdio MCP server. Live trading is intentionally disabled.

## Requirements

- Node.js 22.12+ (tested with Node 24)
- pnpm 12+
- Network access to Binance public REST and WebSocket endpoints for live public data

## Run locally

```sh
pnpm install
pnpm dev
```

Open <http://localhost:3000>. No API key or third-party SaaS account is required. If pnpm is not installed, enable it with `corepack enable pnpm` or use `npx pnpm@12 install` / `npx pnpm@12 dev`.

The local SQLite database and saved experiments live under `.newbeing/` (ignored by Git). `NEWBEING_DATA_DIR` can move that state elsewhere. Public exchange requests are made server-side through CCXT; the browser subscribes only to Binance's public kline stream. This workspace is not a hosted service.

## Checks

```sh
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm exec playwright install chromium # once per machine
pnpm test:e2e
pnpm mcp:smoke
pnpm bench
```

GitHub Actions runs tests, typecheck, lint, production build, deterministic Playwright E2E, and an isolated real stdio MCP tool-call smoke test. E2E enables `NEWBEING_E2E_FIXTURES=1`, which supplies deterministic synthetic OHLCV data without contacting Binance; it uses a fresh temporary SQLite directory. `pnpm bench` exercises 1k, 10k and 100k bars for all built-in strategies and reports elapsed time plus heap/RSS observations (informational, not a CI timing gate).

## Safety and feature boundaries

- The default and only trading mode is **Paper**. There is no live order route and no exchange API-key handling.
- Replay seeds only completed bars through a selected historical cutoff. Each step releases one next bar; current tickers, depth, strategy backtest metrics, and the normal Paper wallet are suppressed during Replay. Replay fills use the revealed bar close and a session-isolated Paper wallet.
- Backtests use the next bar's open for signals generated at the current bar's close; market fees and adverse slippage are explicit. Short exposure is a simplified notional model without borrow, funding, leverage or liquidation.
- The report stores the executable strategy ID/version and exact typed parameters. The UI describes the selected built-in's actual signal logic separately from **Source Draft**; Monaco drafts are saved for research only and are never executed. The initial lab runs reviewed built-in strategy implementations; user-authored code needs a separately validated sandbox before it can run.
- API routes are local-only: the app binds to loopback, rejects non-loopback `Host` headers to block DNS-rebinding aliases, and requires same-host `Origin` plus `application/json` for state-changing requests. No remote auth service or remote MCP endpoint is introduced.
- MCP is a local stdio server for explicitly configured local MCP clients. It does not expose an unauthenticated HTTP endpoint and does not make localhost remotely reachable by ChatGPT. A remote ChatGPT connection requires a separately authenticated, access-controlled HTTPS bridge; none is started automatically.
- Next-stage work is **isolated user-strategy execution** (after sandbox design/review) and a **separately authenticated ChatGPT MCP HTTPS bridge**. Neither is implemented in this iteration.
- For OHLCV, missing intervals and duplicate timestamps are checked before research/replay. Exchange outages, market-data revisions and the currently forming candle remain visible limitations.

## Structure

```text
apps/web/                 Next.js App Router UI and HTTP boundary
packages/core/            typed strategies, deterministic backtest, paper primitives
packages/market-data/     CCXT Binance Spot adapter and normalized market types
packages/storage/          Drizzle + SQLite repositories
packages/application/      shared backtest and paper execution services
packages/mcp/              official MCP TypeScript SDK stdio server
docs/research/references.md pinned reference map, licenses, findings and decisions
```

Reference-driven design and license decisions are recorded in [`docs/research/references.md`](docs/research/references.md). Lightweight Charts attribution is present in the chart footer; no TradingView Advanced Charts source is used.
