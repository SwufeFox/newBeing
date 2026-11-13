import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { randomUUID } from "node:crypto";
import { SPOT_EXECUTION_POLICY, estimatePaperAmounts, fillPaperOrder, SIMULATION_PRECISION, DEFAULT_WORKSPACE_STATE, logEvent, STRATEGIES, type Timeframe, type WorkspaceState } from "@newbeing/core";
import { findCandleGaps, getExchangeAdapter, removeFormingCandles, timeframeMilliseconds } from "@newbeing/market-data";
import {
  getExperiment,
  getSavedSweep,
  loadDatasetSnapshot,
  researchSweepRunSegments,
  getReplaySession,
  getReplayExecution,
  getPaperPortfolio,
  getStoredStrategy,
  getWorkspaceState,
  listExperimentMetadata,
  listStoredStrategySummaries,
  replayAccountId,
  saveStrategy,
  saveOrderPreview,
  saveWorkspaceState,
} from "@newbeing/storage";
import { assertResearchAvailable, ResearchError, readPaperAccount, readPaperRecoveryState, readSharedSpotAccount, rerunBacktestSweep, rerunResearchBacktest, runBacktestSweep, runResearchBacktest, SpotReplayBlockedError, type SweepResult } from "@newbeing/application";
import { registerAIGuidance } from "./ai-guidance.js";
import { registerDerivativesTools } from "./derivatives-tools.js";

const timeframe = z.enum(["1m", "5m", "15m", "30m", "1h", "4h", "1d"]);
const exchangeSchema = z.enum(["binance", "coinbaseexchange", "kraken", "okx"]);
const dateTimeSchema = z.iso.datetime({ offset: true });
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

function researchResult(data: Record<string, unknown>, artifactType: "backtest-result" | "research-sweep", artifactId: string, source: string): { content: Array<{ type: "text"; text: string }>; structuredContent: Record<string, unknown> } {
  const envelope = {
    schemaVersion: 1,
    ok: true,
    data,
    provenance: {
      exchange: data.exchange ?? null,
      symbol: data.symbol ?? null,
      timeframe: data.timeframe ?? null,
      source,
      asOf: new Date().toISOString(),
      datasetId: data.datasetId ?? null,
      barRange: data.barRange ?? null,
    },
    warnings: [],
    artifacts: [{ type: artifactType, id: artifactId }],
  };
  return { content: [{ type: "text", text: JSON.stringify(envelope) }], structuredContent: envelope };
}

function researchError(error: unknown): { content: Array<{ type: "text"; text: string }>; structuredContent: Record<string, unknown>; isError: true } {
  const message = error instanceof Error ? error.message : "The research operation failed.";
  const research = error instanceof ResearchError ? error : null;
  logEvent("warn", "mcp.research_failed", { message, ...(research?.code === undefined ? {} : { code: research.code }) });
  const envelope = {
    schemaVersion: 1,
    ok: false,
    error: {
      code: research?.code ?? "RESEARCH_OPERATION_FAILED",
      message,
      retryable: false,
      nextAction: research?.nextAction ?? "Check Replay state, instrument and range bounds, and strategy parameters before retrying.",
    },
  };
  return { content: [{ type: "text", text: JSON.stringify(envelope) }], structuredContent: envelope, isError: true };
}

function publicStrategyList(): Array<{ id: string; name: string; version: string; description: string; parameters: unknown; executable: boolean }> {
  const builtins = STRATEGIES.map(({ id, name, version, description, defaults }) => ({
    id, name, version, description, parameters: defaults, executable: true,
  }));
  const drafts = listStoredStrategySummaries().map(({ id, name, version, description, parameters }) => ({
    id, name, version, description, parameters, executable: false,
  }));
  return [...builtins, ...drafts];
}

function summarizeExperiment(result: NonNullable<ReturnType<typeof getExperiment>>, tradeLimit = 0, includeEquityCurve = false): Record<string, unknown> {
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
    executionPolicy: result.executionPolicy ?? null,
    reproduction: result.reproduction ?? null,
    exchange: result.exchange,
    barRange: summarizeBarRange(result),
    engineVersion: result.engineVersion,
    createdAt: result.createdAt,
    metrics: result.metrics,
    tradeCount: result.trades.length,
    trades: result.trades.slice(0, Math.max(0, Math.min(200, tradeLimit))),
    equityCurve: includeEquityCurve ? result.equityCurve : {
      pointCount: result.equityCurve.length,
      first: result.equityCurve[0] ?? null,
      last: result.equityCurve.at(-1) ?? null,
    },
  };
}

function summarizeBarRange(result: NonNullable<ReturnType<typeof getExperiment>>): { startAt: number; endAtExclusive: number; bars: number } | null {
  const first = result.equityCurve[0];
  const last = result.equityCurve.at(-1);
  return first && last ? { startAt: first.timestamp, endAtExclusive: last.timestamp + timeframeMilliseconds(result.timeframe), bars: result.equityCurve.length } : null;
}

function summarizeSweep(sweep: SweepResult | NonNullable<ReturnType<typeof getSavedSweep>>): Record<string, unknown> {
  const snapshot = loadDatasetSnapshot(sweep.datasetId);
  const first = snapshot.candles[0];
  const last = snapshot.candles.at(-1);
  const candidateRuns = sweep.walkForward ? (() => {
    const segments = researchSweepRunSegments(sweep);
    const trainingEnds = new Set([
      sweep.walkForward!.boundaries.train50,
      sweep.walkForward!.boundaries.train60,
      sweep.walkForward!.boundaries.train70,
      sweep.walkForward!.boundaries.train80,
    ]);
    return sweep.runs.flatMap((run) => {
      const segment = run.segment ?? segments.get(run.resultId);
      if (!segment || segment.start !== 0 || !trainingEnds.has(segment.end)) return [];
      return [{
        value: run.value,
        resultId: run.resultId,
        segment: {
          start: segment.start,
          end: segment.end,
          ...(run.segment ? { datasetId: run.segment.datasetId } : {}),
        },
        metrics: {
          totalReturn: run.metrics.totalReturn,
          maxDrawdown: run.metrics.maxDrawdown,
          sharpeRatio: run.metrics.sharpeRatio,
          winRate: run.metrics.winRate,
          profitFactor: run.metrics.profitFactor,
          tradeCount: run.metrics.tradeCount,
          totalFees: run.metrics.totalFees,
          finalEquity: run.metrics.finalEquity,
        },
      }];
    });
  })() : [];
  return {
    sweepId: sweep.sweepId,
    rerunOf: sweep.rerunOf ?? null,
    mode: sweep.mode ?? "full-sample",
    exchange: sweep.exchange,
    symbol: sweep.symbol,
    timeframe: sweep.timeframe,
    strategyId: sweep.strategyId,
    strategyVersion: sweep.strategyVersion,
    parameter: sweep.parameter,
    values: sweep.values,
    datasetId: sweep.datasetId,
    bars: sweep.bars,
    barRange: first && last ? { startAt: first.timestamp, endAtExclusive: last.timestamp + timeframeMilliseconds(sweep.timeframe), bars: snapshot.candles.length } : null,
    createdAt: sweep.createdAt,
    ...(sweep.walkForward ? {
      walkForward: sweep.walkForward,
      runCount: sweep.runs.length,
      candidateRuns,
      candidateRunCount: candidateRuns.length,
      candidateRunLimit: sweep.values.length * 4,
    } : {
      runs: sweep.runs.map(({ value, resultId, metrics }) => ({ value, resultId, metrics })),
    }),
  };
}
export function createNewBeingMcpServer(): McpServer {
  const server = new McpServer({ name: "newbeing-local-research", version: "0.1.0" });
  registerAIGuidance(server);
  registerDerivativesTools(server);

  server.registerTool("get_workspace_context", {
    title: "Get newBeing workspace context",
    description: "Read the current local market, chart range, strategy, workspace and trading mode. Does not include secrets.",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true },
  }, async () => {
    try {
      const result = getWorkspaceState();
      const state = { ...DEFAULT_WORKSPACE_STATE, ...result.state, mode: "paper" as const };
      return textResult({ ...result, state: state.activeWorkspace === "replay" ? { ...state, activeBacktestId: null } : state,
        paperRecovery: { ...readPaperRecoveryState(), policy: "Read only. Interrupted local Paper can only be cancelled with an audit reason in the UI; never re-quoted or filled by MCP." },
      });
    } catch (error) { return errorResult(error); }
  });

  server.registerTool("get_market_data", {
    title: "Get selected venue public OHLCV",
    description: "Read completed public Spot bars from the selected venue. Returns range/gap/source metadata by default; request include_bars for at most 500 bars. Replay returns only the matching active session prefix.",
    inputSchema: z.object({
      symbol: symbolSchema,
      exchange: exchangeSchema.optional(),
      timeframe,
      limit: z.number().int().min(50).max(500).default(300),
      include_bars: z.boolean().default(false),
    }),
    annotations: { readOnlyHint: true },
  }, async ({ symbol, exchange: requestedExchange, timeframe: tf, limit, include_bars }) => {
    try {
      const workspace = getWorkspaceState().state;
      const selectedExchange = requestedExchange ?? workspace.exchange;
      if (workspace.activeWorkspace === "replay") {
        const session = workspace.activeReplayId ? getReplaySession(workspace.activeReplayId) : undefined;
        if (!session || session.exchange !== workspace.exchange || session.exchange !== selectedExchange || session.symbol !== symbol || session.timeframe !== tf) {
          return errorResult(new Error("Market data is limited to the active Replay session's revealed bars. Exit Replay to query other market history."));
        }
        const candles = session.bars.slice(-limit);
        const first = candles[0];
        const last = candles.at(-1);
        return textResult({ exchange: session.exchange, symbol, timeframe: tf, source: "Local Replay session; future bars withheld", summary: { bars: candles.length, startAt: first?.timestamp ?? null, endAtExclusive: last ? last.timestamp + timeframeMilliseconds(tf as Timeframe) : null }, gaps: findCandleGaps(candles, tf as Timeframe), ...(include_bars ? { candles } : {}), futureBarsLoaded: 0 });
      }
      const adapter = getExchangeAdapter(selectedExchange);
      const raw = await adapter.fetchOHLCV(symbol, tf as Timeframe, limit);
      const candles = removeFormingCandles(raw, tf as Timeframe);
      const exchangeName = { binance: "Binance Spot", coinbaseexchange: "Coinbase Exchange", kraken: "Kraken Spot", okx: "OKX Spot" }[selectedExchange];
      const first = candles[0];
      const last = candles.at(-1);
      return textResult({ exchange: selectedExchange, symbol, timeframe: tf, source: `${exchangeName} public market data via CCXT`, summary: { bars: candles.length, startAt: first?.timestamp ?? null, endAtExclusive: last ? last.timestamp + timeframeMilliseconds(tf as Timeframe) : null }, gaps: findCandleGaps(candles, tf as Timeframe), ...(include_bars ? { candles } : {}) });
    } catch (error) { return errorResult(error); }
  });

  server.registerTool("get_portfolio", {
    title: "Get isolated Paper portfolio",
    description: "Read the local Paper simulator wallet for a symbol. This is not an exchange account and never includes API credentials.",
    inputSchema: z.object({ symbol: symbolSchema.default("BTC/USDT"), exchange: exchangeSchema.optional(), account_mode: z.enum(["legacy", "shared-spot"]).default("legacy") }),
    annotations: { readOnlyHint: true },
  }, async ({ symbol, exchange: requestedExchange, account_mode }) => {
    try {
      const workspace = getWorkspaceState().state;
      const selectedExchange = requestedExchange ?? workspace.exchange;
      if (account_mode === "shared-spot") {
        try {
          const account = readSharedSpotAccount(selectedExchange, symbol.split("/")[1]!);
          return textResult({ mode: "paper", accountMode: "shared-spot", exchange: selectedExchange, account: account ?? null, policy: SPOT_EXECUTION_POLICY, note: "Open and trade the shared account explicitly in the trusted UI. Legacy previews remain bound to legacy pair wallets." });
        } catch (error) {
          if (error instanceof SpotReplayBlockedError) return errorResult(new Error("Shared spot accounts are hidden during Replay."));
          throw error;
        }
      }
      if (workspace.activeWorkspace === "replay") {
        const session = workspace.activeReplayId ? getReplaySession(workspace.activeReplayId) : undefined;
        if (!session || session.exchange !== workspace.exchange || session.exchange !== selectedExchange || session.symbol !== symbol) return errorResult(new Error("Replay portfolio is available only for the active replay venue and symbol."));
        return textResult({ mode: "replay", source: "isolated local replay simulator", exchange: session.exchange, symbol, sessionId: session.id, portfolio: getReplayExecution(session.id)?.portfolio ?? getPaperPortfolio(replayAccountId(session.id, symbol, session.exchange)) });
      }
      const read = readPaperAccount(selectedExchange, symbol);
      if (!read.visible || !read.account) return errorResult(new Error("Normal Paper accounts are hidden during Replay."));
      return textResult({ mode: "paper", source: "local simulator", exchange: selectedExchange, symbol, portfolio: read.account.portfolio });
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
    description: "Run a deterministic built-in strategy against completed public candles. Persist the result; select it in the local workspace only when open_in_workspace is true.",
    inputSchema: z.object({
      symbol: symbolSchema,
      exchange: exchangeSchema.optional(),
      timeframe,
      limit: z.number().int().min(50).max(1_000).optional(),
      start_at: dateTimeSchema.optional(),
      end_at: dateTimeSchema.optional(),
      open_in_workspace: z.boolean().default(true),
      strategy_id: z.string().min(1).max(120),
      parameters: parametersSchema.default({}),
      initial_capital: z.number().positive().max(1_000_000_000),
      position_fraction: z.number().positive().max(1),
      fee_rate: z.number().min(0).max(0.05),
      slippage_rate: z.number().min(0).max(0.05),
      account_mode: z.enum(["spot", "legacy-margin"]).default("spot"),
      allow_shorts: z.boolean().default(false),
      stop_loss_pct: z.number().positive().max(0.99).optional(),
      take_profit_pct: z.number().positive().max(9.99).optional(),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, async (input) => {
    try {
      const config = {
        accountMode: input.account_mode,
        initialCapital: input.initial_capital,
        positionFraction: input.position_fraction,
        feeRate: input.fee_rate,
        slippageRate: input.slippage_rate,
        allowShorts: input.allow_shorts,
        ...(input.stop_loss_pct === undefined ? {} : { stopLossPct: input.stop_loss_pct }),
        ...(input.take_profit_pct === undefined ? {} : { takeProfitPct: input.take_profit_pct }),
      };
      const result = await runResearchBacktest({
        ...(input.exchange === undefined ? {} : { exchange: input.exchange }),
        symbol: input.symbol,
        timeframe: input.timeframe as Timeframe,
        strategyId: input.strategy_id,
        parameters: input.parameters,
        config,
        ...(input.limit === undefined ? {} : { limit: input.limit }),
        ...(input.start_at === undefined ? {} : { startAt: Date.parse(input.start_at) }),
        ...(input.end_at === undefined ? {} : { endAt: Date.parse(input.end_at) }),
        openInWorkspace: input.open_in_workspace,
      });
      return textResult({ ...summarizeExperiment(result), note: "Full result details are available through get_backtest_result and the local workspace." });
    } catch (error) { return errorResult(error); }
  });

  server.registerTool("run_research_sweep", {
    title: "Run bounded walk-forward strategy sweep",
    description: "Compare up to 40 values of one built-in numeric parameter. Reuse an immutable dataset with dataset_id or fetch a bounded range. Walk-forward ranks candidates by training total return by default; set selection_metric=sharpe_ratio to rank by finite training Sharpe. Optional max_training_drawdown filters training candidates before ranking. Validation and final-test drawdowns are reported, not constrained.",
    inputSchema: z.object({
      exchange: exchangeSchema.optional(),
      dataset_id: z.string().min(1).max(120).optional(),
      symbol: symbolSchema,
      timeframe,
      strategy_id: z.string().min(1).max(120),
      parameters: parametersSchema.default({}),
      parameter: z.string().min(1).max(80),
      from: z.number().finite(),
      to: z.number().finite(),
      step: z.number().positive(),
      limit: z.number().int().min(50).max(1_000).optional(),
      start_at: dateTimeSchema.optional(),
      end_at: dateTimeSchema.optional(),
      mode: z.enum(["full-sample", "walk-forward"]).default("walk-forward"),
      selection_metric: z.enum(["total_return", "sharpe_ratio"]).default("total_return"),
      max_training_drawdown: z.number().finite().min(0).max(1).optional(),
      initial_capital: z.number().positive().max(1_000_000_000),
      position_fraction: z.number().positive().max(1),
      fee_rate: z.number().min(0).max(0.05),
      slippage_rate: z.number().min(0).max(0.05),
      account_mode: z.enum(["spot", "legacy-margin"]).default("spot"),
      allow_shorts: z.boolean().default(false),
      stop_loss_pct: z.number().positive().max(0.99).optional(),
      take_profit_pct: z.number().positive().max(9.99).optional(),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, async (input) => {
    try {
      const config = {
        accountMode: input.account_mode,
        initialCapital: input.initial_capital,
        positionFraction: input.position_fraction,
        feeRate: input.fee_rate,
        slippageRate: input.slippage_rate,
        allowShorts: input.allow_shorts,
        ...(input.stop_loss_pct === undefined ? {} : { stopLossPct: input.stop_loss_pct }),
        ...(input.take_profit_pct === undefined ? {} : { takeProfitPct: input.take_profit_pct }),
      };
      const sweep = await runBacktestSweep({
        ...(input.exchange === undefined ? {} : { exchange: input.exchange }),
        symbol: input.symbol,
        timeframe: input.timeframe as Timeframe,
        strategyId: input.strategy_id,
        parameters: input.parameters,
        config,
        parameter: input.parameter,
        from: input.from,
        to: input.to,
        step: input.step,
        ...(input.limit === undefined ? {} : { limit: input.limit }),
        ...(input.start_at === undefined ? {} : { startAt: Date.parse(input.start_at) }),
        ...(input.end_at === undefined ? {} : { endAt: Date.parse(input.end_at) }),
        ...(input.dataset_id === undefined ? {} : { datasetId: input.dataset_id }),
        ...(input.max_training_drawdown === undefined ? {} : { maxTrainingDrawdown: input.max_training_drawdown }),
        selectionMetric: input.selection_metric === "sharpe_ratio" ? "sharpeRatio" : "totalReturn",
        mode: input.mode,
      });
      return researchResult(summarizeSweep(sweep), "research-sweep", sweep.sweepId, input.dataset_id === undefined ? "public exchange candles" : "saved immutable candle snapshot");
    } catch (error) { return researchError(error); }
  });

  server.registerTool("rerun_backtest", {
    title: "Reproduce a saved backtest",
    description: "Rerun a saved result against its immutable candle snapshot and compare the complete deterministic outcome.",
    inputSchema: z.object({ result_id: z.string().min(1).max(120) }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, async ({ result_id }) => {
    try {
      const result = rerunResearchBacktest(result_id);
      return researchResult({ ...summarizeExperiment(result), note: "rerunOf identifies the saved result that was reproduced." }, "backtest-result", result.resultId, "saved immutable candle snapshot");
    } catch (error) { return researchError(error); }
  });

  server.registerTool("rerun_backtest_sweep", {
    title: "Reproduce a saved parameter sweep",
    description: "Rerun a saved sweep from its immutable dataset and verify the saved results; accepts only a saved sweep ID.",
    inputSchema: z.object({ sweep_id: z.string().min(1).max(120) }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, async ({ sweep_id }) => {
    try {
      const sweep = rerunBacktestSweep(sweep_id);
      return researchResult(summarizeSweep(sweep), "research-sweep", sweep.sweepId, "saved immutable candle snapshot");
    }
    catch (error) { return researchError(error); }
  });

  server.registerTool("get_backtest_result", {
    title: "Get saved backtest result",
    description: "Read a saved experiment's metrics, assumptions and dataset/execution provenance. Trades and the full equity curve are opt-in.",
    inputSchema: z.object({
      result_id: z.string().min(1).max(120),
      trade_limit: z.number().int().min(0).max(200).default(0),
      include_equity_curve: z.boolean().default(false),
    }),
    annotations: { readOnlyHint: true },
  }, async ({ result_id, trade_limit, include_equity_curve }) => {
    try {
      assertResearchAvailable("Saved backtests are hidden during Replay to prevent future-result leakage.");
      const result = getExperiment(result_id);
      return result ? textResult(summarizeExperiment(result, trade_limit, include_equity_curve)) : errorResult(new Error("Backtest result not found."));
    } catch (error) { return errorResult(error); }
  });

  server.registerTool("get_research_sweep", {
    title: "Get saved research sweep",
    description: "Read a saved parameter sweep, its dataset range, fold results, and reproducibility identifiers.",
    inputSchema: z.object({ sweep_id: z.string().min(1).max(120) }),
    annotations: { readOnlyHint: true },
  }, async ({ sweep_id }) => {
    try {
      assertResearchAvailable("Saved sweeps are hidden during Replay to prevent future-result leakage.");
      const sweep = getSavedSweep(sweep_id);
      return sweep ? researchResult(summarizeSweep(sweep), "research-sweep", sweep.sweepId, "saved immutable candle snapshot") : researchError(new Error("Research sweep not found."));
    } catch (error) { return researchError(error); }
  });

  server.registerTool("list_experiments", {
    title: "List local experiments",
    description: "List the most recent backtests saved in local SQLite.",
    inputSchema: z.object({ limit: z.number().int().min(1).max(50).default(20) }),
    annotations: { readOnlyHint: true },
  }, async ({ limit }) => {
    try {
      assertResearchAvailable("Experiment history is hidden during Replay to prevent future-result leakage.");
      return textResult({ items: listExperimentMetadata(limit) });
    }
    catch (error) { return errorResult(error); }
  });

  server.registerTool("open_workspace_view", {
    title: "Open a newBeing workspace view",
    description: "Synchronize the local browser to a research view or saved backtest. This changes only local workspace navigation.",
  inputSchema: z.object({
    /* "backtest" is still accepted so an existing caller does not break; it is
       normalised to "research", which absorbed that workspace. */
    workspace: z.enum(["terminal", "research", "backtest", "replay"]),
    result_id: z.string().min(1).max(120).optional(),
    replay_id: z.string().min(1).max(120).optional(),
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
}, async ({ workspace: requestedWorkspace, result_id, replay_id }) => {
  try {
    const workspace: WorkspaceState["activeWorkspace"] = requestedWorkspace === "backtest" ? "research" : requestedWorkspace;
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
    description: "Calculate a preview for the legacy per-pair Paper wallet only. Shared spot previews are unsupported and rejected. User confirmation in the trusted UI is required; live trading is disabled.",
    inputSchema: z.object({
      symbol: symbolSchema,
      side: z.enum(["buy", "sell"]),
      quantity: z.number().positive().max(1_000_000),
      mode: z.enum(["paper", "live"]).default("paper"),
      account_mode: z.enum(["legacy", "shared-spot"]).default("legacy"),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, async ({ symbol: orderSymbol, side, quantity, mode, account_mode }) => {
    if (account_mode === "shared-spot") return errorResult(new Error("Shared spot previews are unsupported by prepare_order; use the shared spot UI ticket. No legacy wallet was accessed."));
    if (mode === "live") return errorResult(new Error("Live trading is disabled; a real order preview cannot be prepared."));
    try {
      const workspace = getWorkspaceState().state;
      if (workspace.activeWorkspace === "replay") return errorResult(new Error("Normal Paper order previews are disabled during Replay. Use the replay UI ticket, which queues orders for later bars."));
      const summary = await getExchangeAdapter(workspace.exchange).fetchSummary(orderSymbol);
      const price = side === "buy" ? (summary.ask ?? summary.last) : (summary.bid ?? summary.last);
      if (price === null || price <= 0) return errorResult(new Error("No usable public quote is available for a preview."));
      const read = readPaperAccount(workspace.exchange, orderSymbol);
      if (!read.visible || !read.account) return errorResult(new Error("Normal Paper accounts are hidden during Replay."));
      const { accountId, portfolio } = read.account;
      const { notional, fee: estimatedFee } = estimatePaperAmounts(price, quantity, portfolio.feeRate);
      // Validate with the same accounting policy as confirmation, without saving a fill.
      fillPaperOrder({ clientOrderId: "preview-estimate", symbol: orderSymbol, side, quantity, status: "submitted", fillPrice: null, fee: 0, createdAt: new Date().toISOString() }, portfolio, price);
      const now = new Date();
      const preview = {
        id: randomUUID(),
        exchange: workspace.exchange,
        accountId,
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
        accountMode: "legacy",
        preview,
        simulationPrecision: SIMULATION_PRECISION,
        note: "Preview is stored in the local workspace. No order was created or transmitted. Confirm separately in the UI before expiry; the quote may change.",
      });
    } catch (error) { return errorResult(error); }
  });

  return server;
}
