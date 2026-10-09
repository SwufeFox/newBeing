import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { randomUUID } from "node:crypto";
import { DEFAULT_WORKSPACE_STATE, logEvent, STRATEGIES, type Timeframe, type WorkspaceState } from "@newbeing/core";
import { findCandleGaps, getBinanceAdapter, removeFormingCandles } from "@newbeing/market-data";
import {
  getExperiment,
  getReplaySession,
  getPaperPortfolio,
  getStoredStrategy,
  getWorkspaceState,
  listExperiments,
  listStoredStrategies,
  paperAccountId,
  replayAccountId,
  saveStrategy,
  saveOrderPreview,
  saveWorkspaceState,
} from "@newbeing/storage";
import { runResearchBacktest } from "@newbeing/application";

const timeframe = z.enum(["1m", "5m", "15m", "30m", "1h", "4h", "1d"]);
const symbolSchema = z.string().regex(/^[A-Z0-9]{2,20}\/[A-Z0-9]{2,20}$/);
const parametersSchema = z.record(z.string(), z.union([z.number().finite(), z.boolean()]));

function textResult(value: unknown): { content: Array<{ type: "text"; text: string }>; structuredContent: Record<string, unknown> } {
  return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: { result: value } };
}

function errorResult(error: unknown): { content: Array<{ type: "text"; text: string }>; isError: true } {
  const message = error instanceof Error ? error.message : "The research operation failed.";
  logEvent("warn", "mcp.tool_failed", { message });
  return { content: [{ type: "text", text: message }], isError: true };
}

function publicStrategyList(): Array<{ id: string; name: string; version: string; description: string; parameters: unknown; executable: boolean }> {
  const builtins = STRATEGIES.map(({ id, name, version, description, defaults }) => ({
    id, name, version, description, parameters: defaults, executable: true,
  }));
  const drafts = listStoredStrategies().map(({ id, name, version, description, parameters }) => ({
    id, name, version, description, parameters, executable: false,
  }));
  return [...builtins, ...drafts];
}

function summarizeExperiment(result: NonNullable<ReturnType<typeof getExperiment>>, tradeLimit = 20, includeEquityCurve = false): Record<string, unknown> {
  return {
    resultId: result.resultId,
    datasetId: result.datasetId,
    symbol: result.symbol,
    timeframe: result.timeframe,
    strategyId: result.strategyId,
    strategyVersion: result.strategyVersion,
    parameters: result.parameters,
    assumptions: result.assumptions,
    execution: result.execution,
    engineVersion: result.engineVersion,
    createdAt: result.createdAt,
    metrics: result.metrics,
    tradeCount: result.trades.length,
    trades: result.trades.slice(0, Math.max(1, Math.min(200, tradeLimit))),
    equityCurve: includeEquityCurve ? result.equityCurve : {
      pointCount: result.equityCurve.length,
      first: result.equityCurve[0] ?? null,
      last: result.equityCurve.at(-1) ?? null,
    },
  };
}

export function createNewBeingMcpServer(): McpServer {
  const server = new McpServer({ name: "newbeing-local-research", version: "0.1.0" });

  server.registerTool("get_workspace_context", {
    title: "Get newBeing workspace context",
    description: "Read the current local market, chart range, strategy, workspace and trading mode. Does not include secrets.",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true },
  }, async () => {
    try {
      const result = getWorkspaceState();
      const state = { ...DEFAULT_WORKSPACE_STATE, ...result.state, mode: "paper" as const };
      return textResult({ ...result, state: state.activeWorkspace === "replay" ? { ...state, activeBacktestId: null } : state });
    } catch (error) { return errorResult(error); }
  });

  server.registerTool("get_market_data", {
    title: "Get Binance public OHLCV",
    description: "Fetch completed Binance Spot bars. Returns normalized UTC timestamps, detected gaps and public-source metadata.",
    inputSchema: z.object({
      symbol: symbolSchema,
      timeframe,
      limit: z.number().int().min(50).max(500).default(300),
    }),
    annotations: { readOnlyHint: true },
  }, async ({ symbol, timeframe: tf, limit }) => {
    try {
      const workspace = getWorkspaceState().state;
      if (workspace.activeWorkspace === "replay") {
        const session = workspace.activeReplayId ? getReplaySession(workspace.activeReplayId) : undefined;
        if (!session || session.symbol !== symbol || session.timeframe !== tf) {
          return errorResult(new Error("Market data is limited to the active Replay session's revealed bars. Exit Replay to query other market history."));
        }
        return textResult({ symbol, timeframe: tf, source: "Local Replay session; future bars withheld", candles: session.bars, gaps: findCandleGaps(session.bars, tf as Timeframe), futureBarsLoaded: 0 });
      }
      const raw = await getBinanceAdapter().fetchOHLCV(symbol, tf as Timeframe, limit);
      const candles = removeFormingCandles(raw, tf as Timeframe);
      return textResult({ symbol, timeframe: tf, source: "Binance Spot public market data via CCXT", candles, gaps: findCandleGaps(candles, tf as Timeframe) });
    } catch (error) { return errorResult(error); }
  });

  server.registerTool("get_portfolio", {
    title: "Get isolated Paper portfolio",
    description: "Read the local Paper simulator wallet for a symbol. This is not an exchange account and never includes API credentials.",
    inputSchema: z.object({ symbol: symbolSchema.default("BTC/USDT") }),
    annotations: { readOnlyHint: true },
  }, async ({ symbol }) => {
    try {
      const workspace = getWorkspaceState().state;
      if (workspace.activeWorkspace === "replay") {
        const session = workspace.activeReplayId ? getReplaySession(workspace.activeReplayId) : undefined;
        if (!session || session.symbol !== symbol) return errorResult(new Error("Replay portfolio is available only for the active replay symbol."));
        return textResult({ mode: "replay", source: "isolated local replay simulator", symbol, sessionId: session.id, portfolio: getPaperPortfolio(replayAccountId(session.id, symbol)) });
      }
      return textResult({ mode: "paper", source: "local simulator", symbol, portfolio: getPaperPortfolio(paperAccountId(symbol)) });
    } catch (error) { return errorResult(error); }
  });

  server.registerTool("list_strategies", {
    title: "List strategies",
    description: "List reviewed built-in strategies and saved source drafts. Draft source is not executable.",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true },
  }, async () => {
    try { return textResult({ strategies: publicStrategyList() }); }
    catch (error) { return errorResult(error); }
  });

  server.registerTool("get_strategy", {
    title: "Get strategy or source draft",
    description: "Read one reviewed built-in strategy or locally saved source draft.",
    inputSchema: z.object({ strategy_id: z.string().min(1).max(120) }),
    annotations: { readOnlyHint: true },
  }, async ({ strategy_id }) => {
    try {
      const builtin = STRATEGIES.find((strategy) => strategy.id === strategy_id);
      if (builtin) return textResult({ ...builtin, executable: true });
      const draft = getStoredStrategy(strategy_id);
      if (!draft) return errorResult(new Error("Strategy not found."));
      return textResult({ ...draft, executable: false });
    } catch (error) { return errorResult(error); }
  });

  const draftSchema = z.object({
    id: z.string().regex(/^custom-[a-z0-9-]{2,80}$/),
    name: z.string().trim().min(2).max(80),
    description: z.string().trim().max(500).default(""),
    parameters: parametersSchema.default({}),
    source: z.string().max(50_000),
  });

  server.registerTool("create_strategy", {
    title: "Create strategy source draft",
    description: "Save a local research draft. Arbitrary source is never executed; only built-in strategies can currently run.",
    inputSchema: draftSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, async (input) => {
    try {
      const draft = saveStrategy({ ...input, version: "draft" });
      return textResult({ strategy: draft, executable: false });
    } catch (error) { return errorResult(error); }
  });

  server.registerTool("update_strategy", {
    title: "Update strategy source draft",
    description: "Update an existing custom local draft. Built-in strategies are immutable and user code is not executed.",
    inputSchema: draftSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, async (input) => {
    try {
      if (!getStoredStrategy(input.id)) return errorResult(new Error("Custom draft not found; create it first."));
      const draft = saveStrategy({ ...input, version: "draft" });
      return textResult({ strategy: draft, executable: false });
    } catch (error) { return errorResult(error); }
  });

  server.registerTool("run_backtest", {
    title: "Run deterministic historical backtest",
    description: "Run a closed-bar OHLCV backtest using next-bar-open fills, explicit fees/slippage and a reviewed built-in strategy; persist the experiment and select it in the local workspace.",
    inputSchema: z.object({
      symbol: symbolSchema,
      timeframe,
      strategy_id: z.string().min(1).max(120),
      parameters: parametersSchema.default({}),
      initial_capital: z.number().positive().max(1_000_000_000),
      position_fraction: z.number().positive().max(1),
      fee_rate: z.number().min(0).max(0.05),
      slippage_rate: z.number().min(0).max(0.05),
      allow_shorts: z.boolean().default(false),
      stop_loss_pct: z.number().positive().max(0.99).optional(),
      take_profit_pct: z.number().positive().max(9.99).optional(),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, async (input) => {
    try {
      const config = {
        initialCapital: input.initial_capital,
        positionFraction: input.position_fraction,
        feeRate: input.fee_rate,
        slippageRate: input.slippage_rate,
        allowShorts: input.allow_shorts,
        ...(input.stop_loss_pct === undefined ? {} : { stopLossPct: input.stop_loss_pct }),
        ...(input.take_profit_pct === undefined ? {} : { takeProfitPct: input.take_profit_pct }),
      };
      const result = await runResearchBacktest({
        symbol: input.symbol,
        timeframe: input.timeframe as Timeframe,
        strategyId: input.strategy_id,
        parameters: input.parameters,
        config,
        openInWorkspace: true,
      });
      return textResult({ ...summarizeExperiment(result), note: "Full result details are available through get_backtest_result and the local workspace." });
    } catch (error) { return errorResult(error); }
  });

  server.registerTool("get_backtest_result", {
    title: "Get saved backtest result",
    description: "Read a reproducible experiment result and its dataset/execution provenance from local SQLite.",
    inputSchema: z.object({
      result_id: z.string().min(1).max(120),
      trade_limit: z.number().int().min(1).max(200).default(100),
      include_equity_curve: z.boolean().default(false),
    }),
    annotations: { readOnlyHint: true },
  }, async ({ result_id, trade_limit, include_equity_curve }) => {
    try {
      if (getWorkspaceState().state.activeWorkspace === "replay") return errorResult(new Error("Saved backtests are hidden during Replay to prevent future-result leakage."));
      const result = getExperiment(result_id);
      return result ? textResult(summarizeExperiment(result, trade_limit, include_equity_curve)) : errorResult(new Error("Backtest result not found."));
    } catch (error) { return errorResult(error); }
  });

  server.registerTool("list_experiments", {
    title: "List local experiments",
    description: "List the most recent backtests saved in local SQLite.",
    inputSchema: z.object({ limit: z.number().int().min(1).max(50).default(20) }),
    annotations: { readOnlyHint: true },
  }, async ({ limit }) => {
    try {
      if (getWorkspaceState().state.activeWorkspace === "replay") return errorResult(new Error("Experiment history is hidden during Replay to prevent future-result leakage."));
      const items = listExperiments(limit).map((result) => ({
        resultId: result.resultId,
        datasetId: result.datasetId,
        symbol: result.symbol,
        timeframe: result.timeframe,
        strategyId: result.strategyId,
        strategyVersion: result.strategyVersion,
        createdAt: result.createdAt,
        metrics: result.metrics,
      }));
      return textResult({ items });
    }
    catch (error) { return errorResult(error); }
  });

  server.registerTool("open_workspace_view", {
    title: "Open a newBeing workspace view",
    description: "Synchronize the local browser to a research view or saved backtest. This changes only local workspace navigation.",
    inputSchema: z.object({
      workspace: z.enum(["terminal", "research", "backtest", "replay"]),
      result_id: z.string().min(1).max(120).optional(),
      replay_id: z.string().min(1).max(120).optional(),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, async ({ workspace, result_id, replay_id }) => {
    try {
      const current = getWorkspaceState().state;
      const replayId = replay_id ?? current.activeReplayId;
      if (workspace === "replay" && (!replayId || !getReplaySession(replayId))) return errorResult(new Error("Provide a valid replay_id before opening Replay."));
      if (result_id && !getExperiment(result_id)) return errorResult(new Error("Requested backtest result does not exist."));
      const state: WorkspaceState = {
        ...current,
        activeWorkspace: workspace,
        activeBacktestId: workspace === "replay" ? null : result_id ?? current.activeBacktestId,
        activeReplayId: replayId ?? null,
      };
      const updatedAt = saveWorkspaceState(state);
      return textResult({ state, updatedAt, message: "The local browser will synchronize this view." });
    } catch (error) { return errorResult(error); }
  });

  server.registerTool("prepare_order", {
    title: "Prepare paper order preview",
    description: "Calculate a local Paper-only order preview. Does not place an order. User confirmation in the trusted UI is required for a simulated fill; live trading is disabled.",
    inputSchema: z.object({
      symbol: symbolSchema,
      side: z.enum(["buy", "sell"]),
      quantity: z.number().positive().max(1_000_000),
      mode: z.enum(["paper", "live"]).default("paper"),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, async ({ symbol: orderSymbol, side, quantity, mode }) => {
    if (mode === "live") return errorResult(new Error("Live trading is disabled; a real order preview cannot be prepared."));
    try {
      if (getWorkspaceState().state.activeWorkspace === "replay") return errorResult(new Error("Normal Paper order previews are disabled during Replay. Use the replay UI ticket, which fills only at the revealed cursor close."));
      const summary = await getBinanceAdapter().fetchSummary(orderSymbol);
      const price = side === "buy" ? (summary.ask ?? summary.last) : (summary.bid ?? summary.last);
      if (price === null || price <= 0) return errorResult(new Error("No usable public quote is available for a preview."));
      const portfolio = getPaperPortfolio(paperAccountId(orderSymbol));
      const notional = price * quantity;
      const estimatedFee = notional * portfolio.feeRate;
      if (side === "buy" && notional + estimatedFee > portfolio.quoteBalance) return errorResult(new Error("Insufficient Paper quote balance for this preview."));
      if (side === "sell" && quantity > portfolio.baseBalance) return errorResult(new Error("Insufficient Paper base balance for this preview."));
      const now = new Date();
      const preview = {
        id: randomUUID(),
        symbol: orderSymbol,
        side,
        quantity,
        mode: "paper",
        referencePrice: price,
        estimatedNotional: notional,
        estimatedFee,
        status: "prepared",
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
        orderId: null,
      } as const;
      saveOrderPreview(preview);
      return textResult({
        preview,
        note: "Preview is stored in the local workspace. No order was created or transmitted. Confirm separately in the UI before expiry; the quote may change.",
      });
    } catch (error) { return errorResult(error); }
  });

  return server;
}
