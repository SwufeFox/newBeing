# newBeing — AI-Native Trading Workstation

**Trade. Research. Replay. Evolve.** A local-first research terminal with public spot and derivatives markets, interactive Lightweight Charts, deterministic spot research, cursor-gated historical Replay, independent Paper ledgers, SQLite-backed experiments, synchronized workspace state, and a local stdio MCP server. Live trading is intentionally disabled.

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

Research refreshes the Experiments list after each completed backtest. The Results panel explicitly compares saved result inputs with current workspace settings and provides a safe restore action when compatible. Position allocation controls the share of available cash used per entry and displays a high-allocation warning at 90% or above. When a Results filter hides all trades, the view offers one “Show all trades” recovery action; backtests that generate no trades are labeled separately. Experiment history explains when more runs are needed and shows the comparison requirements once enough runs are selected. Backtest progress is announced while the simulation runs; invalid SMA periods are announced and linked to both fields. Preset save, load, delete, and reset confirmations are announced. Sweeps can reuse the loaded backtest snapshot or fresh candles; walk-forward sweeps select on training total return or Sharpe with an optional training drawdown cap; full-sample sweeps are labeled in-sample, and saved sweeps can be opened and deterministically rerun from their immutable snapshot.

## Derivatives

Open **Derivatives** from the main navigation (or `/derivatives`). The dedicated workspace keeps native product identities, contract quantities and settlement currencies separate from spot symbols. It includes OKX USDT linear perpetuals, Deribit USDC linear dated futures, plus Deribit options with expiry, strike and call/put selection. Public data needs no exchange credentials.

Paper accounts must be explicitly opened. Contracts support local isolated margin and long/short exposure; options support paid-premium buys and sells that close an existing long. Quotes, collateral, contract multipliers and fees use the instrument's actual settlement units. These accounts never import spot or legacy wallet assets.

The local execution policy, funding coverage, expiry handling and research boundaries are described in [the derivatives guide](docs/derivatives.md). Public derivatives and their normal Paper accounts are blocked while a frozen Replay is active.

## Workspace controls

- **Markets:** Search prioritizes the venue’s default quote while keeping matching pairs in other quote currencies. Enter a base symbol to use the selected venue’s default quote, or enter an explicit `BASE/QUOTE` pair. In the legacy pair wallet, **Close 100%** sells the full current position; the `B` and `S` shortcuts follow the corresponding ticket buttons’ availability.
- **Paper:** Legacy wallets are scoped to a venue and pair; shared spot wallets are scoped to a venue and quote currency across pairs. A position cannot be closed while its account has any unresolved Paper order, including one older than the recent history window; resolve it in **Recovery**.
- **Chart:** OHLCV values, indicator controls and connection status reflow as the chart narrows. Indicator buttons expose their on/off state to assistive technology, and a failed or empty candle response is stated on the canvas itself rather than in the legend strip.
- **Degraded data:** a venue that stops answering turns amber, not red, everywhere it shows: the plate, the watchlist banner, the order book block and the chart. Red stays reserved for orders and losses. Stale prices keep full contrast — a reader deciding on the last quote should not have to squint at it.
- **Derivatives:** Paper actions stay paused until a filtered instrument is selected and a fresh quote is available. Use **Load older** to browse the account's complete fill history.
- **Replay:** Use the single speed selector or press Space to play/pause, Right Arrow or N to step, and comma/period or `<`/`>` to change speed. Controls display exact revealed bars on the chart without phantom progress timelines, and reflow on narrow screens.
- **History:** A row in the research rail loads that saved run into the chart and the Results panel. The list is suppressed while a frozen Replay owns the workspace, because saved results can encode future bars.
- **Layout:** Panel widths and the bottom dock height are reset from **Workstation settings**, together with the language and colour preferences. Research dock tabs wrap on narrow layouts so their labels remain readable.
- **AI Context Deck:** The inspector's AI tab provides research prompts, factor syntax validation and a browser-generated context JSON. The briefing and its copied text show the market quote's reported UTC timestamp, or indicate when it is unavailable; a failed refresh marks the retained quote as stale. The selected backtest's sample range and segment nature accompany its metrics. Evaluation and walk-forward evidence is linked by result ID within the 20 most recent reports of each type; `unknown` can also mean an older or unavailable report. Holdouts are historical partitions, and retuning after inspecting them invalidates an untouched test. Risk prompts use the selected backtest's market, assumptions and metrics together, or current workspace settings when no backtest is selected; they constrain Kelly position sizing and stop-loss levels against missing empirical inputs. Backtest results and live quotes are hidden from the panel and copied context during Replay. The optional stdio MCP server reads its own SQLite workspace context.

## Settings, language and accessibility

The gear in the top bar opens **Workstation settings**. Preferences are stored per device in `localStorage` (`newbeing:ui-preferences:v1`) and are intentionally not part of the SQLite workspace: they describe this display, not the research workspace.

- **Language:** English or 简体中文. Copy lives next to the component that renders it, with the English side byte-identical to the previous strings; the switch covers both workstations, the research panels, the settings dialog and the command-hotkey guide. One glossary keeps a single name per concept (模拟盘 / 回放 / 回测 / 参数扫描 / 验证), and one shared module owns strategy and parameter labels so the rail, strategy lab, sweep and evaluation panels cannot drift apart. Engine-authored prose — strategy execution summaries and server error payloads — stays in its source language; the `<html lang>` attribute follows the choice.
- **Colour vision:** *Standard* keeps green/red; *Deuteranopia* maps the direction ramp to blue/orange. The switch repaints the semantic direction tokens (`--c-up` / `--c-down`, and the chart series) rather than tinting individual widgets, so candles, depth bars, PnL text, quote sides and status pills move together. Direction never rests on colour alone: arrows, `+/−` signs and labels carry it as well. The stored mode is applied before first paint, so the red/green ramp never flashes for a reader who selected the alternative.
- **Market data connectors:** each supported venue is listed with its advertised capabilities and timeframes. `USE` changes the active venue (the symbol is re-denominated for that venue's quote currency); `PROBE` asks that venue for live public instrument metadata and prints the native instrument id, price/quantity precision and minimum cost. Probe results are labeled with the requested pair and hidden when the current pair changes. If the connector list cannot be loaded, use **Retry connectors**. A tilde (`~OHLCV`) marks a capability the venue only emulates.
- **Local API boundary:** the panel states the actual contract. Market data is public exchange REST/WebSocket traffic with no key; AI access is your MCP client over local stdio (`pnpm mcp`) with the model provider key held by that client; execution is Paper only. newBeing stores no provider key and opens no MCP listener.

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

GitHub Actions runs tests, typecheck, lint, production build, deterministic Playwright E2E, and an isolated real stdio MCP tool-call smoke test. E2E enables `NEWBEING_E2E_FIXTURES=1`, which supplies deterministic synthetic OHLCV data without contacting Binance; fixture-fed market summaries are labeled **TEST FIXTURE** to distinguish them from **PUBLIC REALTIME**. It uses a fresh temporary SQLite directory. `pnpm bench` exercises 1k, 10k and 100k bars for all built-in strategies and reports elapsed time plus heap/RSS observations (informational, not a CI timing gate).

## Safety and feature boundaries

- The default and only trading mode is **Paper**. There is no live order route and no exchange API-key handling.
- Replay seeds only completed bars through a selected historical cutoff. Each step releases one next bar; current tickers, depth, strategy backtest metrics, and the normal Paper wallet are suppressed during Replay. Replay fills use the revealed bar close and a session-isolated Paper wallet.
- Backtests use the next bar's open for signals generated at the current bar's close; market fees and adverse slippage are explicit. Short exposure is a simplified notional model without borrow, funding, leverage or liquidation.
- The report stores the executable strategy ID/version and exact typed parameters. The UI describes the selected built-in's actual signal logic; backtests always run the reviewed built-in implementation, and user-authored code needs a separately validated sandbox before it can run.
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
