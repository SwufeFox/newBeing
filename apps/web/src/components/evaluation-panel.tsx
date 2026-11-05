"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Check, FlaskConical, Play, TrendingDown, TrendingUp } from "lucide-react";
import { STRATEGIES, type ExchangeId, type StrategyParameters, type Timeframe } from "@newbeing/core";
import { Button } from "@/components/ui/button";
import { EXCHANGE_LABELS } from "@/lib/exchanges";
import { buildEvaluationCandidates } from "@/lib/evaluation-candidates";
import { useCopy, type CopyTable } from "@/lib/i18n";
import { PARAMETER_LABELS } from "@/lib/strategy-labels";
import { AkInput, AkSelect, AkTag } from "@swufefox/ak-ui-react";
import { useWorkspaceStore } from "@/store/workspace";
import { useShallow } from "zustand/react/shallow";

const DATASET_ID = /^sha256:[a-f0-9]{64}$/;

interface EvaluationMetrics {
  totalReturn: number;
  maxDrawdown: number;
  sharpeRatio: number | null;
  winRate: number;
  profitFactor: number | null;
  tradeCount: number;
  finalEquity: number;
}

interface EvaluationBoundary {
  startIndex: number;
  endIndexExclusive: number;
  bars: number;
  startTime: number;
  lastBarTime: number;
  endTimeExclusive: number;
}

interface EvaluationCandidate {
  candidateIndex: number;
  parameters: StrategyParameters;
  result: { resultId: string; metrics: EvaluationMetrics };
}

interface EvaluationResponse {
  datasetId: string;
  strategyId: string;
  reportId?: string;
  createdAt?: string;
  trainingDatasetId: string;
  holdoutDatasetId: string;
  trainingBoundary: EvaluationBoundary;
  holdoutBoundary: EvaluationBoundary;
  training: EvaluationCandidate[];
  selectedCandidateIndex: number;
  selectedParameters: StrategyParameters;
  selectionRule: string;
  initialization: string;
  evaluation: string;
  holdout: { resultId: string; metrics: EvaluationMetrics; exchange: ExchangeId; symbol: string; timeframe: Timeframe };
  resultIds: { training: string[]; holdout: string };
}

interface EvaluationHistoryItem {
  reportId: string;
  createdAt: string;
  strategyId: string;
  symbol: string;
  holdout: { metrics: EvaluationMetrics };
}

interface EvaluationDatasetMetadata {
  datasetId: string;
  bars: number;
  exchange: ExchangeId;
  symbol: string;
  timeframe: Timeframe;
  timestamps: number[];
}

interface EvaluationCopy {
  /* Errors the panel renders as text. */
  historyRefreshFailed: string;
  historyLoadFailed: string;
  openFailed: string;
  datasetUnreadable: string;
  datasetMalformed: string;
  evaluationFailed: string;
  evaluationMalformed: string;
  /* Strategy parameter names rendered by the scan parameter selector. */
  parameters: Record<string, string>;
  /* Dataset and split configuration. */
  datasetLabel: string;
  useActiveBacktestTitle: string;
  useActiveBacktest: string;
  ready: string;
  needBacktest: string;
  datasetAria: string;
  datasetPlaceholder: string;
  quickPick: string;
  activeChip: (id: string) => string;
  activeDatasetTitle: (id: string) => string;
  datasetPickTitle: (symbol: string | undefined, timeframe: string, datasetId: string) => string;
  holdoutStartsAt: string;
  splitRange: (bars: number, last: number) => string;
  splitAria: string;
  checkingLength: string;
  verifyFailed: string;
  retry: string;
  splitTooShort: string;
  splitRangeHint: (last: number) => string;
  midpoint: (index: number) => string;
  sourceSummary: (source: string) => string;
  currentInputs: string;
  loadedInputs: string;
  inputsDiffer: string;
  applyBacktest: string;
  backtestUnavailable: string;
  reportIncompatible: string;
  replayLocked: string;
  splitPreview: (train: number, holdout: number, trainStart: string, trainEnd: string, holdoutStart: string, holdoutEnd: string) => string;
  /* Parameter scan form. */
  parameterLabel: string;
  parameterAria: string;
  from: string;
  to: string;
  step: string;
  evaluating: string;
  runEvaluation: string;
  note: string;
  nothingTitle: string;
  nothingBody: string;
  /* History. */
  historyLabel: string;
  recentEvaluations: string;
  historyLoading: string;
  noHistory: string;
  historyHoldout: (value: string) => string;
  /* Caveats. */
  datasetCaveat: string;
  spotCaveat: string;
  /* Report. */
  statusHistorical: string;
  statusStale: string;
  statusSaved: string;
  statusPending: string;
  savedRequest: (strategyId: string, parameter: string) => string;
  scanUndetermined: string;
  selectedOnTrain: string;
  applyToStrategy: string;
  appliedToStrategy: string;
  trainReturnColumn: string;
  holdoutReturn: string;
  holdoutFinalEquity: string;
  trainTag: string;
  holdoutTag: string;
  span: (bars: number, start: string, end: string) => string;
  parametersUndetermined: string;
  maxDdColumn: string;
  sharpeColumn: string;
  tradesColumn: string;
  selectedColumn: string;
  pickedTag: string;
  savedIds: (reportId: string, trainingDataset: string, holdoutDataset: string, holdoutResult: string, parentDataset: string) => string;
  reportFooter: (strategyId: string, rule: string) => string;
  emptyTitle: string;
  emptyBody: string;
}

const EVALUATION_COPY: CopyTable<EvaluationCopy> = {
  en: {
    historyRefreshFailed: "Could not refresh evaluation history.",
    historyLoadFailed: "Could not load evaluation history.",
    openFailed: "Could not open saved evaluation.",
    datasetUnreadable: "Dataset snapshot could not be read.",
    datasetMalformed: "Dataset snapshot metadata was malformed.",
    evaluationFailed: "Evaluation failed.",
    evaluationMalformed: "Evaluation response was malformed.",
    parameters: { ...PARAMETER_LABELS.en },
    datasetLabel: "DATASET (IMMUTABLE SNAPSHOT)",
    useActiveBacktestTitle: "Use dataset from active backtest",
    useActiveBacktest: "Use Active Backtest",
    ready: "READY",
    needBacktest: "NEED BACKTEST",
    datasetAria: "Evaluation dataset id",
    datasetPlaceholder: "sha256:… — run a backtest first",
    quickPick: "QUICK PICK:",
    activeChip: (id) => `Active (${id}…)`,
    activeDatasetTitle: (id) => `Active backtest dataset: ${id}`,
    datasetPickTitle: (symbol, timeframe, datasetId) => `${symbol ?? "Backtest"} ${timeframe} · ${datasetId}`,
    holdoutStartsAt: "HOLDOUT STARTS AT",
    splitRange: (bars, last) => `${bars} bars · 2–${last}`,
    splitAria: "Holdout split index",
    checkingLength: "Checking snapshot length…",
    verifyFailed: "Could not verify snapshot length.",
    retry: "Retry",
    splitTooShort: "At least 4 bars are needed.",
    splitRangeHint: (last) => `Use a whole number from 2 to ${last}.`,
    midpoint: (index) => `Midpoint ${index}`,
    sourceSummary: (source) => `Selected snapshot source: ${source}`,
    currentInputs: "New evaluation uses current strategy, parameters and config",
    loadedInputs: "Loaded backtest strategy, parameters and config",
    inputsDiffer: "Current inputs differ from the loaded backtest.",
    applyBacktest: "Replace current strategy and config with loaded backtest",
    backtestUnavailable: "The loaded strategy version or parameter schema is unavailable or incompatible; its settings remain read-only.",
    reportIncompatible: "Select the report's strategy with a compatible parameter schema before applying these parameters.",
    replayLocked: "Leave Replay to change research settings.",
    splitPreview: (train, holdout, trainStart, trainEnd, holdoutStart, holdoutEnd) => `Train [0, ${train}): ${train} bars, ${trainStart} to ${trainEnd}. Holdout [${train}, ${train + holdout}): ${holdout} bars, ${holdoutStart} to ${holdoutEnd}. Times are first and last included candle opens.`,
    parameterLabel: "PARAMETER",
    parameterAria: "Evaluation parameter",
    from: "FROM",
    to: "TO",
    step: "STEP",
    evaluating: "Evaluating",
    runEvaluation: "Run evaluation",
    note: "Candidates rank on training only; the selected candidate runs once on holdout. Both segments cold-start with fresh cash.",
    nothingTitle: "Nothing to evaluate",
    nothingBody: "This strategy has no numeric parameter to vary. Saved evaluations remain available below.",
    historyLabel: "Saved evaluations",
    recentEvaluations: "Recent evaluations",
    historyLoading: "Loading saved evaluations…",
    noHistory: "No saved evaluations yet.",
    historyHoldout: (value) => `holdout ${value}`,
    datasetCaveat: "A canonical dataset id is required. Results saved before snapshots existed cannot be evaluated — rerun the backtest to create one.",
    spotCaveat: "Evaluation runs on the spot model with shorts disabled. Switch the backtest account mode to spot in the strategy panel.",
    statusHistorical: "Historical saved evaluation · opened from history.",
    statusStale: "Previous evaluation — inputs have changed. Run again for the current inputs.",
    statusSaved: "Saved evaluation for these inputs.",
    statusPending: " New evaluation pending; showing the saved report.",
    savedRequest: (strategyId, parameter) => `Saved evaluation request · ${strategyId} · ${parameter}`,
    scanUndetermined: "Scan parameter undetermined",
    selectedOnTrain: "SELECTED ON TRAIN",
    applyToStrategy: "Apply to strategy",
    appliedToStrategy: "Applied to strategy",
    trainReturnColumn: "TRAIN RETURN",
    holdoutReturn: "HOLDOUT RETURN",
    holdoutFinalEquity: "HOLDOUT FINAL EQUITY",
    trainTag: "TRAIN",
    holdoutTag: "HOLDOUT",
    span: (bars, start, end) => `${bars} bars · ${start} → ${end}`,
    parametersUndetermined: "Parameters (scan parameter undetermined)",
    maxDdColumn: "MAX DD",
    sharpeColumn: "SHARPE",
    tradesColumn: "TRADES",
    selectedColumn: "SELECTED",
    pickedTag: "PICKED",
    savedIds: (reportId, trainingDataset, holdoutDataset, holdoutResult, parentDataset) => `Saved · report ${reportId} · train dataset ${trainingDataset}… · holdout dataset ${holdoutDataset}… · holdout result ${holdoutResult} · parent ${parentDataset}…`,
    reportFooter: (strategyId, rule) => `strategy ${strategyId} · selection rule ${rule}`,
    emptyTitle: "Pick parameters on train, then look once at holdout",
    emptyBody: "Sweeping the whole window and quoting the best number is how a strategy looks great and fails live. This splits the saved snapshot by time, ranks candidates on the earlier part only, and reports the winner's result on bars it never saw.",
  },
  zh: {
    historyRefreshFailed: "无法刷新验证历史。",
    historyLoadFailed: "无法加载验证历史。",
    openFailed: "无法打开已保存的验证。",
    datasetUnreadable: "无法读取数据集快照。",
    datasetMalformed: "数据集快照元数据格式错误。",
    evaluationFailed: "验证失败。",
    evaluationMalformed: "验证响应格式错误。",
    parameters: { ...PARAMETER_LABELS.zh },
    datasetLabel: "数据集（不可变快照）",
    useActiveBacktestTitle: "使用当前回测的数据集",
    useActiveBacktest: "使用当前回测",
    ready: "就绪",
    needBacktest: "需先回测",
    datasetAria: "验证数据集 ID",
    datasetPlaceholder: "sha256:… — 请先运行回测",
    quickPick: "快速选择：",
    activeChip: (id) => `当前 (${id}…)`,
    activeDatasetTitle: (id) => `当前回测数据集：${id}`,
    datasetPickTitle: (symbol, timeframe, datasetId) => `${symbol ?? "回测"} ${timeframe} · ${datasetId}`,
    holdoutStartsAt: "留出集起始位置",
    splitRange: (bars, last) => `${bars} 根 K 线 · 2–${last}`,
    splitAria: "留出集切分位置",
    checkingLength: "正在检查快照长度…",
    verifyFailed: "无法校验快照长度。",
    retry: "重试",
    splitTooShort: "至少需要 4 根 K 线。",
    splitRangeHint: (last) => `请输入 2 到 ${last} 之间的整数。`,
    midpoint: (index) => `中点 ${index}`,
    sourceSummary: (source) => `所选快照来源：${source}`,
    currentInputs: "新验证使用当前策略、参数和配置",
    loadedInputs: "已加载回测的策略、参数和配置",
    inputsDiffer: "当前输入与已加载回测不同。",
    applyBacktest: "用已加载回测替换当前策略和配置",
    backtestUnavailable: "已加载的策略版本或参数结构不可用或不兼容；其设置仅供查看。",
    reportIncompatible: "请先选择报告对应的策略并确保参数结构兼容，再应用这些参数。",
    replayLocked: "请先退出回放，再更改研究设置。",
    splitPreview: (train, holdout, trainStart, trainEnd, holdoutStart, holdoutEnd) => `训练 [0, ${train})：${train} 根，${trainStart} 至 ${trainEnd}。留出 [${train}, ${train + holdout})：${holdout} 根，${holdoutStart} 至 ${holdoutEnd}。时间为首尾纳入 K 线的开盘时间。`,
    parameterLabel: "参数",
    parameterAria: "验证参数",
    from: "起始",
    to: "结束",
    step: "步长",
    evaluating: "验证中",
    runEvaluation: "开始验证",
    note: "候选仅在训练段上排序；被选中的候选只在留出集上运行一次。两段都使用全新资金冷启动。",
    nothingTitle: "无可验证参数",
    nothingBody: "该策略没有可变的数值参数。已保存的验证仍可在下方查看。",
    historyLabel: "已保存的验证",
    recentEvaluations: "最近验证",
    historyLoading: "正在加载已保存的验证…",
    noHistory: "暂无已保存的验证。",
    historyHoldout: (value) => `留出集 ${value}`,
    datasetCaveat: "需要规范的数据集 ID。快照机制之前保存的结果无法验证——请重新运行回测以生成快照。",
    spotCaveat: "验证只在模拟盘模型、禁止做空的条件下运行。请在策略面板把回测账户模式切换为模拟盘。",
    statusHistorical: "历史已保存验证 · 来自历史记录。",
    statusStale: "此为旧验证——输入已改变。请按当前输入重新运行。",
    statusSaved: "当前输入对应的已保存验证。",
    statusPending: " 新的验证进行中；此处显示已保存的报告。",
    savedRequest: (strategyId, parameter) => `已保存的验证请求 · ${strategyId} · ${parameter}`,
    scanUndetermined: "无法确定扫描参数",
    selectedOnTrain: "训练段选中",
    applyToStrategy: "应用到策略",
    appliedToStrategy: "已应用到策略",
    trainReturnColumn: "训练收益",
    holdoutReturn: "留出集收益",
    holdoutFinalEquity: "留出集最终权益",
    trainTag: "训练",
    holdoutTag: "留出集",
    span: (bars, start, end) => `${bars} 根 K 线 · ${start} → ${end}`,
    parametersUndetermined: "参数（无法确定扫描参数）",
    maxDdColumn: "最大回撤",
    sharpeColumn: "夏普比率",
    tradesColumn: "交易数",
    selectedColumn: "选中",
    pickedTag: "已选",
    savedIds: (reportId, trainingDataset, holdoutDataset, holdoutResult, parentDataset) => `已保存 · 报告 ${reportId} · 训练数据集 ${trainingDataset}… · 留出集数据集 ${holdoutDataset}… · 留出集结果 ${holdoutResult} · 父数据集 ${parentDataset}…`,
    reportFooter: (strategyId, rule) => `策略 ${strategyId} · 选择规则 ${rule}`,
    emptyTitle: "先在训练段选参数，再看一次留出集",
    emptyBody: "扫遍整段区间再报出最好的数字，正是策略看起来出色、实盘却崩掉的原因。这里把已保存的快照按时间切分，只在前一段上给候选排序，再报告胜出者在其从未见过的 K 线上的结果。",
  },
};

function numericKeys(parameters: StrategyParameters): string[] {
  return Object.entries(parameters)
    .filter(([, value]) => typeof value === "number")
    .map(([key]) => key);
}

function compatibleParameters(parameters: StrategyParameters, defaults: StrategyParameters): boolean {
  return parameters !== null && typeof parameters === "object" && !Array.isArray(parameters)
    && Object.entries(parameters).every(([key, value]) => Object.hasOwn(defaults, key)
      && typeof value === typeof defaults[key] && (typeof value !== "number" || Number.isFinite(value)));
}

function sameValues(a: object, b: object): boolean {
  const left = Object.entries(a).sort(([x], [y]) => x.localeCompare(y));
  const right = Object.entries(b).sort(([x], [y]) => x.localeCompare(y));
  return JSON.stringify(left) === JSON.stringify(right);
}

function label(key: string): string {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (first) => first.toUpperCase());
}

function reportParameter(request: string, training: EvaluationCandidate[]): string | null {
  let declared: string | null = null;
  try {
    const parsed: unknown = JSON.parse(request);
    if (typeof parsed === "object" && parsed !== null && "sweepParameter" in parsed && typeof parsed.sweepParameter === "string" && parsed.sweepParameter) declared = parsed.sweepParameter;
  } catch { /* Older reports may not have a readable request. */ }
  if (training.length === 1) return declared && Object.hasOwn(training[0]!.parameters, declared) && typeof training[0]!.parameters[declared] === "number" ? declared : null;
  if (training.length < 2) return null;
  const keys = new Set(training.flatMap((candidate) => Object.keys(candidate.parameters)));
  const varied = [...keys].filter((key) => training.some((candidate) => candidate.parameters[key] !== training[0]?.parameters[key]));
  if (varied.length !== 1 || (declared !== null && declared !== varied[0])) return null;
  const key = varied[0]!;
  return training.every((candidate) => Object.hasOwn(candidate.parameters, key) && typeof candidate.parameters[key] === "number") ? key : null;
}

function formatParameters(parameters: StrategyParameters, copy: EvaluationCopy): string {
  return Object.entries(parameters).map(([key, value]) => `${parameterName(key, copy)} = ${String(value)}`).join(", ");
}

/** Parameter names come from strategy ids; the table carries the names the
 *  scan selector shows and falls back to the derived name for the rest. */
function parameterName(key: string, copy: EvaluationCopy): string {
  return copy.parameters[key] ?? label(key);
}

function pct(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : "−"}${(Math.abs(value) * 100).toFixed(2)}%`;
}

export function EvaluationPanel({ symbol, timeframe, exchange }: { symbol: string; timeframe: Timeframe; exchange: ExchangeId }): React.JSX.Element {
  const copy = useCopy(EVALUATION_COPY);
  /* useShallow is required: a selector returning a fresh array is a new
     reference on every render, and React treats that as an uncached snapshot. */
  const [strategyId, parameters, config, result, replayLocked] = useWorkspaceStore(useShallow((state) => [state.selectedStrategyId, state.strategyParameters, state.backtestConfig, state.backtest, state.activeWorkspace === "replay"]));
  const [appliedSelected, setAppliedSelected] = useState(false);
  const strategy = STRATEGIES.find((item) => item.id === strategyId);
  const keys = useMemo(() => numericKeys(strategy?.defaults ?? {}), [strategy]);

  // Follow newly completed backtests; a manual id belongs to its source result only.
  const sourceDataset = result?.datasetId ?? "";
  const [datasetOverride, setDatasetOverride] = useState<{ source: string; value: string } | null>(null);
  const datasetId = (datasetOverride?.source === sourceDataset || (datasetOverride !== null && datasetOverride.source === ""))
    ? datasetOverride.value
    : DATASET_ID.test(sourceDataset) ? sourceDataset : "";
  const [splits, setSplits] = useState<Record<string, string>>({});
  const [parameter, setParameter] = useState<string>(keys[0] ?? "");
  const [from, setFrom] = useState("5");
  const [to, setTo] = useState("30");
  const [step, setStep] = useState("5");
  const [pending, setPending] = useState<{ context: string; controller: AbortController } | null>(null);
  const [failure, setFailure] = useState<{ context: string; message: string } | null>(null);
  const [history, setHistory] = useState<EvaluationHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historical, setHistorical] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [recentDatasets, setRecentDatasets] = useState<Array<{ datasetId: string; symbol?: string; timeframe?: string }>>([]);
  const [datasetMetadata, setDatasetMetadata] = useState<EvaluationDatasetMetadata | null>(null);
  const [datasetMetadataFailure, setDatasetMetadataFailure] = useState<{ datasetId: string; message: string } | null>(null);
  const [datasetMetadataRetry, setDatasetMetadataRetry] = useState(0);
  const [savedReport, setSavedReport] = useState<{
    response: EvaluationResponse; context: string; parameter: string | null; strategyId: string; request: string;
  } | null>(null);
  const activeRequest = useRef<AbortController | null>(null);
  const historyOpenRequest = useRef<AbortController | null>(null);
  const historyRequest = useRef(0);
  const historyLive = useRef(false);
  const loadHistory = async (requestId: number, refresh = false): Promise<void> => {
    try {
      const response = await fetch("/api/evaluations?limit=20", { cache: "no-store" });
      if (!response.ok) throw new Error(refresh ? copy.historyRefreshFailed : copy.historyLoadFailed);
      const rows = await response.json() as EvaluationHistoryItem[];
      if (!historyLive.current || requestId !== historyRequest.current) return;
      setHistory(rows);
      setHistoryError(null);
    } catch (reason) {
      if (!historyLive.current || requestId !== historyRequest.current) return;
      setHistoryError(reason instanceof Error ? reason.message : copy.historyLoadFailed);
    } finally {
      if (historyLive.current && requestId === historyRequest.current) setHistoryLoading(false);
    }
  };

  const loadRecentDatasets = async (): Promise<void> => {
    try {
      const response = await fetch("/api/backtests?limit=10", { cache: "no-store" });
      if (!response.ok) return;
      const body = await response.json();
      const items = Array.isArray(body) ? body : body.items ?? body.results ?? [];
      const valid = items
        .filter((item: Record<string, unknown>) => typeof item.datasetId === "string" && DATASET_ID.test(item.datasetId))
        .map((item: Record<string, unknown>) => ({
          datasetId: item.datasetId as string,
          symbol: typeof item.symbol === "string" ? item.symbol : undefined,
          timeframe: typeof item.timeframe === "string" ? item.timeframe : undefined,
        }));
      const seen = new Set<string>();
      const deduped: Array<{ datasetId: string; symbol?: string; timeframe?: string }> = [];
      for (const d of valid) {
        if (!seen.has(d.datasetId)) {
          seen.add(d.datasetId);
          deduped.push(d);
        }
      }
      if (historyLive.current) setRecentDatasets(deduped);
    } catch {
      // ignore
    }
  };

  useLayoutEffect(() => {
    historyLive.current = true;
    const requestId = ++historyRequest.current;
    const timer = window.setTimeout(() => {
      if (historyLive.current && requestId === historyRequest.current) {
        void loadHistory(requestId);
        void loadRecentDatasets();
      }
    }, 0);
    return () => {
      window.clearTimeout(timer);
      historyLive.current = false;
      historyRequest.current += 1;
    };
    /* Mount-only on purpose: the two loaders are recreated every render, so
       depending on their identity would refetch the saved list continuously. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useLayoutEffect(() => () => {
    historyOpenRequest.current?.abort();
    historyOpenRequest.current = null;
  }, []);
  const openHistorical = async (id: string): Promise<void> => {
    activeRequest.current?.abort();
    activeRequest.current = null;
    setPending(null);
    historyOpenRequest.current?.abort();
    const controller = new AbortController();
    historyOpenRequest.current = controller;
    try {
      const response = await fetch(`/api/evaluations/${encodeURIComponent(id)}`, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error(copy.openFailed);
      const saved = await response.json() as EvaluationResponse & { request: string; reportId: string; createdAt: string };
      if (controller.signal.aborted || historyOpenRequest.current !== controller) return;
      setSavedReport({ response: saved, context, parameter: reportParameter(saved.request, saved.training), strategyId: saved.strategyId, request: saved.request });
      setHistorical(true);
      setHistoryError(null);
    } catch (reason) {
      if (!controller.signal.aborted && historyOpenRequest.current === controller) setHistoryError(reason instanceof Error ? reason.message : copy.openFailed);
    } finally {
      if (historyOpenRequest.current === controller) historyOpenRequest.current = null;
    }
  };
  const report = savedReport?.response ?? null;
  const reportKey = savedReport?.parameter ?? "";

  const activeKey = keys.includes(parameter) ? parameter : (keys[0] ?? "");
  const spotOnly = (config.accountMode ?? "spot") === "spot" && config.allowShorts === false;
  const validDataset = DATASET_ID.test(datasetId.trim());
  const currentDatasetId = datasetId.trim();
  const currentDatasetMetadata = !replayLocked && datasetMetadata?.datasetId === currentDatasetId ? datasetMetadata : null;
  const currentDatasetMetadataError = datasetMetadataFailure?.datasetId === currentDatasetId ? datasetMetadataFailure.message : null;
  const datasetMetadataLoading = !replayLocked && validDataset && currentDatasetMetadata === null && currentDatasetMetadataError === null;
  const splitIndex = splits[currentDatasetId] ?? (currentDatasetMetadata ? String(Math.floor(currentDatasetMetadata.bars / 2)) : "");
  const setSplitIndex = (value: string): void => setSplits((previous) => ({ ...previous, [currentDatasetId]: value }));
  const loadedStrategy = result && STRATEGIES.find((item) => item.id === result.strategyId);
  const canRestoreBacktest = Boolean(result && loadedStrategy && result.strategyVersion === loadedStrategy.version && compatibleParameters(result.parameters, loadedStrategy.defaults));
  const inputsDiffer = Boolean(result && (strategyId !== result.strategyId || !sameValues(parameters, result.parameters) || !sameValues(config, result.assumptions)));
  const canApplyReport = Boolean(report && strategy && report.strategyId === strategyId && compatibleParameters(report.selectedParameters, strategy.defaults) && compatibleParameters(parameters, strategy.defaults));
  const split = Number(splitIndex);
  const splitValid = currentDatasetMetadata !== null
    && Number.isInteger(split)
    && split >= 2
    && split <= currentDatasetMetadata.bars - 2;

  useEffect(() => {
    const requestedDatasetId = datasetId.trim();
    if (replayLocked || !DATASET_ID.test(requestedDatasetId)) return;
    const controller = new AbortController();
    void fetch(`/api/datasets/${encodeURIComponent(requestedDatasetId)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload: unknown = await response.json();
        if (!response.ok) {
          const message = typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error === "string"
            ? payload.error : copy.datasetUnreadable;
          throw new Error(message);
        }
        if (typeof payload !== "object" || payload === null || !("datasetId" in payload) || payload.datasetId !== requestedDatasetId
          || !("bars" in payload) || typeof payload.bars !== "number" || !Number.isSafeInteger(payload.bars) || payload.bars < 2
          || !("exchange" in payload) || typeof payload.exchange !== "string"
          || !("symbol" in payload) || typeof payload.symbol !== "string"
          || !("timeframe" in payload) || typeof payload.timeframe !== "string"
          || !("timestamps" in payload) || !Array.isArray(payload.timestamps) || payload.timestamps.length !== payload.bars
          || !payload.timestamps.every((timestamp: unknown) => typeof timestamp === "number" && Number.isSafeInteger(timestamp) && timestamp >= 0 && Number.isFinite(new Date(timestamp).getTime()))) {
          throw new Error(copy.datasetMalformed);
        }
        if (!controller.signal.aborted) {
          setDatasetMetadata(payload as EvaluationDatasetMetadata);
          setDatasetMetadataFailure(null);
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setDatasetMetadataFailure({ datasetId: requestedDatasetId, message: reason instanceof Error ? reason.message : copy.datasetUnreadable });
        }
      });
    return () => controller.abort();
  }, [datasetId, datasetMetadataRetry, replayLocked, copy.datasetMalformed, copy.datasetUnreadable]);

  const context = JSON.stringify({ datasetId, strategyId, parameters, config, symbol, timeframe, exchange, activeKey, from, to, step, splitIndex });
  const running = pending?.context === context && !pending.controller.signal.aborted;
  const error = failure?.context === context ? failure.message : null;
  const stale = savedReport !== null && savedReport.context !== context;

  // Abort on every input/workspace change and on unmount. Identity checks also
  // protect against transports that resolve even after aborting.
  useLayoutEffect(() => {
    return () => {
      activeRequest.current?.abort();
      activeRequest.current = null;
      historyOpenRequest.current?.abort();
      historyOpenRequest.current = null;
    };
  }, [context]);

  const run = async (): Promise<void> => {
    historyOpenRequest.current?.abort();
    historyOpenRequest.current = null;
    activeRequest.current?.abort();
    activeRequest.current = null;
    setPending(null);
    if (useWorkspaceStore.getState().activeWorkspace === "replay" || keys.length === 0 || !validDataset || !currentDatasetMetadata || !splitValid || !spotOnly) return;
    const built = buildEvaluationCandidates(parameters, activeKey, from, to, step);
    if (built.error) {
      setFailure({ context, message: built.error });
      return;
    }
    const controller = new AbortController();
    activeRequest.current = controller;
    const request = JSON.stringify({
      datasetId: datasetId.trim(),
      strategyId: strategy?.id ?? strategyId,
      candidates: built.candidates,
      config: { ...config, accountMode: "spot", allowShorts: false },
      splitIndex: split,
      sweepParameter: activeKey,
    });
    setPending({ context, controller });
    setFailure(null);
    try {
      const response = await fetch("/api/evaluations", {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: request,
      });
      const payload: unknown = await response.json();
      if (controller.signal.aborted || activeRequest.current !== controller) return;
      if (!response.ok) {
        const message = typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error === "string" ? payload.error : copy.evaluationFailed;
        throw new Error(message);
      }
      if (typeof payload !== "object" || payload === null || !("training" in payload) || !Array.isArray(payload.training) || !("holdout" in payload)) {
        throw new Error(copy.evaluationMalformed);
      }
      setSavedReport({ response: payload as EvaluationResponse, context, parameter: activeKey, strategyId: strategy?.id ?? strategyId, request });
      setHistorical(false);
      setHistoryLoading(true);
      void loadHistory(++historyRequest.current, true);
    } catch (reason) {
      if (controller.signal.aborted || activeRequest.current !== controller) return;
      setFailure({ context, message: reason instanceof Error ? reason.message : copy.evaluationFailed });
    } finally {
      if (activeRequest.current === controller) {
        activeRequest.current = null;
        setPending(null);
      }
    }
  };

  const bestTraining = useMemo(() => {
    if (!report || report.training.length === 0) return null;
    return report.training.reduce((best, run) => (run.result.metrics.totalReturn > best.result.metrics.totalReturn ? run : best));
  }, [report]);

  const applySelected = (): void => {
    const current = useWorkspaceStore.getState();
    const currentStrategy = STRATEGIES.find((item) => item.id === current.selectedStrategyId);
    if (!report || current.activeWorkspace === "replay" || !currentStrategy || report.strategyId !== current.selectedStrategyId
      || !compatibleParameters(report.selectedParameters, currentStrategy.defaults) || !compatibleParameters(current.strategyParameters, currentStrategy.defaults)) return;
    current.setStrategyParameters({ ...current.strategyParameters, ...report.selectedParameters });
    setAppliedSelected(true);
    window.setTimeout(() => setAppliedSelected(false), 2000);
  };

  const applyBacktest = (): void => {
    const current = useWorkspaceStore.getState();
    const saved = current.backtest;
    const builtIn = saved && STRATEGIES.find((item) => item.id === saved.strategyId);
    if (!saved || saved.resultId !== result?.resultId || current.activeWorkspace === "replay" || !builtIn
      || saved.strategyVersion !== builtIn.version || !compatibleParameters(saved.parameters, builtIn.defaults)) return;
    current.setStrategy(saved.strategyId, { ...saved.parameters });
    current.setBacktestConfig({ ...saved.assumptions });
  };

  return (
    <div className="evaluation-panel flex flex-col gap-3 p-3 bg-[var(--ak-surface-canvas)]">
      {keys.length > 0 ? (
      <>
      <div className="evaluation-form flex flex-wrap items-end gap-2.5 p-2.5 bg-[var(--ak-surface-sunken)] border border-[var(--ak-border-subtle)]">
        <label className="evaluation-field flex flex-col gap-1 grow min-w-[18rem]">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-[var(--ak-text-secondary)] uppercase font-mono">{copy.datasetLabel}</span>
            <div className="flex items-center gap-2">
              {DATASET_ID.test(sourceDataset) && datasetId !== sourceDataset && (
                <button
                  type="button"
                  onClick={() => setDatasetOverride(null)}
                  className="text-[9px] font-mono text-[var(--ak-signal-info)] hover:underline cursor-pointer"
                  title={copy.useActiveBacktestTitle}
                >
                  {copy.useActiveBacktest}
                </button>
              )}
              {validDataset ? (
                <span className="text-[9px] font-mono text-[var(--ak-signal-success)] font-bold">{copy.ready}</span>
              ) : (
                <span className="text-[9px] font-mono text-[var(--ak-signal-action)]">{copy.needBacktest}</span>
              )}
            </div>
          </div>
          <AkInput
            aria-label={copy.datasetAria}
            className="compact-input h-7 text-xs font-mono"
            placeholder={copy.datasetPlaceholder}
            value={datasetId}
            onChange={(event) => setDatasetOverride({ source: sourceDataset, value: event.target.value })}
          />
          {recentDatasets.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap pt-0.5 text-[9px] font-mono text-[var(--ak-text-secondary)]">
              <span className="opacity-60">{copy.quickPick}</span>
              {DATASET_ID.test(sourceDataset) && (
                <button
                  type="button"
                  onClick={() => setDatasetOverride(null)}
                  className={`px-1 py-0.5 border cursor-pointer transition-colors ${
                    datasetId === sourceDataset
                      ? "border-[var(--ak-signal-info)] text-[var(--ak-signal-info)] font-bold bg-[var(--ak-surface-sunken-2)]"
                      : "border-[var(--ak-border-subtle)] hover:text-white"
                  }`}
                  title={copy.activeDatasetTitle(sourceDataset)}
                >
                  {copy.activeChip(sourceDataset.slice(7, 15))}
                </button>
              )}
              {recentDatasets.filter((d) => d.datasetId !== sourceDataset).slice(0, 3).map((d) => (
                <button
                  key={d.datasetId}
                  type="button"
                  onClick={() => setDatasetOverride({ source: sourceDataset, value: d.datasetId })}
                  className={`px-1 py-0.5 border cursor-pointer transition-colors ${
                    datasetId === d.datasetId
                      ? "border-[var(--ak-signal-info)] text-[var(--ak-signal-info)] font-bold bg-[var(--ak-surface-sunken-2)]"
                      : "border-[var(--ak-border-subtle)] hover:text-white"
                  }`}
                  title={copy.datasetPickTitle(d.symbol, d.timeframe ?? "", d.datasetId)}
                >
                  {d.symbol ? `${d.symbol} ` : ""}({d.datasetId.slice(7, 15)}…)
                </button>
              ))}
            </div>
          )}
        </label>
        <div className="evaluation-field flex flex-col gap-1">
          <label htmlFor="holdout-split-index" className="flex items-center justify-between gap-2 text-[10px] font-bold text-[var(--ak-text-secondary)] uppercase font-mono">
            <span>{copy.holdoutStartsAt}</span>
            {currentDatasetMetadata && <span>{copy.splitRange(currentDatasetMetadata.bars, currentDatasetMetadata.bars - 2)}</span>}
          </label>
          <AkInput
            id="holdout-split-index"
            aria-label={copy.splitAria}
            aria-invalid={currentDatasetMetadata ? !splitValid : undefined}
            aria-describedby={currentDatasetMetadata && !splitValid ? "holdout-split-help" : undefined}
            className="compact-input w-24 h-7 text-xs font-mono"
            type="number"
            min={2}
            max={currentDatasetMetadata ? currentDatasetMetadata.bars - 2 : undefined}
            value={splitIndex}
            onChange={(event) => setSplitIndex(event.target.value)}
          />
          {datasetMetadataLoading && <span id="holdout-split-help" className="text-[9px] text-[var(--ak-text-secondary)]" role="status">{copy.checkingLength}</span>}
          {currentDatasetMetadataError && (
            <div id="holdout-split-help" className="flex flex-wrap items-center gap-1 text-[9px] text-[var(--ak-signal-danger)]" role="alert">
              <span>{copy.verifyFailed}</span>
              <button
                type="button"
                className="text-[var(--ak-signal-info)] hover:underline"
                onClick={() => {
                  setDatasetMetadataFailure(null);
                  setDatasetMetadataRetry((retry) => retry + 1);
                }}
              >
                {copy.retry}
              </button>
            </div>
          )}
          {currentDatasetMetadata && !splitValid && (
            <div id="holdout-split-help" className="flex flex-wrap items-center gap-1 text-[9px] text-[var(--ak-signal-action)]" role="status">
              <span>
                {currentDatasetMetadata.bars < 4
                  ? copy.splitTooShort
                  : copy.splitRangeHint(currentDatasetMetadata.bars - 2)}
              </span>
              {currentDatasetMetadata.bars >= 4 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-5 px-1 text-[9px]"
                  onClick={() => setSplitIndex(String(Math.floor(currentDatasetMetadata.bars / 2)))}
                >
                  {copy.midpoint(Math.floor(currentDatasetMetadata.bars / 2))}
                </Button>
              )}
            </div>
          )}
        </div>
        <label className="evaluation-field flex flex-col gap-1">
          <span className="text-[10px] font-bold text-[var(--ak-text-secondary)] uppercase font-mono">{copy.parameterLabel}</span>
          <AkSelect aria-label={copy.parameterAria} className="select-input h-7 text-xs font-bold" value={activeKey} onChange={(event) => setParameter(event.target.value)}>
            {keys.map((key) => <option key={key} value={key}>{parameterName(key, copy)}</option>)}
          </AkSelect>
        </label>
        <label className="evaluation-field flex flex-col gap-1">
          <span className="text-[10px] font-bold text-[var(--ak-text-secondary)] uppercase font-mono">{copy.from}</span>
          <AkInput className="compact-input w-20 h-7 text-xs font-mono" type="number" value={from} onChange={(event) => setFrom(event.target.value)} />
        </label>
        <label className="evaluation-field flex flex-col gap-1">
          <span className="text-[10px] font-bold text-[var(--ak-text-secondary)] uppercase font-mono">{copy.to}</span>
          <AkInput className="compact-input w-20 h-7 text-xs font-mono" type="number" value={to} onChange={(event) => setTo(event.target.value)} />
        </label>
        <label className="evaluation-field flex flex-col gap-1">
          <span className="text-[10px] font-bold text-[var(--ak-text-secondary)] uppercase font-mono">{copy.step}</span>
          <AkInput className="compact-input w-20 h-7 text-xs font-mono" type="number" min={0} step="any" value={step} onChange={(event) => setStep(event.target.value)} />
        </label>
        <Button
          variant="primary"
          size="sm"
          data-testid="run-evaluation"
          onClick={() => void run()}
          disabled={running || replayLocked || !validDataset || !currentDatasetMetadata || !splitValid || !spotOnly}
          icon={running ? <Play size={13} className="spin" /> : <FlaskConical size={13} />}
          className="h-7 text-xs font-bold"
        >
          {running ? copy.evaluating : copy.runEvaluation}
        </Button>
      </div>
      <p className="evaluation-note text-[10px] text-[var(--ak-text-secondary)] font-mono m-0 opacity-80">{copy.note}</p>
      </>
      ) : !report ? (
        <div className="empty-state p-6 text-center text-xs text-[var(--ak-text-secondary)]"><FlaskConical size={22} className="mx-auto mb-2 text-[var(--ak-signal-info)]" /><strong>{copy.nothingTitle}</strong><span>{copy.nothingBody}</span></div>
      ) : null}
      <div className="flex flex-col gap-1 p-2 text-xs text-[var(--ak-text-secondary)] bg-[var(--ak-surface-sunken)] border border-[var(--ak-border-subtle)] break-words">
        {currentDatasetMetadata && <p className="m-0 break-all">{copy.sourceSummary(`${EXCHANGE_LABELS[currentDatasetMetadata.exchange] ?? currentDatasetMetadata.exchange} / ${currentDatasetMetadata.symbol} / ${currentDatasetMetadata.timeframe} / ${currentDatasetMetadata.datasetId}`)}</p>}
        <p className="m-0"><strong>{copy.currentInputs}:</strong> {strategyId} / {formatParameters(parameters, copy)} / {JSON.stringify(config)}</p>
        {result && <>
          {inputsDiffer && <p className="m-0 text-[var(--ak-signal-action)]" role="status">{copy.inputsDiffer}</p>}
          <p className="m-0"><strong>{copy.loadedInputs}:</strong> {result.strategyId} ({result.strategyVersion}) / {formatParameters(result.parameters, copy)} / {JSON.stringify(result.assumptions)}</p>
          <Button type="button" size="sm" variant="outline" className="self-start h-auto min-h-7 whitespace-normal text-left" disabled={!canRestoreBacktest || replayLocked} onClick={applyBacktest} aria-describedby={!canRestoreBacktest || replayLocked ? "evaluation-restore-help" : undefined}>{copy.applyBacktest}</Button>
          {(!canRestoreBacktest || replayLocked) && <span id="evaluation-restore-help">{replayLocked ? copy.replayLocked : copy.backtestUnavailable}</span>}
        </>}
        {currentDatasetMetadata && splitValid && <p className="m-0">{copy.splitPreview(split, currentDatasetMetadata.bars - split, new Date(currentDatasetMetadata.timestamps[0]!).toLocaleString(), new Date(currentDatasetMetadata.timestamps[split - 1]!).toLocaleString(), new Date(currentDatasetMetadata.timestamps[split]!).toLocaleString(), new Date(currentDatasetMetadata.timestamps[currentDatasetMetadata.bars - 1]!).toLocaleString())}</p>}
      </div>
      <section className="evaluation-history flex flex-col gap-1 max-h-36 overflow-auto" aria-label={copy.historyLabel}>
        <strong className="text-[10px] uppercase font-mono text-[var(--ak-text-secondary)]">{copy.recentEvaluations}</strong>
        {historyError && <span role="alert" className="text-xs text-[var(--ak-signal-danger)]">{historyError}</span>}
        {history.map((item) => <button key={item.reportId} type="button" className="text-left p-1.5 border border-[var(--ak-border-subtle)] text-xs font-mono hover:bg-[var(--ak-surface-sunken)]" onClick={() => void openHistorical(item.reportId)}>
          {new Date(item.createdAt).toLocaleString()} · {item.strategyId} · {item.symbol} · {copy.historyHoldout(pct(item.holdout.metrics.totalReturn))}
        </button>)}
        {historyLoading && <span className="text-xs opacity-70">{copy.historyLoading}</span>}
        {!historyLoading && !history.length && !historyError && <span className="text-xs opacity-70">{copy.noHistory}</span>}
      </section>


      {keys.length > 0 && !validDataset && (
        <div className="evaluation-caveat flex items-center gap-2 p-2 text-xs text-[var(--ak-signal-action)] bg-yellow-950/20 border border-yellow-800/40" role="status">
          <AlertCircle size={13} className="shrink-0" />
          <span>{copy.datasetCaveat}</span>
        </div>
      )}

      {keys.length > 0 && !spotOnly && (
        <div className="evaluation-caveat flex items-center gap-2 p-2 text-xs text-[var(--ak-signal-action)] bg-yellow-950/20 border border-yellow-800/40" role="status">
          <AlertCircle size={13} className="shrink-0" />
          <span>{copy.spotCaveat}</span>
        </div>
      )}

      {error && (
        <div role="alert" className="error-inline p-2 text-xs text-[var(--ak-signal-danger)] bg-red-950/20 border border-red-800/40">
          <AlertCircle size={13} /> {error}
        </div>
      )}

      {report && (
        <>
          <p role="status" className="evaluation-note text-[10px] text-[var(--ak-text-secondary)] font-mono m-0">
            {historical ? copy.statusHistorical : stale ? copy.statusStale : copy.statusSaved}
            {running && copy.statusPending}
          </p>
          <details className="text-[10px] text-[var(--ak-text-secondary)] font-mono break-all">
            <summary>{copy.savedRequest(savedReport?.strategyId ?? "", reportKey ? parameterName(reportKey, copy) : copy.scanUndetermined)}</summary>
            {savedReport?.request}
          </details>
          <div className="evaluation-verdict grid grid-cols-2 md:grid-cols-4 gap-2 p-2 bg-[var(--ak-surface-sunken-2)] border border-[var(--ak-border-subtle)]">
            <div className="evaluation-verdict-cell flex flex-col justify-between">
              <div>
                <span className="text-[9px] font-mono text-[var(--ak-text-secondary)]">{copy.selectedOnTrain}</span>
                <strong className="text-xs text-[var(--ak-signal-success)] font-mono font-bold block tabular-nums">
                  {reportKey ? `${parameterName(reportKey, copy)} = ${String(report.selectedParameters[reportKey])}` : formatParameters(report.selectedParameters, copy)}
                </strong>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="mt-1 h-5 text-[9px] px-1.5 font-bold self-start active:scale-95 transition-transform"
                onClick={applySelected}
                disabled={!canApplyReport || replayLocked}
                aria-describedby={!canApplyReport || replayLocked ? "evaluation-apply-help" : undefined}
                icon={appliedSelected ? <Check size={10} className="text-[var(--ak-signal-success)]" /> : undefined}
              >
                {appliedSelected ? copy.appliedToStrategy : copy.applyToStrategy}
              </Button>
              {(!canApplyReport || replayLocked) && <span id="evaluation-apply-help" className="text-xs text-[var(--ak-text-secondary)]">{replayLocked ? copy.replayLocked : copy.reportIncompatible}</span>}
            </div>
            <div className="evaluation-verdict-cell flex flex-col">
              <span className="text-[9px] font-mono text-[var(--ak-text-secondary)]">{copy.trainReturnColumn}</span>
              <strong className={`text-xs font-mono font-bold tabular-nums ${(bestTraining?.result.metrics.totalReturn ?? 0) >= 0 ? "text-[var(--ak-signal-success)]" : "text-[var(--ak-signal-danger)]"}`}>
                {bestTraining ? pct(bestTraining.result.metrics.totalReturn) : "—"}
              </strong>
            </div>
            <div className="evaluation-verdict-cell flex flex-col">
              <span className="text-[9px] font-mono text-[var(--ak-text-secondary)]">{copy.holdoutReturn}</span>
              <strong className={`text-xs font-mono font-bold tabular-nums ${report.holdout.metrics.totalReturn >= 0 ? "text-[var(--ak-signal-success)]" : "text-[var(--ak-signal-danger)]"}`}>
                {pct(report.holdout.metrics.totalReturn)}
              </strong>
            </div>
            <div className="evaluation-verdict-cell flex flex-col">
              <span className="text-[9px] font-mono text-[var(--ak-text-secondary)]">{copy.holdoutFinalEquity}</span>
              <strong className="text-xs font-mono font-bold tabular-nums">{report.holdout.metrics.finalEquity.toFixed(2)}</strong>
            </div>
          </div>

          <div className="evaluation-bounds flex flex-wrap items-center gap-2 p-2 text-[10px] font-mono text-[var(--ak-text-secondary)] bg-[var(--ak-surface-sunken)] border border-[var(--ak-border-subtle)]">
            <AkTag variant="neutral" className="text-[9px]">{copy.trainTag}</AkTag>
            <span>{copy.span(report.trainingBoundary.bars, new Date(report.trainingBoundary.startTime).toLocaleString(), new Date(report.trainingBoundary.endTimeExclusive).toLocaleString())}</span>
            <AkTag variant="neutral" className="text-[9px]">{copy.holdoutTag}</AkTag>
            <span>{copy.span(report.holdoutBoundary.bars, new Date(report.holdoutBoundary.startTime).toLocaleString(), new Date(report.holdoutBoundary.endTimeExclusive).toLocaleString())}</span>
            <span className="opacity-70">{report.evaluation} · {report.initialization}</span>
          </div>

          <div className="evaluation-table-scroll overflow-auto max-h-80 border border-[var(--ak-border-subtle)]">
            <table className="data-table evaluation-table w-full text-xs">
              <thead>
                <tr className="bg-[var(--ak-surface-sunken)] border-b border-[var(--ak-border-subtle)] text-[10px] text-[var(--ak-text-secondary)] font-mono uppercase text-left">
                  <th className="p-1.5">{reportKey ? parameterName(reportKey, copy) : copy.parametersUndetermined}</th>
                  <th className="p-1.5">{copy.trainReturnColumn}</th>
                  <th className="p-1.5">{copy.maxDdColumn}</th>
                  <th className="p-1.5">{copy.sharpeColumn}</th>
                  <th className="p-1.5">{copy.tradesColumn}</th>
                  <th className="p-1.5 text-right">{copy.selectedColumn}</th>
                </tr>
              </thead>
              <tbody>
                {report.training.map((candidate) => {
                  const isSelected = candidate.candidateIndex === report.selectedCandidateIndex;
                  return (
                    <tr key={candidate.result.resultId} className={`border-b border-[var(--ak-border-subtle)] hover:bg-[var(--ak-surface-sunken)] transition-colors ${isSelected ? "is-best bg-[var(--ak-surface-raised)]" : ""}`}>
                      <td className="mono p-1.5 font-bold flex items-center gap-1.5">
                        <span className="tabular-nums">{reportKey ? String(candidate.parameters[reportKey]) : formatParameters(candidate.parameters, copy)}</span>
                        {isSelected && <AkTag variant="advanced" className="text-[9px] px-1 py-0 h-3.5 leading-none">{copy.pickedTag}</AkTag>}
                      </td>
                      <td className={`p-1.5 font-mono tabular-nums font-bold ${candidate.result.metrics.totalReturn >= 0 ? "positive text-[var(--ak-signal-success)]" : "negative text-[var(--ak-signal-danger)]"}`}>
                        {candidate.result.metrics.totalReturn >= 0 ? <TrendingUp size={11} className="inline mr-1" /> : <TrendingDown size={11} className="inline mr-1" />}
                        {pct(candidate.result.metrics.totalReturn)}
                      </td>
                      <td className="negative p-1.5 font-mono tabular-nums text-[var(--ak-signal-danger)]">−{(candidate.result.metrics.maxDrawdown * 100).toFixed(2)}%</td>
                      <td className="p-1.5 font-mono tabular-nums">{candidate.result.metrics.sharpeRatio === null ? "—" : candidate.result.metrics.sharpeRatio.toFixed(2)}</td>
                      <td className="p-1.5 font-mono tabular-nums">{candidate.result.metrics.tradeCount}</td>
                      <td className="p-1.5 text-right">{isSelected ? <Check size={12} className="inline text-[var(--ak-signal-success)]" /> : null}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="evaluation-ids text-[10px] text-[var(--ak-text-secondary)] font-mono m-0 opacity-80 break-all">
            {copy.savedIds(report.reportId ?? "—", report.trainingDatasetId.slice(0, 24), report.holdoutDatasetId.slice(0, 24), report.holdout.resultId, report.datasetId.slice(0, 24))}
          </p>
          <p className="evaluation-note text-[10px] text-[var(--ak-text-secondary)] font-mono m-0 opacity-70">
            {EXCHANGE_LABELS[report.holdout.exchange]} · {report.holdout.symbol} · {report.holdout.timeframe} · {copy.reportFooter(savedReport?.strategyId ?? "", report.selectionRule)}
          </p>
        </>
      )}

      {!report && !error && (
        <div className="empty-state p-8 text-center text-xs text-[var(--ak-text-secondary)]">
          <FlaskConical size={22} className="mx-auto mb-2 text-[var(--ak-signal-info)]" />
          <strong className="block text-sm text-[var(--ak-text-primary)] mb-1">{copy.emptyTitle}</strong>
          <span className="opacity-80">
            {copy.emptyBody}
          </span>
        </div>
      )}
    </div>
  );
}
