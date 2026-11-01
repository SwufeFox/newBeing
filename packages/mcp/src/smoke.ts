import { Client } from "@modelcontextprotocol/client";
import { DEFAULT_WORKSPACE_STATE, MAX_RESEARCH_BARS, type ReplaySession } from "@newbeing/core";
import { beginPaperIntent, identifyDataset, listPaperRecoveries, paperAccountId, advanceReplaySession, closeDatabaseForTests, commandReplay, createConfiguredReplaySession, saveDatasetSnapshot, saveWorkspaceState } from "@newbeing/storage";
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
    NEWBEING_E2E_FIXTURES: "1",
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
  const required = ["get_workspace_context", "get_market_data", "run_backtest", "run_research_sweep", "rerun_backtest", "rerun_backtest_sweep", "get_research_sweep", "prepare_order"];
  const missing = required.filter((name) => !names.includes(name));
  if (missing.length > 0) throw new Error(`MCP tool registration missing: ${missing.join(", ")}`);
  const expected = ["get_workspace_context", "get_market_data", "list_strategies", "get_strategy", "create_strategy", "run_backtest", "run_research_sweep", "rerun_backtest", "rerun_backtest_sweep", "get_research_sweep", "list_experiments", "get_backtest_result", "update_strategy", "open_workspace_view", "get_portfolio", "prepare_order", "list_derivative_instruments", "get_derivative_market", "get_derivative_portfolio"];
  if (names.length !== expected.length || expected.some((name) => !names.includes(name))) throw new Error("MCP execution surface changed; only the approved tools may be registered.");
  const prompts = await client.listPrompts();
  if (["research_question", "explain_result", "replay_review"].some((name) => !prompts.prompts.some((prompt) => prompt.name === name))) throw new Error("MCP prompt registration is incomplete.");
  const prompt = await client.getPrompt({ name: "research_question", arguments: { question: "Compare a bounded strategy range." } });
  if (!JSON.stringify(prompt).includes("run_research_sweep")) throw new Error("MCP research prompt omitted the bounded sweep workflow.");
  const resources = await client.listResources();
  if (["newbeing://agent-guide/v1", "newbeing://safety/v1"].some((uri) => !resources.resources.some((resource) => resource.uri === uri))) throw new Error("MCP policy resources are incomplete.");
  const guide = await client.readResource({ uri: "newbeing://agent-guide/v1" });
  if (!guide.contents.some((item) => "text" in item && item.text.includes(`${MAX_RESEARCH_BARS.toLocaleString("en-US")} completed bars`) && item.text.includes("candidateRuns") && item.text.includes("SWEEP_NO_FINITE_TRAINING_SHARPE"))) throw new Error("MCP agent guide omitted bounded sweep evidence or stable failure guidance.");
  const researchBars = Array.from({ length: 80 }, (_, index) => {
    const close = 100 + Math.sin(index / 2.7) * 8 + Math.sin(index / 7) * 3 + index * 0.03;
    return { timestamp: index * 60_000, open: close, high: close + 1, low: close - 1, close, volume: index + 1 };
  });
  const researchInput = { exchange: "binance" as const, symbol: "BTC/USDT", timeframe: "1m" as const, candles: researchBars };
  const researchDatasetId = saveDatasetSnapshot(researchInput);
  if (identifyDataset(researchInput).datasetId !== researchDatasetId) throw new Error("MCP smoke dataset identity is unstable.");
  const sweepPayload = readPayload(await client.callTool({
    name: "run_research_sweep",
    arguments: {
      dataset_id: researchDatasetId,
      symbol: "BTC/USDT",
      timeframe: "1m",
      strategy_id: "momentum-reversal",
      parameters: { lookback: 2, thresholdPct: 1 },
      parameter: "thresholdPct",
      from: 0.5,
      to: 5,
      step: 0.5,
      mode: "walk-forward",
      selection_metric: "sharpe_ratio",
      max_training_drawdown: 0.9,
      initial_capital: 1_000,
      position_fraction: 1,
      fee_rate: 0,
      slippage_rate: 0,
      account_mode: "spot",
      allow_shorts: false,
    },
  }));
  const sweepData = sweepPayload.data as {
    sweepId: string;
    values: number[];
    candidateRuns: { value: number; resultId: string; segment: { start: number; end: number }; metrics: Record<string, unknown> }[];
    candidateRunCount: number;
    candidateRunLimit: number;
    walkForward: { selectionMetric: string; selectionConstraints?: { maxTrainingDrawdown?: number } };
  };
  if (sweepData.walkForward.selectionMetric !== "sharpeRatio" || sweepData.walkForward.selectionConstraints?.maxTrainingDrawdown !== 0.9 ||
      sweepData.candidateRuns.length !== sweepData.values.length * 4 || sweepData.candidateRunCount !== sweepData.candidateRuns.length ||
      sweepData.candidateRunLimit !== sweepData.values.length * 4 || sweepData.candidateRuns.length > 160 ||
      sweepData.candidateRuns.some((run) => run.segment.start !== 0 || !run.resultId || Object.hasOwn(run, "trades") || Object.hasOwn(run, "equityCurve"))) {
    throw new Error("MCP sweep summary omitted bounded training-candidate evidence or leaked full run data.");
  }
  const expectedEvidence = JSON.stringify(sweepData.candidateRuns.map(({ value, segment, metrics }) => ({ value, segment, metrics })));
  for (const name of ["get_research_sweep", "rerun_backtest_sweep"] as const) {
    const payload = readPayload(await client.callTool({ name, arguments: { sweep_id: sweepData.sweepId } }));
    const saved = payload.data as typeof sweepData;
    if (JSON.stringify(saved.candidateRuns.map(({ value, segment, metrics }) => ({ value, segment, metrics }))) !== expectedEvidence) {
      throw new Error(`MCP ${name} did not preserve candidate evidence.`);
    }
  }

  const flatBars = researchBars.map((bar) => ({ ...bar, open: 100, high: 101, low: 99, close: 100 }));
  const flatDatasetId = saveDatasetSnapshot({ ...researchInput, candles: flatBars });
  const failedSweep = await client.callTool({
    name: "run_research_sweep",
    arguments: {
      dataset_id: flatDatasetId,
      symbol: "BTC/USDT",
      timeframe: "1m",
      strategy_id: "momentum-reversal",
      parameters: { lookback: 2, thresholdPct: 1 },
      parameter: "thresholdPct",
      from: 0.5,
      to: 1.5,
      step: 0.5,
      mode: "walk-forward",
      selection_metric: "sharpe_ratio",
      initial_capital: 1_000,
      position_fraction: 1,
      fee_rate: 0,
      slippage_rate: 0,
      account_mode: "spot",
      allow_shorts: false,
    },
  });
  const failedText = failedSweep.content.find((item) => item.type === "text");
  const failure = failedText?.type === "text" ? JSON.parse(failedText.text) as { error?: { code?: string; nextAction?: string } } : null;
  if (!failedSweep.isError || failure?.error?.code !== "SWEEP_NO_FINITE_TRAINING_SHARPE" || !failure.error.nextAction?.includes("total_return")) {
    throw new Error("MCP sweep errors omitted the stable no-finite-Sharpe code or recovery guidance.");
  }
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
  const shared = readPayload(await client.callTool({ name: "get_portfolio", arguments: { symbol: "BTC/USDT", account_mode: "shared-spot" } }));
  if (shared.accountMode !== "shared-spot" || shared.account !== null) throw new Error("MCP shared-wallet reads must not seed or return a legacy wallet.");
  if (!(await client.callTool({ name: "prepare_order", arguments: { symbol: "BTC/USDT", side: "buy", quantity: 1, account_mode: "shared-spot" } })).isError) throw new Error("MCP silently routed a shared preview to the legacy wallet.");
  const derivativesPortfolio = readPayload(await client.callTool({ name: "get_derivative_portfolio", arguments: { venue: "okx", settle: "USDT" } }));
  if (derivativesPortfolio.account !== null) throw new Error("MCP derivatives reads must not initialize an account.");
  const derivativeList = readPayload(await client.callTool({ name: "list_derivative_instruments", arguments: { kind: "perpetual", query: "BTC" } }));
  const derivativeInstruments = derivativeList.instruments as { id: string; kind: string; source: string }[];
  if (!derivativeInstruments?.length || derivativeInstruments[0]?.kind !== "perpetual" || derivativeInstruments[0]?.source !== "fixture") throw new Error("MCP derivatives fixtures must be explicit and retain native product identity.");
  const derivativeMarket = readPayload(await client.callTool({ name: "get_derivative_market", arguments: { instrument_id: derivativeInstruments[0]!.id } }));
  if ((derivativeMarket.quote as { instrumentId: string }).instrumentId !== derivativeInstruments[0]!.id) throw new Error("MCP derivative quote does not match its product.");
  const seedBar = { timestamp: 60_000, open: 100, high: 105, low: 95, close: 100, volume: 10 };
  const session: ReplaySession = { id: "mcp-smoke-replay", exchange: "binance", symbol: "BTC/USDT", timeframe: "1m", startAt: 120_000, cursor: 60_000, bars: [seedBar], status: "active", createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString() };
  createConfiguredReplaySession(session, { id: "binance:spot:BTCUSDT", venue: "binance", nativeId: "BTCUSDT", symbol: session.symbol, base: "BTC", quote: "USDT", marketType: "spot" }, { initialCapital: 25_000, feeRate: 0.002, slippageRate: 0.001 });
  const queued = commandReplay(session.id, 0, { action: "order", order: { clientOrderId: "mcp-smoke-entry", side: "buy", type: "market", quantity: 1 } });
  const advanced = advanceReplaySession(session.id, session.cursor, { ...seedBar, timestamp: 120_000 }, undefined, queued.revision);
  saveWorkspaceState({ ...DEFAULT_WORKSPACE_STATE, activeWorkspace: "replay", activeReplayId: session.id, timeframe: "1m" });
  const portfolio = readPayload(await client.callTool({ name: "get_portfolio", arguments: { symbol: session.symbol } }));
  const wallet = portfolio.portfolio as { quoteBalance: number; baseBalance: number; feeRate: number };
  if (portfolio.mode !== "replay" || wallet.baseBalance !== 1 || Math.abs(wallet.quoteBalance - (25_000 - 100.1 * 1.002)) > 1e-8 || wallet.feeRate !== 0.002) throw new Error("MCP Replay portfolio diverges from the configured fill ledger.");
  const marketSummary = readPayload(await client.callTool({ name: "get_market_data", arguments: { symbol: session.symbol, timeframe: "1m" } }));
  const marketSummaryData = marketSummary.summary;
  if (marketSummary.candles !== undefined || typeof marketSummaryData !== "object" || marketSummaryData === null || !("bars" in marketSummaryData) || typeof marketSummaryData.bars !== "number" || marketSummaryData.bars !== advanced.session.bars.length) throw new Error("MCP market data should return a bounded summary unless bars are requested.");
  const market = readPayload(await client.callTool({ name: "get_market_data", arguments: { symbol: session.symbol, timeframe: "1m", include_bars: true } }));
  if (JSON.stringify(market.candles) !== JSON.stringify(advanced.session.bars) || market.futureBarsLoaded !== 0) throw new Error("MCP returned data beyond the revealed Replay prefix.");
  const blocked = [
    { name: "get_market_data", arguments: { symbol: "ETH/USDT", timeframe: "1m" } },
    { name: "get_market_data", arguments: { symbol: session.symbol, timeframe: "1d" } },
    { name: "get_portfolio", arguments: { symbol: "ETH/USDT" } },
    { name: "get_portfolio", arguments: { symbol: session.symbol, account_mode: "shared-spot" } },
    { name: "list_derivative_instruments", arguments: { kind: "option" } },
    { name: "get_derivative_market", arguments: { instrument_id: derivativeInstruments[0]!.id } },
    { name: "get_derivative_portfolio", arguments: { venue: "okx", settle: "USDT" } },
    { name: "get_market_data", arguments: { symbol: session.symbol, timeframe: "1m", exchange: "kraken" } },
    { name: "get_portfolio", arguments: { symbol: session.symbol, exchange: "kraken" } },
    { name: "run_backtest", arguments: { symbol: session.symbol, timeframe: "1m", strategy_id: "rsi-mean-reversion", initial_capital: 1_000, position_fraction: 0.5, fee_rate: 0.001, slippage_rate: 0.001 } },
    { name: "run_research_sweep", arguments: { symbol: session.symbol, timeframe: "1m", strategy_id: "rsi-mean-reversion", parameter: "period", from: 10, to: 12, step: 1, initial_capital: 1_000, position_fraction: 0.5, fee_rate: 0.001, slippage_rate: 0.001 } },
    { name: "rerun_backtest", arguments: { result_id: "hidden" } },
    { name: "rerun_backtest_sweep", arguments: { sweep_id: "hidden" } },
    { name: "get_research_sweep", arguments: { sweep_id: "hidden" } },
    { name: "list_experiments", arguments: {} },
    { name: "get_backtest_result", arguments: { result_id: "hidden" } },
    { name: "prepare_order", arguments: { symbol: session.symbol, side: "buy", quantity: 1 } },
    { name: "prepare_order", arguments: { symbol: session.symbol, side: "buy", quantity: 1, mode: "live" } },
  ];
  for (const call of blocked) {
    if (!(await client.callTool(call)).isError) throw new Error(`MCP Replay/live boundary failed for ${call.name}.`);
  }
  const blockedSweep = await client.callTool({ name: "get_research_sweep", arguments: { sweep_id: "hidden" } });
  const blockedSweepText = blockedSweep.content.find((item) => item.type === "text");
  if (!blockedSweep.isError || !blockedSweepText || blockedSweepText.type !== "text" || JSON.parse(blockedSweepText.text).error?.code !== "RESEARCH_OPERATION_FAILED") throw new Error("MCP research errors must use the stable versioned envelope.");
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
    invocations: ["get_workspace_context", "research_question prompt", "agent-guide resource", "list_strategies", "create_strategy", "get_strategy", "get_portfolio", "get_market_data", "run_research_sweep", "rerun_backtest", "rerun_backtest_sweep", "get_research_sweep", "list_experiments", "get_backtest_result", "prepare_order"],
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
