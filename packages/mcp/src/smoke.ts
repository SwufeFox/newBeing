import { Client } from "@modelcontextprotocol/client";
import { DEFAULT_WORKSPACE_STATE, type ReplaySession } from "@newbeing/core";
import { beginPaperIntent, listPaperRecoveries, paperAccountId, advanceReplaySession, closeDatabaseForTests, commandReplay, createConfiguredReplaySession, saveWorkspaceState } from "@newbeing/storage";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const client = new Client({ name: "newbeing-mcp-smoke", version: "0.1.0" });
const projectRoot = fileURLToPath(new URL("../../../", import.meta.url));
const serverPath = fileURLToPath(new URL("./server.ts", import.meta.url));
const dataDirectory = mkdtempSync(path.join(tmpdir(), "newbeing-mcp-smoke-"));
const previousDataDirectory = process.env.NEWBEING_DATA_DIR;
process.env.NEWBEING_DATA_DIR = dataDirectory;
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["--import", "tsx", serverPath],
  cwd: `${projectRoot}/packages/mcp`,
  env: {
    PATH: process.env.PATH ?? "",
    NODE_ENV: "test",
    NEWBEING_DATA_DIR: dataDirectory,
  },
  stderr: "inherit",
});

function readPayload(result: Awaited<ReturnType<typeof client.callTool>>): Record<string, unknown> {
  if (result.isError) throw new Error("MCP tool invocation returned an error.");
  const text = result.content.find((item) => item.type === "text");
  if (!text || text.type !== "text") throw new Error("MCP tool invocation returned no text payload.");
  return JSON.parse(text.text) as Record<string, unknown>;
}

try {
  await client.connect(transport);
  const tools = await client.listTools();
  const names = tools.tools.map((tool) => tool.name);
  const required = ["get_workspace_context", "get_market_data", "run_backtest", "prepare_order"];
  const missing = required.filter((name) => !names.includes(name));
  if (missing.length > 0) throw new Error(`MCP tool registration missing: ${missing.join(", ")}`);
  const expected = ["get_workspace_context", "get_market_data", "list_strategies", "get_strategy", "create_strategy", "run_backtest", "list_experiments", "get_backtest_result", "update_strategy", "open_workspace_view", "get_portfolio", "prepare_order"];
  if (names.length !== expected.length || expected.some((name) => !names.includes(name))) throw new Error("MCP execution surface changed; only the approved tools may be registered.");
  const pendingOwner = paperAccountId("BTC/USD", "kraken");
  beginPaperIntent({ clientOrderId: "mcp-interrupted-order", symbol: "BTC/USD", side: "buy", quantity: 0.1 }, pendingOwner);
  const context = readPayload(await client.callTool({ name: "get_workspace_context", arguments: {} }));
  if (!context.state) throw new Error("MCP workspace context tool returned no workspace state.");
  const recovery = context.paperRecovery as { pending: { clientOrderId: string; accountId: string }[] };
  if (!recovery?.pending.some((order) => order.clientOrderId === "mcp-interrupted-order" && order.accountId === pendingOwner) || listPaperRecoveries().length !== 0) throw new Error("MCP must expose pending ownership without resolving it.");
  const strategies = readPayload(await client.callTool({ name: "list_strategies", arguments: {} }));
  if (!Array.isArray(strategies.strategies) || strategies.strategies.length === 0) throw new Error("MCP list_strategies tool returned no strategies.");
  const strategyId = `custom-mcp-smoke-${Date.now().toString(36)}`;
  const created = readPayload(await client.callTool({
    name: "create_strategy",
    arguments: { id: strategyId, name: "MCP smoke draft", description: "Isolated stdio smoke test", parameters: {}, source: "// smoke draft; intentionally not executable" },
  }));
  if (created.executable !== false) throw new Error("MCP create_strategy incorrectly marked a source draft executable.");
  const fetched = readPayload(await client.callTool({ name: "get_strategy", arguments: { strategy_id: strategyId } }));
  if (fetched.executable !== false) throw new Error("MCP get_strategy did not return the saved draft as non-executable.");
  const seedBar = { timestamp: 60_000, open: 100, high: 105, low: 95, close: 100, volume: 10 };
  const session: ReplaySession = { id: "mcp-smoke-replay", exchange: "binance", symbol: "BTC/USDT", timeframe: "1m", startAt: 120_000, cursor: 60_000, bars: [seedBar], status: "active", createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString() };
  createConfiguredReplaySession(session, { id: "binance:spot:BTCUSDT", venue: "binance", nativeId: "BTCUSDT", symbol: session.symbol, base: "BTC", quote: "USDT", marketType: "spot" }, { initialCapital: 25_000, feeRate: 0.002, slippageRate: 0.001 });
  const queued = commandReplay(session.id, 0, { action: "order", order: { clientOrderId: "mcp-smoke-entry", side: "buy", type: "market", quantity: 1 } });
  const advanced = advanceReplaySession(session.id, session.cursor, { ...seedBar, timestamp: 120_000 }, undefined, queued.revision);
  saveWorkspaceState({ ...DEFAULT_WORKSPACE_STATE, activeWorkspace: "replay", activeReplayId: session.id, timeframe: "1m" });
  const portfolio = readPayload(await client.callTool({ name: "get_portfolio", arguments: { symbol: session.symbol } }));
  const wallet = portfolio.portfolio as { quoteBalance: number; baseBalance: number; feeRate: number };
  if (portfolio.mode !== "replay" || wallet.baseBalance !== 1 || Math.abs(wallet.quoteBalance - (25_000 - 100.1 * 1.002)) > 1e-8 || wallet.feeRate !== 0.002) throw new Error("MCP Replay portfolio diverges from the configured fill ledger.");
  const market = readPayload(await client.callTool({ name: "get_market_data", arguments: { symbol: session.symbol, timeframe: "1m" } }));
  if (JSON.stringify(market.candles) !== JSON.stringify(advanced.session.bars) || market.futureBarsLoaded !== 0) throw new Error("MCP returned data beyond the revealed Replay prefix.");
  const blocked = [
    { name: "get_market_data", arguments: { symbol: "ETH/USDT", timeframe: "1m" } },
    { name: "get_market_data", arguments: { symbol: session.symbol, timeframe: "1d" } },
    { name: "get_portfolio", arguments: { symbol: "ETH/USDT" } },
    { name: "list_experiments", arguments: {} },
    { name: "get_backtest_result", arguments: { result_id: "hidden" } },
    { name: "prepare_order", arguments: { symbol: session.symbol, side: "buy", quantity: 1 } },
    { name: "prepare_order", arguments: { symbol: session.symbol, side: "buy", quantity: 1, mode: "live" } },
  ];
  for (const call of blocked) {
    if (!(await client.callTool(call)).isError) throw new Error(`MCP Replay/live boundary failed for ${call.name}.`);
  }
  saveWorkspaceState({ ...DEFAULT_WORKSPACE_STATE, exchange: "kraken", activeWorkspace: "replay", activeReplayId: session.id, timeframe: "1m" });
  for (const call of [
    { name: "get_market_data", arguments: { symbol: session.symbol, timeframe: "1m" } },
    { name: "get_portfolio", arguments: { symbol: session.symbol } },
  ]) {
    if (!(await client.callTool(call)).isError) throw new Error(`MCP accepted a mismatched Replay venue for ${call.name}.`);
  }
  console.error(JSON.stringify({
    status: "ok",
    transport: "official SDK stdio client",
    toolCount: names.length,
    invocations: ["get_workspace_context", "list_strategies", "create_strategy", "get_strategy", "get_portfolio", "get_market_data", "list_experiments", "get_backtest_result", "prepare_order"],
    replayBoundaries: true,
    isolatedDatabase: true,
  }));
} finally {
  await client.close();
  closeDatabaseForTests();
  if (previousDataDirectory === undefined) delete process.env.NEWBEING_DATA_DIR;
  else process.env.NEWBEING_DATA_DIR = previousDataDirectory;
  rmSync(dataDirectory, { recursive: true, force: true });
}
