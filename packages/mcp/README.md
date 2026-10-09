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

- Read-only: `get_workspace_context`, `get_market_data`, `get_portfolio`, `list_strategies`, `get_strategy`, `get_backtest_result`, `list_experiments`.
- Research writes: `create_strategy` and `update_strategy` save local source drafts; `run_backtest` uses a reviewed built-in strategy and persists a result; `open_workspace_view` changes local navigation.
- Transaction preparation only: `prepare_order` stores a five-minute **Paper-only** preview. It does not create an order. The user must confirm in the local UI; the server has no live order tool.

All tool calls share the same storage/application services as the UI. During Replay, only bars already released through the active cursor are visible; current quotes, ordinary Paper accounts, saved backtest outcomes and normal order previews are suppressed. Live trading and credentials are not implemented.
