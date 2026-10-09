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
```

## Safety and feature boundaries

- The default and only trading mode is **Paper**. There is no live order route and no exchange API-key handling.
- Replay seeds only completed bars through a selected historical cutoff. Each step releases one next bar; current tickers, depth, strategy backtest metrics, and the normal Paper wallet are suppressed during Replay. Replay fills use the revealed bar close and a session-isolated Paper wallet.
- Backtests use the next bar's open for signals generated at the current bar's close; market fees and adverse slippage are explicit. Short exposure is a simplified notional model without borrow, funding, leverage or liquidation.
- User-authored code is not evaluated as arbitrary JavaScript. The initial lab runs reviewed built-in strategy implementations from typed parameters; the Monaco editor is an isolated strategy-source workspace until a hardened execution sandbox is independently validated.
- MCP is a local stdio server for explicitly configured local MCP clients. It does not expose an unauthenticated HTTP endpoint and does not make localhost remotely reachable by ChatGPT. A remote ChatGPT connection requires a separately authenticated, access-controlled HTTPS bridge; none is started automatically.
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
