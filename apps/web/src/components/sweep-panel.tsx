"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Play, ScanSearch, TrendingDown, TrendingUp, Check, ArrowRight, Clock3, RefreshCw, RotateCcw } from "lucide-react";
import { EXCHANGE_TIMEFRAMES, STRATEGIES, type BacktestConfig, type ExchangeId, type StrategyParameters, type Timeframe } from "@newbeing/core";
import { Button } from "@/components/ui/button";
import { EXCHANGE_LABELS } from "@/lib/exchanges";
import { useCopy, translate, type CopyTable } from "@/lib/i18n";
import { PARAMETER_LABELS } from "@/lib/strategy-labels";
import { formatPercentChange, formatRate } from "@/lib/price-format";
import { AkSelect, AkInput, AkTag, AkNotice, AkButton } from "@swufefox/ak-ui-react";
import { useWorkspaceStore } from "@/store/workspace";

/** One row of a sweep response. */
interface SweepRunMetrics {
  totalReturn: number;
  maxDrawdown: number;
  sharpeRatio: number | null;
  winRate: number;
  profitFactor: number | null;
  tradeCount: number;
  totalFees: number;
  finalEquity: number;
}
interface SweepRun {
  value: number;
  resultId: string;
  metrics: SweepRunMetrics;
  segment?: { start: number; end: number; datasetId: string };
}

export interface SweepResult {
  sweepId: string;
  mode?: "full-sample" | "walk-forward";
  exchange: ExchangeId;
  symbol: string;
  timeframe: Timeframe;
  strategyId: string;
  strategyVersion: string;
  parameter: string;
  values: number[];
  runs: SweepRun[];
  parameters: StrategyParameters;
  config: BacktestConfig;
  datasetId: string;
  bars: number;
  createdAt?: string;
  walkForward?: {
    mode: "walk-forward";
    boundaries: { train50: number; train60: number; train70: number; train80: number; total: number };
    folds: Array<{ trainEnd: number; validationStart: number; validationEnd: number; trainStartTimestamp: number; trainEndTimestamp: number; validationStartTimestamp: number; validationEndTimestamp: number; candidateValue: number; trainingResultId: string; validationResultId: string; trainingMetrics: SweepRunMetrics; validationMetrics: SweepRunMetrics }>;
    selectionMetric?: "totalReturn" | "sharpeRatio";
    selectionRule: "training-totalReturn-desc/parameter-value-asc" | "training-sharpeRatio-desc/parameter-value-asc";
    selectionConstraints?: { maxTrainingDrawdown: number };
    finalTrainingStartTimestamp: number;
    finalTrainingEndTimestamp: number;
    finalTestStartTimestamp: number;
    finalTestEndTimestamp: number;
    finalCandidateValue: number;
    finalTrainingResultId: string;
    finalTestResultId: string;
    finalTrainingMetrics: SweepRunMetrics;
    finalTestMetrics: SweepRunMetrics;
  };
}

interface SweepPanelProps {
  symbol: string;
  timeframe: Timeframe;
  exchange: ExchangeId;
  strategyId: string;
  parameters: StrategyParameters;
  /** Sent through to the API unchanged; this panel does not read it. */
  config: BacktestConfig;
}

interface SweepCopy {
  /* Errors the panel renders as text. */
  historyLoadFailed: string;
  historyMalformed: string;
  openFailed: string;
  detailMalformed: string;
  rerunFailed: string;
  rerunMalformed: string;
  drawdownInvalid: string;
  sweepFailed: string;
  sweepMalformed: string;
  replayHidden: string;
  /* Strategy parameter names rendered by the axis/parameter selector. */
  parameters: Record<string, string>;
  /* Saved-history summary lines. */
  inSampleSelection: string;
  selectionSharpe: string;
  selectionReturn: string;
  selectionSummary: (metric: string, rule: string, drawdown: string | null) => string;
  modeTokens: Record<"full-sample" | "walk-forward", string>;
  values: (parameter: string, values: string) => string;
  validationFolds: (count: number) => string;
  inSampleOnly: string;
  finalTestSummary: (totalReturn: string, drawdown: string, sharpe: string, trades: number) => string;
  candidateRuns: (count: number) => string;
  refreshingHistory: string;
  loadingDetails: (id: string) => string;
  reproducing: string;
  deterministicRerun: string;
  openSavedSweep: (id: string) => string;
  /* Form. */
  source: string;
  freshSource: string;
  snapshotSource: string;
  snapshotUnavailable: string;
  currentInputs: string;
  paramGroup: string;
  assumptionGroup: string;
  reportInputs: string;
  incompatibleStrategy: string;
  mode: string;
  modeFullSample: string;
  modeWalkForward: string;
  selectionMetricLabel: string;
  trainingTotalReturn: string;
  trainingSharpe: string;
  maxDrawdownLabel: string;
  noLimit: string;
  drawdownHint: string;
  parameter: string;
  from: string;
  to: string;
  step: string;
  sweeping: string;
  runSweep: string;
  nothingToSweepTitle: string;
  nothingToSweepBody: string;
  /* History section. */
  historyLabel: string;
  savedSweeps: string;
  savedSweepsHint: string;
  refresh: string;
  historyLoading: string;
  noSavedSweeps: string;
  /* Notes and walk-forward report. */
  noteWalkForward: string;
  noteFullSample: string;
  resultSummary: (bars: number, values: number, runs: number, dataset: string) => string;
  walkForwardCaveat: string;
  boundaries: (train50: number, train60: number, train70: number, train80: number, total: number) => string;
  selectionLead: (metric: "return" | "sharpe") => string;
  selectionRuleSuffix: string;
  trainingDrawdownLimit: (value: string) => string;
  foldSummary: (fold: { index: number; trainEnd: number; validationStart: number; validationEnd: number; parameter: string; value: number; validationReturn: string }) => string;
  foldBars: (training: string, validation: string) => string;
  foldMetrics: (totalReturn: string, sharpe: string, drawdown: string, trades: number, fees: string) => string;
  foldIds: (training: string, validation: string) => string;
  trainCandidate: string;
  finalTrainCandidate: string;
  returnColumn: string;
  sharpeColumn: string;
  maxDdColumn: string;
  tradesColumn: string;
  feesColumn: string;
  resultColumn: string;
  selectedMark: string;
  notAvailable: string;
  finalTestHeading: (start: number, end: number, range: string) => string;
  finalTestMetrics: (parameter: string, value: number, totalReturn: string, drawdown: string, trades: number, fees: string) => string;
  finalTrainingMetrics: (totalReturn: string, sharpe: string) => string;
  applyFinalCandidate: string;
  finalFitResults: (count: number) => string;
  /* Verdict and caveat. */
  bestValue: string;
  worstValue: string;
  spread: string;
  spreadValue: (value: string) => string;
  profitableRuns: string;
  distinctOutcomes: string;
  collapsedHead: (collapsed: number, total: number) => string;
  collapsedBody: string;
  thinDataset: (trades: number) => string;
  widenRange: string;
  strategyLabUpdated: string;
  appliedNotice: (parameter: string, value: number) => string;
  /* Result table. */
  totalReturnColumn: string;
  winRateColumn: string;
  profitFactorColumn: string;
  finalColumn: string;
  actionColumn: string;
  bestTag: string;
  applied: string;
  apply: string;
  emptyTitle: string;
  emptyBody: string;
}

const SWEEP_COPY: CopyTable<SweepCopy> = {
  en: {
    historyLoadFailed: "Could not load saved sweep history.",
    historyMalformed: "Saved sweep history response was malformed.",
    openFailed: "Could not open saved sweep.",
    detailMalformed: "Saved sweep detail response was malformed.",
    rerunFailed: "Could not rerun saved sweep.",
    rerunMalformed: "Saved sweep rerun response was malformed.",
    drawdownInvalid: "Training max drawdown must be between 0 and 1, or left blank.",
    sweepFailed: "Sweep failed.",
    sweepMalformed: "Sweep response was malformed.",
    replayHidden: "Saved sweep history is hidden during Replay to prevent future-derived results. Leave Replay to access it.",
    parameters: { ...PARAMETER_LABELS.en },
    inSampleSelection: "Full sample · in-sample",
    selectionSharpe: "training Sharpe",
    selectionReturn: "training total return",
    selectionSummary: (metric, rule, drawdown) => `${metric} · ${rule}${drawdown === null ? "" : ` · max training drawdown ${drawdown}`}`,
    modeTokens: { "full-sample": "full-sample", "walk-forward": "walk-forward" },
    values: (parameter, values) => `${parameter} values: ${values}`,
    validationFolds: (count) => `${count} validation folds · `,
    inSampleOnly: "In-sample only · ",
    finalTestSummary: (totalReturn, drawdown, sharpe, trades) => `final test return ${totalReturn}, max drawdown ${drawdown}, Sharpe ${sharpe}, ${trades} trades`,
    candidateRuns: (count) => `${count} full-sample candidate runs`,
    refreshingHistory: "Refreshing saved sweep history…",
    loadingDetails: (id) => `Loading saved sweep details for ${id}…`,
    reproducing: "Reproducing saved sweep from its immutable input…",
    deterministicRerun: "Deterministic rerun",
    openSavedSweep: (id) => `Open saved sweep ${id}`,
    source: "Candle source",
    freshSource: "Fresh market candles",
    snapshotSource: "Loaded backtest snapshot",
    snapshotUnavailable: "The selected backtest snapshot changed or is unavailable. Select a source before running.",
    currentInputs: "Current strategy and config",
    paramGroup: "params",
    assumptionGroup: "assumptions",
    reportInputs: "Report strategy and config",
    incompatibleStrategy: "Select the report's strategy and version before applying a candidate.",
    mode: "MODE",
    modeFullSample: "Full sample · in-sample",
    modeWalkForward: "Walk-forward",
    selectionMetricLabel: "SELECTION METRIC",
    trainingTotalReturn: "Training total return",
    trainingSharpe: "Training Sharpe",
    maxDrawdownLabel: "MAX TRAINING DRAWDOWN",
    noLimit: "No limit",
    drawdownHint: "Optional fraction from 0 to 1; filters training candidates before ranking.",
    parameter: "PARAMETER",
    from: "FROM",
    to: "TO",
    step: "STEP",
    sweeping: "Sweeping",
    runSweep: "Run sweep",
    nothingToSweepTitle: "Nothing to sweep",
    nothingToSweepBody: "This strategy has no numeric parameter to vary.",
    historyLabel: "Saved sweep history",
    savedSweeps: "Saved sweeps",
    savedSweepsHint: "Open a saved report or rerun its original inputs from the local candle snapshot.",
    refresh: "Refresh",
    historyLoading: "Loading saved sweep history…",
    noSavedSweeps: "No saved sweeps yet. Run a sweep to create the first record.",
    noteWalkForward: "Walk-forward selects on each expanding training prefix, then evaluates the next interval. The final 20% is reserved for one final test.",
    noteFullSample: "Full-sample results are in-sample and do not measure out-of-sample performance.",
    resultSummary: (bars, values, runs, dataset) => ` · ${bars} bars · ${values} candidate values · ${runs} backtest runs · dataset ${dataset}…`,
    walkForwardCaveat: "Training prefixes expand from the start. Each segment cold-starts. These are historical observations, not independent statistical evidence or a future-performance guarantee. After viewing the final test, retuning against it means it is no longer untouched.",
    boundaries: (train50, train60, train70, train80, total) => `Bar boundaries: 0 / ${train50} / ${train60} / ${train70} / ${train80} / ${total}`,
    selectionLead: (metric) => `Selection: highest training ${metric === "sharpe" ? "Sharpe ratio; candidates without a finite Sharpe are ineligible" : "total return"}; ties choose the lowest parameter value. Rule: `,
    selectionRuleSuffix: ".",
    trainingDrawdownLimit: (value) => ` Training max drawdown ≤ ${value}; this limit filters training candidates only.`,
    foldSummary: (fold) => `Fold ${fold.index} · train [0, ${fold.trainEnd}) · validation [${fold.validationStart}, ${fold.validationEnd}) · chosen ${fold.parameter}=${fold.value} · validation ${fold.validationReturn}`,
    foldBars: (training, validation) => `Training bars: ${training}. Validation bars: ${validation}.`,
    foldMetrics: (totalReturn, sharpe, drawdown, trades, fees) => `Selected training return ${totalReturn}, Sharpe ${sharpe}; validation max drawdown ${drawdown}, ${trades} trades, fees ${fees}.`,
    foldIds: (training, validation) => `Selected training ${training} → validation ${validation}`,
    trainCandidate: "TRAIN CANDIDATE",
    finalTrainCandidate: "FINAL TRAIN CANDIDATE",
    returnColumn: "RETURN",
    sharpeColumn: "SHARPE",
    maxDdColumn: "MAX DD",
    tradesColumn: "TRADES",
    feesColumn: "FEES",
    resultColumn: "RESULT",
    selectedMark: " · selected",
    notAvailable: "n/a",
    finalTestHeading: (start, end, range) => `Final test [${start}, ${end}) · ${range}`,
    finalTestMetrics: (parameter, value, totalReturn, drawdown, trades, fees) => `${parameter}=${value}; return ${totalReturn}, max drawdown ${drawdown}, ${trades} trades, fees ${fees}.`,
    finalTrainingMetrics: (totalReturn, sharpe) => `Selected training metrics: total return ${totalReturn}, Sharpe ${sharpe}.`,
    applyFinalCandidate: "Apply final candidate",
    finalFitResults: (count) => `Final fit candidate results (${count})`,
    bestValue: "BEST VALUE",
    worstValue: "WORST VALUE",
    spread: "SPREAD",
    spreadValue: (value) => `${value} pts`,
    profitableRuns: "PROFITABLE RUNS",
    distinctOutcomes: "DISTINCT OUTCOMES",
    collapsedHead: (collapsed, total) => `${collapsed} of ${total} values produced an identical result`,
    collapsedBody: " and are not independent evidence.",
    thinDataset: (trades) => ` This dataset yields as little as ${trades} trade, so most values never differed. Use longer history or shorter timeframe.`,
    widenRange: " Widen range or step so each value is exercised differently.",
    strategyLabUpdated: "Strategy Lab updated",
    appliedNotice: (parameter, value) => `Applied ${parameter} = ${value} to strategy`,
    totalReturnColumn: "TOTAL RETURN",
    winRateColumn: "WIN RATE",
    profitFactorColumn: "PF",
    finalColumn: "FINAL",
    actionColumn: "ACTION",
    bestTag: "BEST",
    applied: "Applied",
    apply: "Apply",
    emptyTitle: "Vary one parameter across a range",
    emptyBody: "Picking parameters by intuition is guesswork. This runs the strategy at every value on the same historical candles so you can see which ones held up.",
  },
  zh: {
    historyLoadFailed: "无法加载已保存的参数扫描。",
    historyMalformed: "已保存的参数扫描响应格式错误。",
    openFailed: "无法打开已保存的参数扫描。",
    detailMalformed: "已保存的参数扫描详情格式错误。",
    rerunFailed: "无法重跑已保存的参数扫描。",
    rerunMalformed: "已保存的参数扫描重跑响应格式错误。",
    drawdownInvalid: "训练期最大回撤必须介于 0 与 1 之间，或留空。",
    sweepFailed: "参数扫描失败。",
    sweepMalformed: "参数扫描响应格式错误。",
    replayHidden: "回放期间会隐藏已保存的参数扫描，以免用到未来数据。退出回放后即可访问。",
    parameters: { ...PARAMETER_LABELS.zh },
    inSampleSelection: "全样本 · 样本内",
    selectionSharpe: "训练期夏普比率",
    selectionReturn: "训练期总收益",
    selectionSummary: (metric, rule, drawdown) => `${metric} · ${rule}${drawdown === null ? "" : ` · 训练期最大回撤 ${drawdown}`}`,
    modeTokens: { "full-sample": "全样本", "walk-forward": "滚动验证" },
    values: (parameter, values) => `${parameter} 取值：${values}`,
    validationFolds: (count) => `${count} 折验证 · `,
    inSampleOnly: "仅样本内 · ",
    finalTestSummary: (totalReturn, drawdown, sharpe, trades) => `最终测试收益 ${totalReturn}，最大回撤 ${drawdown}，夏普比率 ${sharpe}，交易数 ${trades}`,
    candidateRuns: (count) => `${count} 个全样本候选运行`,
    refreshingHistory: "正在刷新已保存的参数扫描…",
    loadingDetails: (id) => `正在加载 ${id} 的扫描详情…`,
    reproducing: "正在用不可变输入复现已保存的参数扫描…",
    deterministicRerun: "确定性重跑",
    openSavedSweep: (id) => `打开已保存的参数扫描 ${id}`,
    source: "K 线来源",
    freshSource: "最新市场 K 线",
    snapshotSource: "已加载回测快照",
    snapshotUnavailable: "所选回测快照已更改或不可用。请重新选择数据来源后再运行。",
    currentInputs: "当前策略和配置",
    paramGroup: "参数",
    assumptionGroup: "假设",
    reportInputs: "报告策略和配置",
    incompatibleStrategy: "请先选择与报告相同的策略及版本，再应用候选参数。",
    mode: "模式",
    modeFullSample: "全样本 · 样本内",
    modeWalkForward: "滚动验证",
    selectionMetricLabel: "选择指标",
    trainingTotalReturn: "训练期总收益",
    trainingSharpe: "训练期夏普比率",
    maxDrawdownLabel: "训练期最大回撤",
    noLimit: "不设限",
    drawdownHint: "可选比例，取值 0 到 1；用于在排序前筛选训练期候选。",
    parameter: "参数",
    from: "起始",
    to: "结束",
    step: "步长",
    sweeping: "扫描中",
    runSweep: "开始扫描",
    nothingToSweepTitle: "无可扫描参数",
    nothingToSweepBody: "该策略没有可变的数值参数。",
    historyLabel: "已保存的参数扫描",
    savedSweeps: "已保存扫描",
    savedSweepsHint: "打开已保存的报告，或从本机 K 线快照按其原始输入重跑。",
    refresh: "刷新",
    historyLoading: "正在加载已保存的参数扫描…",
    noSavedSweeps: "暂无已保存的扫描。运行一次扫描即可生成第一条记录。",
    noteWalkForward: "滚动验证在每个不断扩展的训练前缀上选择参数，再评估下一段区间。最后 20% 保留给一次最终测试。",
    noteFullSample: "全样本结果属于样本内，无法衡量样本外表现。",
    resultSummary: (bars, values, runs, dataset) => ` · ${bars} 根 K 线 · ${values} 个候选值 · ${runs} 次回测 · 数据集 ${dataset}…`,
    walkForwardCaveat: "训练前缀自起点不断扩展，每段都冷启动。这些是历史观察结果，既非独立统计证据，也不保证未来表现。查看最终测试后再据此调参，它便不再保持未被触碰。",
    boundaries: (train50, train60, train70, train80, total) => `K 线边界：0 / ${train50} / ${train60} / ${train70} / ${train80} / ${total}`,
    selectionLead: (metric) => `选择：训练期${metric === "sharpe" ? "夏普比率最高（未给出有限夏普比率的候选不参与）" : "总收益最高"}；并列时取参数值最小者。规则：`,
    selectionRuleSuffix: "。",
    trainingDrawdownLimit: (value) => ` 训练期最大回撤 ≤ ${value}；该限制仅用于筛选训练期候选。`,
    foldSummary: (fold) => `第 ${fold.index} 折 · 训练 [0, ${fold.trainEnd}) · 验证 [${fold.validationStart}, ${fold.validationEnd}) · 选中 ${fold.parameter}=${fold.value} · 验证 ${fold.validationReturn}`,
    foldBars: (training, validation) => `训练 K 线：${training}。验证 K 线：${validation}。`,
    foldMetrics: (totalReturn, sharpe, drawdown, trades, fees) => `选中参数训练期收益 ${totalReturn}，夏普比率 ${sharpe}；验证期最大回撤 ${drawdown}，交易数 ${trades}，手续费 ${fees}。`,
    foldIds: (training, validation) => `选中的训练结果 ${training} → 验证结果 ${validation}`,
    trainCandidate: "训练候选",
    finalTrainCandidate: "最终训练候选",
    returnColumn: "收益",
    sharpeColumn: "夏普",
    maxDdColumn: "最大回撤",
    tradesColumn: "交易数",
    feesColumn: "手续费",
    resultColumn: "结果",
    selectedMark: " · 已选中",
    notAvailable: "无",
    finalTestHeading: (start, end, range) => `最终测试 [${start}, ${end}) · ${range}`,
    finalTestMetrics: (parameter, value, totalReturn, drawdown, trades, fees) => `${parameter}=${value}；收益 ${totalReturn}，最大回撤 ${drawdown}，交易数 ${trades}，手续费 ${fees}。`,
    finalTrainingMetrics: (totalReturn, sharpe) => `选中参数训练期指标：总收益 ${totalReturn}，夏普比率 ${sharpe}。`,
    applyFinalCandidate: "应用最终候选",
    finalFitResults: (count) => `最终拟合候选结果（${count}）`,
    bestValue: "最优取值",
    worstValue: "最差取值",
    spread: "极差",
    spreadValue: (value) => `${value} 个百分点`,
    profitableRuns: "盈利运行",
    distinctOutcomes: "不同结果",
    collapsedHead: (collapsed, total) => `${total} 个取值中有 ${collapsed} 个得到完全相同的结果`,
    collapsedBody: "，不构成独立证据。",
    thinDataset: (trades) => ` 该数据集最少只产生 ${trades} 笔交易，多数取值因此从未出现差异。请使用更长的历史或更短的周期。`,
    widenRange: " 请扩大范围或调整步长，让每个取值得到不同的检验。",
    strategyLabUpdated: "策略实验室已更新",
    appliedNotice: (parameter, value) => `已将 ${parameter} = ${value} 应用到策略`,
    totalReturnColumn: "总收益",
    winRateColumn: "胜率",
    profitFactorColumn: "盈亏比",
    finalColumn: "最终权益",
    actionColumn: "操作",
    bestTag: "最优",
    applied: "已应用",
    apply: "应用",
    emptyTitle: "在一个区间内遍历单个参数",
    emptyBody: "凭直觉挑参数只是猜测。这里在同一批历史 K 线上遍历每个取值，让你看清哪些真正站得住。",
  },
};

/** Numeric parameters only: sweeping a boolean has exactly two outcomes and is
 *  better expressed as two runs than as a sweep. */
function sweepableKeys(parameters: StrategyParameters): string[] {
  return Object.entries(parameters)
    .filter(([, value]) => typeof value === "number")
    .map(([key]) => key);
}

function label(key: string): string {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (first) => first.toUpperCase());
}

/** Parameter names come from strategy ids; the table translates the ones that
 *  front the axis selector and falls back to the derived name for the rest. */
function parameterName(key: string, copy: SweepCopy): string {
  return copy.parameters[key] ?? label(key);
}

function timeRange(start: number, end: number): string {
  return `${new Date(start).toLocaleString()} – ${new Date(end).toLocaleString()}`;
}

/** A reader scans labelled inputs, not JSON punctuation: `allowShorts: on`
 *  rather than `"allowShorts":true`. */
function inputPairs(values: object): string {
  return Object.entries(values)
    .map(([key, value]) => `${key}: ${typeof value === "boolean" ? (value ? "on" : "off") : String(value)}`)
    .join(" · ");
}

function isSweepResult(payload: unknown): payload is SweepResult {
  return typeof payload === "object" && payload !== null && "sweepId" in payload && typeof payload.sweepId === "string" && "runs" in payload && Array.isArray(payload.runs);
}

async function sweepResponseFailure(response: Response, fallback: string): Promise<Error> {
  let payload: unknown;
  try { payload = await response.json(); } catch { payload = null; }
  const message = typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error === "string" ? payload.error : fallback;
  return response.status === 409 && /replay/i.test(message)
    ? new Error(translate(SWEEP_COPY).replayHidden)
    : new Error(message);
}

function sweepHistorySelection(sweep: SweepResult, copy: SweepCopy): string {
  if (!sweep.walkForward) return copy.inSampleSelection;
  const metric = sweep.walkForward.selectionMetric === "sharpeRatio" ? copy.selectionSharpe : copy.selectionReturn;
  const drawdown = sweep.walkForward.selectionConstraints?.maxTrainingDrawdown;
  return copy.selectionSummary(metric, sweep.walkForward.selectionRule, drawdown === undefined ? null : formatPercentChange(drawdown));
}
export function SweepPanel({ symbol, timeframe, exchange, strategyId, parameters, config }: SweepPanelProps): React.JSX.Element {
  const copy = useCopy(SWEEP_COPY);
  const strategy = STRATEGIES.find((item) => item.id === strategyId) ?? STRATEGIES[0];
  const keys = useMemo(() => sweepableKeys(strategy?.defaults ?? {}), [strategy]);
  const backtest = useWorkspaceStore((state) => state.backtest);
  const [snapshotSelection, setSnapshotSelection] = useState<string | null>(null);
  const usableBacktest = backtest && /^sha256:[a-f0-9]{64}$/.test(backtest.datasetId)
    && Object.hasOwn(EXCHANGE_TIMEFRAMES, backtest.exchange) && EXCHANGE_TIMEFRAMES[backtest.exchange].includes(backtest.timeframe)
    && /^[A-Z0-9]{2,20}\/[A-Z0-9]{2,20}$/.test(backtest.symbol) ? backtest : null;
  const snapshot = usableBacktest && snapshotSelection === usableBacktest.resultId ? usableBacktest : null;
  const snapshotUnavailable = snapshotSelection !== null && snapshot === null;

  const [parameter, setParameter] = useState<string>(keys[0] ?? "");
  const [from, setFrom] = useState("5");
  const [to, setTo] = useState("30");
  const [step, setStep] = useState("5");
  const [mode, setMode] = useState<"full-sample" | "walk-forward">("full-sample");
  const [selectionMetric, setSelectionMetric] = useState<"totalReturn" | "sharpeRatio">("totalReturn");
  const [maxTrainingDrawdown, setMaxTrainingDrawdown] = useState("");

  const [result, setResult] = useState<SweepResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sweepErrorRef = useRef<HTMLDivElement | null>(null);
  const sweepVerdictRef = useRef<HTMLDivElement | null>(null);
  const [running, setRunning] = useState(false);
  const [applied, setApplied] = useState<{ sweepId: string; value: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [savedSweeps, setSavedSweeps] = useState<SweepResult[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyActionError, setHistoryActionError] = useState<string | null>(null);
  const [selectedSweepId, setSelectedSweepId] = useState<string | null>(null);
  const [loadingSweepId, setLoadingSweepId] = useState<string | null>(null);
  const [rerunningSaved, setRerunningSaved] = useState(false);
  const historyLive = useRef(false);
  const historyRequest = useRef(0);
  const historySelectionRequest = useRef(0);
  const historyOpenRequest = useRef<AbortController | null>(null);

  const loadHistory = useCallback(async (): Promise<void> => {
    const requestId = ++historyRequest.current;
    setHistoryLoading(true);
    try {
      const response = await fetch("/api/sweeps?limit=20", { cache: "no-store" });
      if (!response.ok) throw await sweepResponseFailure(response, copy.historyLoadFailed);
      const payload: unknown = await response.json();
      if (typeof payload !== "object" || payload === null || !("items" in payload) || !Array.isArray(payload.items) || !payload.items.every(isSweepResult)) {
        throw new Error(copy.historyMalformed);
      }
      if (!historyLive.current || requestId !== historyRequest.current) return;
      setSavedSweeps(payload.items);
      setHistoryError(null);
    } catch (reason) {
      if (!historyLive.current || requestId !== historyRequest.current) return;
      setHistoryError(reason instanceof Error ? reason.message : copy.historyLoadFailed);
    } finally {
      if (historyLive.current && requestId === historyRequest.current) setHistoryLoading(false);
    }
  }, [copy.historyLoadFailed, copy.historyMalformed]);

  useEffect(() => {
    historyLive.current = true;
    const timer = window.setTimeout(() => { void loadHistory(); }, 0);
    return () => {
      window.clearTimeout(timer);
      historyLive.current = false;
      historyRequest.current += 1;
      historySelectionRequest.current += 1;
      historyOpenRequest.current?.abort();
      historyOpenRequest.current = null;
    };
  }, [loadHistory]);

  const openSavedSweep = async (id: string): Promise<void> => {
    const requestId = ++historySelectionRequest.current;
    historyOpenRequest.current?.abort();
    const controller = new AbortController();
    historyOpenRequest.current = controller;
    setHistoryActionError(null);
    setLoadingSweepId(id);
    try {
      const response = await fetch(`/api/sweeps/${encodeURIComponent(id)}`, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw await sweepResponseFailure(response, copy.openFailed);
      const payload: unknown = await response.json();
      if (!isSweepResult(payload)) throw new Error(copy.detailMalformed);
      if (!historyLive.current || controller.signal.aborted || requestId !== historySelectionRequest.current) return;
      setSelectedSweepId(id);
      setResult(payload);
      setError(null);
    } catch (reason) {
      if (!controller.signal.aborted && historyLive.current && requestId === historySelectionRequest.current) {
        setHistoryActionError(reason instanceof Error ? reason.message : copy.openFailed);
      }
    } finally {
      if (historyOpenRequest.current === controller) {
        historyOpenRequest.current = null;
        setLoadingSweepId(null);
      }
    }
  };

  const rerunSavedSweep = async (): Promise<void> => {
    if (!selectedSweepId || rerunningSaved) return;
    const id = selectedSweepId;
    const requestId = ++historySelectionRequest.current;
    historyOpenRequest.current?.abort();
    setLoadingSweepId(null);
    historyOpenRequest.current = null;
    setRerunningSaved(true);
    setHistoryActionError(null);
    try {
      const response = await fetch(`/api/sweeps/${encodeURIComponent(id)}/rerun`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", cache: "no-store" });
      if (!response.ok) throw await sweepResponseFailure(response, copy.rerunFailed);
      const payload: unknown = await response.json();
      if (!isSweepResult(payload)) throw new Error(copy.rerunMalformed);
      await loadHistory();
      if (!historyLive.current || requestId !== historySelectionRequest.current) return;
      setResult(payload);
      setSelectedSweepId(payload.sweepId);
      setError(null);
      await openSavedSweep(payload.sweepId);
    } catch (reason) {
      if (historyLive.current && requestId === historySelectionRequest.current) {
        setHistoryActionError(reason instanceof Error ? reason.message : copy.rerunFailed);
      }
    } finally {
      if (historyLive.current) setRerunningSaved(false);
    }
  };

  const activeKey = keys.includes(parameter) ? parameter : (keys[0] ?? "");
  const walkForwardReport = result?.walkForward;
  const showWalkForward = result ? Boolean(walkForwardReport) : mode === "walk-forward";
  const canApply = Boolean(result && result.strategyId === strategyId && result.strategyVersion === strategy?.version && keys.includes(result.parameter));

  /* A failed run used to leave its only message below the fold. Reveal it so
     the button that started the sweep always reports the outcome. */
  useEffect(() => {
    if (!error) return;
    sweepErrorRef.current?.scrollIntoView({ block: "nearest" });
  }, [error]);

  const run = async (): Promise<void> => {
    if (snapshotUnavailable) {
      setError(copy.snapshotUnavailable);
      return;
    }
    const maxTrainingDrawdownValue = maxTrainingDrawdown.trim() === "" ? undefined : Number(maxTrainingDrawdown);
    if (mode === "walk-forward" && maxTrainingDrawdownValue !== undefined &&
        (!Number.isFinite(maxTrainingDrawdownValue) || maxTrainingDrawdownValue < 0 || maxTrainingDrawdownValue > 1)) {
      setError(copy.drawdownInvalid);
      return;
    }
    const requestId = ++historySelectionRequest.current;
    historyOpenRequest.current?.abort();
    historyOpenRequest.current = null;
    setLoadingSweepId(null);
    setSelectedSweepId(null);
    setHistoryActionError(null);
    setRunning(true);
    setError(null);
    try {
      const response = await fetch("/api/sweeps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exchange: snapshot?.exchange ?? exchange,
          symbol: snapshot?.symbol ?? symbol,
          timeframe: snapshot?.timeframe ?? timeframe,
          strategyId,
          parameters,
          config,
          parameter: activeKey,
          from: Number(from),
          to: Number(to),
          step: Number(step),
          mode,
          ...(mode === "walk-forward" ? {
            selectionMetric,
            ...(maxTrainingDrawdownValue === undefined ? {} : { maxTrainingDrawdown: maxTrainingDrawdownValue }),
          } : {}),
          ...(snapshot ? { datasetId: snapshot.datasetId } : { limit: 600 }),
        }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const message = typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error === "string"
          ? payload.error : copy.sweepFailed;
        throw new Error(message);
      }
      if (!isSweepResult(payload)) throw new Error(copy.sweepMalformed);
      if (!historyLive.current || requestId !== historySelectionRequest.current) return;
      setResult(payload);
      void loadHistory();
    } catch (reason) {
      if (!historyLive.current || requestId !== historySelectionRequest.current) return;
      setResult(null);
      setError(reason instanceof Error ? reason.message : copy.sweepFailed);
    } finally {
      setRunning(false);
    }
  };

  const applyParameter = (val: number): void => {
    const current = useWorkspaceStore.getState();
    const currentStrategy = STRATEGIES.find((item) => item.id === current.selectedStrategyId);
    if (!result || current.selectedStrategyId !== result.strategyId || currentStrategy?.version !== result.strategyVersion || typeof currentStrategy.defaults[result.parameter] !== "number") return;
    current.setStrategyParameters({ ...current.strategyParameters, [result.parameter]: val });
    setApplied({ sweepId: result.sweepId, value: val });
    setNotice(copy.appliedNotice(parameterName(result.parameter, copy), val));
    window.setTimeout(() => {
      setApplied(null);
      setNotice(null);
    }, 2200);
  };

  const stats = useMemo(() => {
    if (!result || result.walkForward || result.runs.length === 0) return null;
    const returns = result.runs.map((r) => r.metrics.totalReturn);
    const best = result.runs.reduce((a, b) => (b.metrics.totalReturn > a.metrics.totalReturn ? b : a));
    const worst = result.runs.reduce((a, b) => (b.metrics.totalReturn < a.metrics.totalReturn ? b : a));
    const profitable = result.runs.filter((r) => r.metrics.totalReturn > 0).length;

    const byOutcome = new Map<string, number[]>();
    for (const run of result.runs) {
      const key = `${run.metrics.finalEquity.toFixed(6)}|${run.metrics.tradeCount}`;
      const list = byOutcome.get(key);
      if (list) list.push(run.value);
      else byOutcome.set(key, [run.value]);
    }
    const distinct = byOutcome.size;
    const collapsed = result.runs.length - distinct;
    const thinnest = Math.min(...result.runs.map((r) => r.metrics.tradeCount));

    return { best, worst, profitable, total: result.runs.length, spread: Math.max(...returns) - Math.min(...returns), distinct, collapsed, thinnest };
  }, [result]);

  /* A finished sweep used to leave its verdict below the dock viewport. Reveal
     the summary when a run or a saved sweep loads. */
  useEffect(() => {
    if (!result || !stats) return;
    sweepVerdictRef.current?.scrollIntoView({ block: "center" });
  }, [result, stats]);

  if (keys.length === 0) {
    return <div className="empty-state p-6 text-center text-xs text-[var(--ak-text-secondary)]"><ScanSearch size={22} className="mx-auto mb-2 text-[var(--ak-signal-info)]" /><strong>{copy.nothingToSweepTitle}</strong><span>{copy.nothingToSweepBody}</span></div>;
  }

  return (
    <div className="sweep-panel flex flex-col gap-3 p-3 bg-[var(--ak-surface-canvas)]">
      <div className="sweep-form flex flex-wrap items-end gap-2.5 p-2.5 bg-[var(--ak-surface-sunken)] border border-[var(--ak-border-subtle)]">
        <label className="sweep-field flex flex-col gap-1">
          <span className="text-[10px] font-bold text-[var(--ak-text-secondary)]">{copy.source}</span>
          <AkSelect className="select-input h-7 text-xs font-bold" value={snapshotUnavailable ? "" : snapshot ? "snapshot" : "fresh"} onChange={(event) => setSnapshotSelection(event.target.value === "snapshot" && usableBacktest ? usableBacktest.resultId : null)}>
            {snapshotUnavailable && <option value="" disabled>{copy.snapshotUnavailable}</option>}
            <option value="fresh">{copy.freshSource}</option>
            {usableBacktest && <option value="snapshot">{copy.snapshotSource}</option>}
          </AkSelect>
        </label>
        {snapshotUnavailable
          ? <p className="sweep-form-note text-[10px] text-[var(--ak-signal-action)]" role="status">{copy.snapshotUnavailable}</p>
          : <p className="sweep-form-note break-all text-[10px] text-[var(--ak-text-secondary)]">{snapshot ? `${EXCHANGE_LABELS[snapshot.exchange]} · ${snapshot.symbol} · ${snapshot.timeframe} · ${snapshot.datasetId}` : `${EXCHANGE_LABELS[exchange]} · ${symbol} · ${timeframe}`}</p>}
        <p className="sweep-form-note break-words text-[10px] text-[var(--ak-text-secondary)]">{copy.currentInputs}: {strategyId} · {copy.paramGroup}: {inputPairs(parameters)} · {copy.assumptionGroup}: {inputPairs(config)}</p>
        <label className="sweep-field flex flex-col gap-1">
          <span className="text-[10px] font-bold text-[var(--ak-text-secondary)] uppercase font-mono">{copy.mode}</span>
          <AkSelect className="select-input h-7 text-xs font-bold" value={mode} onChange={(event) => setMode(event.target.value as "full-sample" | "walk-forward")}>
            <option value="full-sample">{copy.modeFullSample}</option>
            <option value="walk-forward">{copy.modeWalkForward}</option>
          </AkSelect>
        </label>
        {mode === "walk-forward" && (
          <>
            <label className="sweep-field flex flex-col gap-1">
              <span className="text-[10px] font-bold text-[var(--ak-text-secondary)] uppercase font-mono">{copy.selectionMetricLabel}</span>
              <AkSelect className="select-input h-7 text-xs font-bold" value={selectionMetric} onChange={(event) => setSelectionMetric(event.target.value as "totalReturn" | "sharpeRatio")}>
                <option value="totalReturn">{copy.trainingTotalReturn}</option>
                <option value="sharpeRatio">{copy.trainingSharpe}</option>
              </AkSelect>
            </label>
            <label className="sweep-field flex flex-col gap-1">
              <span className="text-[10px] font-bold text-[var(--ak-text-secondary)] uppercase font-mono">{copy.maxDrawdownLabel}</span>
              <AkInput className="compact-input w-28 h-7 text-xs font-mono" type="number" min={0} max={1} step={0.01} placeholder={copy.noLimit} value={maxTrainingDrawdown} onChange={(event) => setMaxTrainingDrawdown(event.target.value)} />
            </label>
            <span className="sweep-form-note text-[10px] text-[var(--ak-text-secondary)]">{copy.drawdownHint}</span>
          </>
        )}
        <label className="sweep-field flex flex-col gap-1">
          <span className="text-[10px] font-bold text-[var(--ak-text-secondary)] uppercase font-mono">{copy.parameter}</span>
          <AkSelect className="select-input h-7 text-xs font-bold" value={activeKey} onChange={(event) => setParameter(event.target.value)}>
            {keys.map((key) => <option key={key} value={key}>{parameterName(key, copy)}</option>)}
          </AkSelect>
        </label>
        <label className="sweep-field flex flex-col gap-1">
          <span className="text-[10px] font-bold text-[var(--ak-text-secondary)] uppercase font-mono">{copy.from}</span>
          <AkInput className="compact-input w-20 h-7 text-xs font-mono" type="number" value={from} onChange={(event) => setFrom(event.target.value)} />
        </label>
        <label className="sweep-field flex flex-col gap-1">
          <span className="text-[10px] font-bold text-[var(--ak-text-secondary)] uppercase font-mono">{copy.to}</span>
          <AkInput className="compact-input w-20 h-7 text-xs font-mono" type="number" value={to} onChange={(event) => setTo(event.target.value)} />
        </label>
        <label className="sweep-field flex flex-col gap-1">
          <span className="text-[10px] font-bold text-[var(--ak-text-secondary)] uppercase font-mono">{copy.step}</span>
          <AkInput className="compact-input w-20 h-7 text-xs font-mono" type="number" min={1} value={step} onChange={(event) => setStep(event.target.value)} />
        </label>
        <Button
          variant="primary"
          size="sm"
          data-testid="run-sweep"
          onClick={() => void run()}
          disabled={running || snapshotUnavailable}
          icon={running ? <Play size={13} className="spin" /> : <ScanSearch size={13} />}
          className="h-7 text-xs font-bold"
        >
          {running ? copy.sweeping : copy.runSweep}
        </Button>
      </div>

      <section aria-label={copy.historyLabel} className="space-y-2 rounded border border-[var(--ak-border-subtle)] bg-[var(--ak-surface-sunken)] p-2 text-xs">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="m-0 text-[11px] font-bold uppercase tracking-wide">{copy.savedSweeps}</h2>
            <p className="m-0 text-[10px] text-[var(--ak-text-secondary)]">{copy.savedSweepsHint}</p>
          </div>
          <Button type="button" size="sm" variant="outline" className="h-7 text-[10px]" disabled={historyLoading} onClick={() => void loadHistory()} icon={<RefreshCw size={11} className={historyLoading ? "spin" : ""} />}>
            {copy.refresh}
          </Button>
        </div>
        {historyLoading && savedSweeps.length === 0 && <p className="m-0" role="status">{copy.historyLoading}</p>}
        {historyError && <p className="m-0 text-[var(--ak-signal-danger)]" role="alert">{historyError}</p>}
        {!historyLoading && !historyError && savedSweeps.length === 0 && <p className="m-0 text-[var(--ak-text-secondary)]">{copy.noSavedSweeps}</p>}
        {savedSweeps.length > 0 && (
          <div className="max-h-48 space-y-1 overflow-auto">
            {savedSweeps.map((sweep) => {
              const report = sweep.walkForward;
              const finalTest = report?.finalTestMetrics;
              return <button
                key={sweep.sweepId}
                type="button"
                aria-pressed={selectedSweepId === sweep.sweepId}
                aria-label={copy.openSavedSweep(sweep.sweepId)}
                onClick={() => void openSavedSweep(sweep.sweepId)}
                className={`flex w-full flex-col gap-0.5 rounded border p-1.5 text-left ${selectedSweepId === sweep.sweepId ? "border-[var(--ak-signal-info)] bg-[var(--ak-surface-raised)]" : "border-[var(--ak-border-subtle)] hover:bg-[var(--ak-surface-raised)]"}`}
              >
                <span className="font-semibold">{EXCHANGE_LABELS[sweep.exchange]} · {sweep.symbol} · {sweep.timeframe} · {copy.modeTokens[sweep.mode ?? (report ? "walk-forward" : "full-sample")]}</span>
                <span className="text-[var(--ak-text-secondary)]">{copy.values(parameterName(sweep.parameter, copy), sweep.values.join(", "))}</span>
                <span className="text-[var(--ak-text-secondary)]">{sweepHistorySelection(sweep, copy)}</span>
                <span className="text-[var(--ak-text-secondary)]">
                  {report ? copy.validationFolds(report.folds.length) : copy.inSampleOnly}
                  {finalTest ? copy.finalTestSummary(formatPercentChange(finalTest.totalReturn), formatPercentChange(-finalTest.maxDrawdown), finalTest.sharpeRatio === null ? copy.notAvailable : finalTest.sharpeRatio.toFixed(3), finalTest.tradeCount) : copy.candidateRuns(sweep.runs.length)}
                  {sweep.createdAt && ` · ${new Date(sweep.createdAt).toLocaleString()}`}
                </span>
                <span className="break-all font-mono text-[10px] text-[var(--ak-text-secondary)]">{sweep.sweepId}</span>
              </button>;
            })}
          </div>
        )}
        {historyLoading && savedSweeps.length > 0 && <p className="m-0 text-[var(--ak-text-secondary)]" role="status">{copy.refreshingHistory}</p>}
        {loadingSweepId && <p className="m-0 text-[var(--ak-text-secondary)]" role="status">{copy.loadingDetails(loadingSweepId)}</p>}
        {historyActionError && <p className="m-0 text-[var(--ak-signal-danger)]" role="alert">{historyActionError}</p>}
        {selectedSweepId && (
          <div className="flex flex-wrap items-center gap-2 border-t border-[var(--ak-border-subtle)] pt-2">
            {rerunningSaved && <span role="status">{copy.reproducing}</span>}
            <Button type="button" size="sm" variant="outline" className="h-7 text-[10px]" disabled={rerunningSaved || loadingSweepId !== null} onClick={() => void rerunSavedSweep()} icon={<RotateCcw size={11} className={rerunningSaved ? "spin" : ""} />}>
              {copy.deterministicRerun}
            </Button>
          </div>
        )}
      </section>

      <p className="sweep-note text-[10px] text-[var(--ak-text-secondary)] font-mono m-0 opacity-80">
        {showWalkForward
          ? copy.noteWalkForward
          : copy.noteFullSample}
        {` ${EXCHANGE_LABELS[result?.exchange ?? snapshot?.exchange ?? exchange]} · ${result?.symbol ?? snapshot?.symbol ?? symbol} · ${result?.timeframe ?? snapshot?.timeframe ?? timeframe}`}
        {result && copy.resultSummary(result.bars, result.values.length, result.runs.length, result.datasetId.slice(0, 24))}
      </p>
      {result && <p className="m-0 break-words text-[10px] text-[var(--ak-text-secondary)]">{copy.reportInputs}: {result.strategyId} ({result.strategyVersion}) · {copy.paramGroup}: {inputPairs(result.parameters)} · {copy.assumptionGroup}: {inputPairs(result.config)} · {result.datasetId}</p>}
      {result && !canApply && <p className="m-0 text-xs text-[var(--ak-signal-action)]" role="status">{copy.incompatibleStrategy}</p>}

      {walkForwardReport && (
        <section className="space-y-2 rounded border border-[var(--ak-border-subtle)] bg-[var(--ak-surface-sunken)] p-2 text-xs">
          <p className="m-0 text-[var(--ak-text-secondary)]">{copy.walkForwardCaveat}</p>
          <p className="m-0 font-mono">{copy.boundaries(walkForwardReport.boundaries.train50, walkForwardReport.boundaries.train60, walkForwardReport.boundaries.train70, walkForwardReport.boundaries.train80, walkForwardReport.boundaries.total)}</p>
          <p className="m-0">{copy.selectionLead(walkForwardReport.selectionMetric === "sharpeRatio" ? "sharpe" : "return")}<code>{walkForwardReport.selectionRule}</code>{copy.selectionRuleSuffix}{walkForwardReport.selectionConstraints && copy.trainingDrawdownLimit(formatPercentChange(walkForwardReport.selectionConstraints.maxTrainingDrawdown))}</p>
          {walkForwardReport.folds.map((fold, index) => {
            const candidates = result!.runs.filter((run) => run.segment?.start === 0 && run.segment.end === fold.trainEnd);
            return <details key={fold.validationResultId} className="rounded border border-[var(--ak-border-subtle)] p-1.5">
              <summary className="cursor-pointer font-semibold">{copy.foldSummary({ index: index + 1, trainEnd: fold.trainEnd, validationStart: fold.validationStart, validationEnd: fold.validationEnd, parameter: parameterName(result!.parameter, copy), value: fold.candidateValue, validationReturn: formatPercentChange(fold.validationMetrics.totalReturn) })}</summary>
              <p className="my-1">{copy.foldBars(timeRange(fold.trainStartTimestamp, fold.trainEndTimestamp), timeRange(fold.validationStartTimestamp, fold.validationEndTimestamp))}</p>
              <p className="m-0">{copy.foldMetrics(formatPercentChange(fold.trainingMetrics.totalReturn), fold.trainingMetrics.sharpeRatio === null ? copy.notAvailable : fold.trainingMetrics.sharpeRatio.toFixed(3), formatPercentChange(-fold.validationMetrics.maxDrawdown), fold.validationMetrics.tradeCount, fold.validationMetrics.totalFees.toFixed(2))}</p>
              <p className="m-0 font-mono text-[10px]">{copy.foldIds(fold.trainingResultId, fold.validationResultId)}</p>
              <div className="mt-1 max-h-40 overflow-auto">
                <table className="data-table w-full text-[10px]">
                  <thead><tr><th>{copy.trainCandidate}</th><th>{copy.returnColumn}</th><th>{copy.sharpeColumn}</th><th>{copy.maxDdColumn}</th><th>{copy.tradesColumn}</th><th>{copy.feesColumn}</th><th>{copy.resultColumn}</th></tr></thead>
                  <tbody>{candidates.map((candidate) => <tr key={candidate.resultId} className={candidate.resultId === fold.trainingResultId ? "font-bold" : ""}>
                    <td>{candidate.value}{candidate.resultId === fold.trainingResultId ? copy.selectedMark : ""}</td>
                    <td>{formatPercentChange(candidate.metrics.totalReturn)}</td><td>{candidate.metrics.sharpeRatio === null ? copy.notAvailable : candidate.metrics.sharpeRatio.toFixed(3)}</td><td>{formatPercentChange(-candidate.metrics.maxDrawdown)}</td><td>{candidate.metrics.tradeCount}</td><td>{candidate.metrics.totalFees.toFixed(2)}</td><td className="font-mono">{candidate.resultId}</td>
                  </tr>)}</tbody>
                </table>
              </div>
            </details>;
          })}
          <div className="rounded border border-[var(--ak-border-subtle)] p-1.5">
            <p className="m-0 font-semibold">{copy.finalTestHeading(walkForwardReport.boundaries.train80, walkForwardReport.boundaries.total, timeRange(walkForwardReport.finalTestStartTimestamp, walkForwardReport.finalTestEndTimestamp))}</p>
            <p className="m-0">{copy.finalTestMetrics(parameterName(result!.parameter, copy), walkForwardReport.finalCandidateValue, formatPercentChange(walkForwardReport.finalTestMetrics.totalReturn), formatPercentChange(-walkForwardReport.finalTestMetrics.maxDrawdown), walkForwardReport.finalTestMetrics.tradeCount, walkForwardReport.finalTestMetrics.totalFees.toFixed(2))}</p>
            <p className="m-0">{copy.finalTrainingMetrics(formatPercentChange(walkForwardReport.finalTrainingMetrics.totalReturn), walkForwardReport.finalTrainingMetrics.sharpeRatio === null ? copy.notAvailable : walkForwardReport.finalTrainingMetrics.sharpeRatio.toFixed(3))}</p>
            <Button size="sm" variant="outline" className="mt-1 h-6 text-[10px]" disabled={!canApply} onClick={() => applyParameter(walkForwardReport.finalCandidateValue)}>
              {copy.applyFinalCandidate}
            </Button>
          </div>
          {(() => {
            const candidates = result!.runs.filter((run) => run.segment?.start === 0 && run.segment.end === walkForwardReport.boundaries.train80);
            return <details className="rounded border border-[var(--ak-border-subtle)] p-1.5">
              <summary className="cursor-pointer font-semibold">{copy.finalFitResults(candidates.length)}</summary>
              <div className="mt-1 max-h-40 overflow-auto">
                <table className="data-table w-full text-[10px]">
                  <thead><tr><th>{copy.finalTrainCandidate}</th><th>{copy.returnColumn}</th><th>{copy.sharpeColumn}</th><th>{copy.maxDdColumn}</th><th>{copy.tradesColumn}</th><th>{copy.feesColumn}</th><th>{copy.resultColumn}</th></tr></thead>
                  <tbody>{candidates.map((candidate) => <tr key={candidate.resultId} className={candidate.resultId === walkForwardReport.finalTrainingResultId ? "font-bold" : ""}>
                    <td>{candidate.value}{candidate.resultId === walkForwardReport.finalTrainingResultId ? copy.selectedMark : ""}</td>
                    <td>{formatPercentChange(candidate.metrics.totalReturn)}</td><td>{candidate.metrics.sharpeRatio === null ? copy.notAvailable : candidate.metrics.sharpeRatio.toFixed(3)}</td><td>{formatPercentChange(-candidate.metrics.maxDrawdown)}</td><td>{candidate.metrics.tradeCount}</td><td>{candidate.metrics.totalFees.toFixed(2)}</td><td className="font-mono">{candidate.resultId}</td>
                  </tr>)}</tbody>
                </table>
              </div>
            </details>;
          })()}
        </section>
      )}

      {error && (
        <div ref={sweepErrorRef} role="alert" className="error-inline p-2 text-xs text-[var(--ak-signal-danger)] bg-red-950/20 border border-red-800/40">
          <AlertCircle size={13} /> {error}
        </div>
      )}

      {result && stats && (
        <div ref={sweepVerdictRef} className="sweep-verdict grid grid-cols-2 md:grid-cols-5 gap-2 p-2 bg-[var(--ak-surface-sunken-2)] border border-[var(--ak-border-subtle)]">
          <div className="sweep-verdict-cell flex flex-col">
            <span className="text-[10px] font-mono text-[var(--ak-text-secondary)]">{copy.bestValue}</span>
            <strong className="text-xs text-[var(--ak-signal-success)] font-mono font-bold tabular-nums">
              {parameterName(result.parameter, copy)} = {stats.best.value} ({formatPercentChange(stats.best.metrics.totalReturn)})
            </strong>
          </div>
          <div className="sweep-verdict-cell flex flex-col">
            <span className="text-[10px] font-mono text-[var(--ak-text-secondary)]">{copy.worstValue}</span>
            <strong className="text-xs text-[var(--ak-signal-danger)] font-mono font-bold tabular-nums">
              {parameterName(result.parameter, copy)} = {stats.worst.value} ({formatPercentChange(stats.worst.metrics.totalReturn)})
            </strong>
          </div>
          <div className="sweep-verdict-cell flex flex-col">
            <span className="text-[10px] font-mono text-[var(--ak-text-secondary)]">{copy.spread}</span>
            <strong className="text-xs font-mono font-bold tabular-nums">{copy.spreadValue((stats.spread * 100).toFixed(2))}</strong>
          </div>
          <div className="sweep-verdict-cell flex flex-col">
            <span className="text-[10px] font-mono text-[var(--ak-text-secondary)]">{copy.profitableRuns}</span>
            <strong className={`text-xs font-mono font-bold tabular-nums ${stats.profitable > 0 ? "text-[var(--ak-signal-success)]" : "text-[var(--ak-text-secondary)]"}`}>
              {stats.profitable} / {stats.total}
            </strong>
          </div>
          <div className="sweep-verdict-cell flex flex-col">
            <span className="text-[10px] font-mono text-[var(--ak-text-secondary)]">{copy.distinctOutcomes}</span>
            <strong className={`text-xs font-mono font-bold tabular-nums ${stats.collapsed > 0 ? "text-[var(--ak-text-secondary)]" : ""}`}>
              {stats.distinct} / {stats.total}
            </strong>
          </div>
        </div>
      )}

      {stats && stats.collapsed > 0 && (
        <div className="sweep-caveat flex items-center gap-2 p-2 text-xs text-[var(--ak-signal-action)] bg-yellow-950/20 border border-yellow-800/40" role="status">
          <AlertCircle size={13} className="shrink-0" />
          <span>
            <strong>{copy.collapsedHead(stats.collapsed, stats.total)}</strong>{copy.collapsedBody}
            {stats.thinnest <= 1
              ? copy.thinDataset(stats.thinnest)
              : copy.widenRange}
          </span>
        </div>
      )}

      {notice && (
        <div role="status" className="text-[10px] text-[var(--ak-signal-info)] font-mono px-2 py-1 bg-[var(--ak-surface-sunken-2)] border-l-2 border-[var(--ak-signal-info)] flex items-center justify-between">
          <span className="font-bold flex items-center gap-1.5">
            <Check size={11} className="text-[var(--ak-signal-success)]" />
            {notice}
          </span>
          <span className="text-[10px] text-[var(--ak-text-secondary)] opacity-70">{copy.strategyLabUpdated}</span>
        </div>
      )}

      {result && !result.walkForward && (
        <div className="sweep-table-scroll overflow-auto max-h-80 border border-[var(--ak-border-subtle)]">
          <table className="data-table sweep-table w-full text-xs">
            <thead>
              <tr className="bg-[var(--ak-surface-sunken)] border-b border-[var(--ak-border-subtle)] text-[10px] text-[var(--ak-text-secondary)] font-mono uppercase text-left">
                <th className="p-1.5">{parameterName(result.parameter, copy)}</th>
                <th className="p-1.5">{copy.totalReturnColumn}</th>
                <th className="p-1.5">{copy.maxDdColumn}</th>
                <th className="p-1.5">{copy.sharpeColumn}</th>
                <th className="p-1.5">{copy.winRateColumn}</th>
                <th className="p-1.5">{copy.profitFactorColumn}</th>
                <th className="p-1.5">{copy.tradesColumn}</th>
                <th className="p-1.5">{copy.finalColumn}</th>
                <th className="p-1.5 text-right">{copy.actionColumn}</th>
              </tr>
            </thead>
            <tbody>
              {result.runs.map((entry) => {
                const isBest = stats ? entry.value === stats.best.value : false;
                const isApplied = applied?.sweepId === result.sweepId && applied.value === entry.value;
                return (
                  <tr
                    key={entry.resultId || entry.value}
                    className={`border-b border-[var(--ak-border-subtle)] hover:bg-[var(--ak-surface-sunken)] transition-colors ${isBest ? "is-best bg-[var(--ak-surface-raised)]" : ""}`}
                  >
                    <td className="mono p-1.5 font-bold flex items-center gap-1.5">
                      <span className="tabular-nums">{entry.value}</span>
                      {isBest && <AkTag variant="advanced" className="text-[10px] px-1 py-0 h-3.5 leading-none">{copy.bestTag}</AkTag>}
                    </td>
                    <td className={`p-1.5 font-mono tabular-nums font-bold ${entry.metrics.totalReturn >= 0 ? "positive text-[var(--ak-signal-success)]" : "negative text-[var(--ak-signal-danger)]"}`}>
                      {entry.metrics.totalReturn >= 0 ? <TrendingUp size={11} className="inline mr-1" /> : <TrendingDown size={11} className="inline mr-1" />}
                      {formatPercentChange(entry.metrics.totalReturn)}
                    </td>
                    <td className="negative p-1.5 font-mono tabular-nums text-[var(--ak-signal-danger)]">
                      {formatPercentChange(-entry.metrics.maxDrawdown)}
                    </td>
                    <td className="p-1.5 font-mono tabular-nums">{entry.metrics.sharpeRatio === null ? "—" : entry.metrics.sharpeRatio.toFixed(2)}</td>
                    <td className="p-1.5 font-mono tabular-nums">{formatRate(entry.metrics.winRate)}</td>
                    <td className="p-1.5 font-mono tabular-nums">{entry.metrics.profitFactor === null ? "—" : entry.metrics.profitFactor.toFixed(2)}</td>
                    <td className="p-1.5 font-mono tabular-nums">{entry.metrics.tradeCount}</td>
                    <td className="mono p-1.5 font-mono tabular-nums">{entry.metrics.finalEquity.toFixed(2)}</td>
                    <td className="p-1.5 text-right">
                      <Button
                        size="sm"
                        variant={isBest ? "primary" : "outline"}
                        className="h-6 text-[10px] px-2"
                        disabled={!canApply}
                        onClick={() => applyParameter(entry.value)}
                        icon={isApplied ? <Check size={11} /> : <ArrowRight size={11} />}
                      >
                        {isApplied ? copy.applied : copy.apply}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!result && !error && (
        <div className="empty-state p-8 text-center text-xs text-[var(--ak-text-secondary)]">
          <ScanSearch size={22} className="mx-auto mb-2 text-[var(--ak-signal-action)]" />
          <strong className="block text-sm text-[var(--ak-text-primary)] mb-1">{copy.emptyTitle}</strong>
          <span className="opacity-80">
            {copy.emptyBody}
          </span>
        </div>
      )}
    </div>
  );
}
