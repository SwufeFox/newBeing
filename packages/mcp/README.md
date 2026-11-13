# Local MCP server

newBeing exposes the official TypeScript MCP SDK v2 over **stdio**. This keeps the server local and avoids pretending that a browser page or `localhost` is reachable by a remote ChatGPT service.

## Run

From the repository root, build the local packages once, then run:

```sh
pnpm build:packages
pnpm --filter @newbeing/mcp start
```

For a real stdio protocol smoke test (the client uses the official SDK, with stderr inherited so JSON-RPC stdout stays clean):

```sh
pnpm mcp:smoke
```

The `pnpm mcp` root script builds the required workspace packages before launching the server. Start the Next.js UI separately with `pnpm dev`.

For AI workflows, the server exposes three prompts (`research_question`, `explain_result`, `replay_review`) and two read-only resources (`newbeing://agent-guide/v1`, `newbeing://safety/v1`). See [AI interaction design](../../docs/ai-interaction-design.md) for tool sequencing, date-range rules, and result interpretation.

## Client configuration

Use the MCP client's local-command/stdio configuration, pointing `cwd` to the absolute repository root. Example for a client that accepts command plus arguments:

```json
{
  "mcpServers": {
    "newbeing": {
      "command": "pnpm",
      "args": ["mcp"],
      "cwd": "/absolute/path/to/newBeing"
    }
  }
}
```

The command must resolve the pinned pnpm 12 toolchain (for example through Corepack). On a machine without a global `pnpm`, use that client's supported command wrapper or point it at a small local launcher that invokes `npx --yes pnpm@12.10.1 mcp` from the repository root. Never put credentials in the launcher.

**ChatGPT connection boundary:** ChatGPT's remote MCP clients need a reachable authenticated HTTPS server; they cannot directly call this stdio process or `localhost`. There is no tunnel, public listener, or unauthenticated remote bridge in this project. A future remote connector would need independent authentication, authorization, exposure review, and user approval.

## Tools and permissions

- Read-only: `get_workspace_context`, `get_market_data`, `get_portfolio`, `list_strategies`, `get_strategy`, `get_backtest_result`, `get_research_sweep`, `list_experiments`.
- Derivatives reads: `list_derivative_instruments` discovers native perpetual/future/option IDs; `get_derivative_market` returns actual product units and public quotes; `get_derivative_portfolio` reads an independent venue/settlement Paper account without opening or funding it. All three are blocked during frozen Replay. They add no trading or account-opening capability to MCP.
- Research writes: `create_strategy` and `update_strategy` save local source drafts; `run_backtest` persists one result; `run_research_sweep` compares one bounded numeric axis; `rerun_backtest` and `rerun_backtest_sweep` verify saved outputs; `open_workspace_view` changes local navigation.
- Transaction preparation only: `prepare_order` stores a five-minute **Paper-only** preview. It does not create an order. The user must confirm in the local UI; the server has no live order tool.

Historical backtests and sweeps accept an optional inclusive UTC `start_at` and exclusive `end_at`, capped at 5,000 completed bars. `run_research_sweep` can instead accept `dataset_id` to reuse an immutable snapshot without network access; exchange, symbol and timeframe must match. Walk-forward sweeps default to training total-return ranking and accept `selection_metric: "sharpe_ratio"` to rank by finite training Sharpe; null Sharpe candidates are skipped. They can also accept `max_training_drawdown` (0–1) to filter training candidates before ranking; validation and final-test metrics remain unconstrained observations. `get_market_data` returns range/gap/source metadata by default; pass `include_bars: true` for up to 500 bars. `run_backtest` keeps its existing workspace-selection default for compatibility; AI clients should pass `open_in_workspace: false` unless the user asked to change local navigation.

`list_experiments` returns result/dataset IDs, symbol, timeframe, strategy/version, creation time and complete metrics. Its storage query extracts this metadata in SQLite without loading trade, signal or equity arrays into Node.

`run_backtest`, `rerun_backtest` and `get_backtest_result` return summaries by default: complete metrics and provenance, the total `tradeCount`, `trades: []`, and an equity summary containing `pointCount`, `first` and `last`. To inspect detail, call `get_backtest_result` with an explicit `trade_limit` from 0 to 200 and/or `include_equity_curve: true`. The trade limit selects the first saved trades; it never changes total counts or metrics.

All tool calls share the same storage/application services as the UI. During Replay, only bars already released through the active cursor are visible; current quotes, ordinary Paper accounts, saved backtest outcomes and normal order previews are suppressed. Live trading and credentials are not implemented.
