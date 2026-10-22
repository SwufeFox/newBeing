"use client";

import { useMemo, useState } from "react";
import { AlertCircle, Check, FlaskConical, Play, TrendingDown, TrendingUp } from "lucide-react";
import { STRATEGIES, type ExchangeId, type StrategyParameters, type Timeframe } from "@newbeing/core";
import { Button } from "@/components/ui/button";
import { EXCHANGE_LABELS } from "@/lib/exchanges";
import { buildEvaluationCandidates } from "@/lib/evaluation-candidates";
import { AkInput, AkSelect, AkTag } from "@swufefox/ak-ui-react";
import { useWorkspaceStore } from "@/store/workspace";

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
  holdout: { resultId: string; metrics: EvaluationMetrics };
  resultIds: { training: string[]; holdout: string };
}

function numericKeys(parameters: StrategyParameters): string[] {
  return Object.entries(parameters)
    .filter(([, value]) => typeof value === "number")
    .map(([key]) => key);
}

function label(key: string): string {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (first) => first.toUpperCase());
}

function pct(value: number): string {
  return `${value >= 0 ? "+" : "−"}${(Math.abs(value) * 100).toFixed(2)}%`;
}

export function EvaluationPanel({ symbol, timeframe, exchange }: { symbol: string; timeframe: Timeframe; exchange: ExchangeId }): React.JSX.Element {
  const [strategyId, parameters, config, result] = useWorkspaceStore((state) => [state.selectedStrategyId, state.strategyParameters, state.backtestConfig, state.backtest]);
  const strategy = STRATEGIES.find((item) => item.id === strategyId) ?? STRATEGIES[0];
  const keys = useMemo(() => numericKeys(strategy?.defaults ?? {}), [strategy]);

  /* The dataset is the immutable snapshot the last result was scored on. A legacy
     result has no canonical id, so the field stays empty and must be pasted in. */
  const [datasetId, setDatasetId] = useState<string>(DATASET_ID.test(result?.datasetId ?? "") ? result!.datasetId : "");
  const [splitIndex, setSplitIndex] = useState("300");
  const [parameter, setParameter] = useState<string>(keys[0] ?? "");
  const [from, setFrom] = useState("5");
  const [to, setTo] = useState("30");
  const [step, setStep] = useState("5");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<EvaluationResponse | null>(null);

  const activeKey = keys.includes(parameter) ? parameter : (keys[0] ?? "");
  const spotOnly = (config.accountMode ?? "spot") === "spot" && config.allowShorts === false;
  const validDataset = DATASET_ID.test(datasetId.trim());
  const split = Number(splitIndex);
  const splitValid = Number.isInteger(split) && split >= 2;

  const run = async (): Promise<void> => {
    const built = buildEvaluationCandidates(parameters, activeKey, from, to, step);
    if (built.error) {
      setReport(null);
      setError(built.error);
      return;
    }
    setRunning(true);
    setError(null);
    try {
      const response = await fetch("/api/evaluations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          datasetId: datasetId.trim(),
          strategyId: strategy?.id ?? strategyId,
          candidates: built.candidates,
          config: { ...config, accountMode: "spot", allowShorts: false },
          splitIndex: split,
        }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const message = typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error === "string" ? payload.error : "Evaluation failed.";
        throw new Error(message);
      }
      if (typeof payload !== "object" || payload === null || !("training" in payload) || !Array.isArray(payload.training) || !("holdout" in payload)) {
        throw new Error("Evaluation response was malformed.");
      }
      setReport(payload as EvaluationResponse);
    } catch (reason) {
      setReport(null);
      setError(reason instanceof Error ? reason.message : "Evaluation failed.");
    } finally {
      setRunning(false);
    }
  };

  const bestTraining = useMemo(() => {
    if (!report || report.training.length === 0) return null;
    return report.training.reduce((best, run) => (run.result.metrics.totalReturn > best.result.metrics.totalReturn ? run : best));
  }, [report]);

  if (keys.length === 0) {
    return <div className="empty-state p-6 text-center text-xs text-[var(--ak-text-secondary)]"><FlaskConical size={22} className="mx-auto mb-2 text-[var(--ak-signal-info)]" /><strong>Nothing to evaluate</strong><span>This strategy has no numeric parameter to vary.</span></div>;
  }

  return (
    <div className="evaluation-panel flex flex-col gap-3 p-3 bg-[var(--ak-surface-canvas)]">
      <div className="evaluation-form flex flex-wrap items-end gap-2.5 p-2.5 bg-[var(--ak-surface-sunken)] border border-[var(--ak-border-subtle)]">
        <label className="evaluation-field flex flex-col gap-1 grow min-w-[18rem]">
          <span className="text-[10px] font-bold text-[var(--ak-text-secondary)] uppercase font-mono">DATASET (IMMUTABLE SNAPSHOT)</span>
          <AkInput
            aria-label="Evaluation dataset id"
            className="compact-input h-7 text-xs font-mono"
            placeholder="sha256:… — run a backtest first"
            value={datasetId}
            onChange={(event) => setDatasetId(event.target.value)}
          />
        </label>
        <label className="evaluation-field flex flex-col gap-1">
          <span className="text-[10px] font-bold text-[var(--ak-text-secondary)] uppercase font-mono">HOLDOUT STARTS AT</span>
          <AkInput aria-label="Holdout split index" className="compact-input w-24 h-7 text-xs font-mono" type="number" min={2} value={splitIndex} onChange={(event) => setSplitIndex(event.target.value)} />
        </label>
        <label className="evaluation-field flex flex-col gap-1">
          <span className="text-[10px] font-bold text-[var(--ak-text-secondary)] uppercase font-mono">PARAMETER</span>
          <AkSelect aria-label="Evaluation parameter" className="select-input h-7 text-xs font-bold" value={activeKey} onChange={(event) => setParameter(event.target.value)}>
            {keys.map((key) => <option key={key} value={key}>{label(key)}</option>)}
          </AkSelect>
        </label>
        <label className="evaluation-field flex flex-col gap-1">
          <span className="text-[10px] font-bold text-[var(--ak-text-secondary)] uppercase font-mono">FROM</span>
          <AkInput className="compact-input w-20 h-7 text-xs font-mono" type="number" value={from} onChange={(event) => setFrom(event.target.value)} />
        </label>
        <label className="evaluation-field flex flex-col gap-1">
          <span className="text-[10px] font-bold text-[var(--ak-text-secondary)] uppercase font-mono">TO</span>
          <AkInput className="compact-input w-20 h-7 text-xs font-mono" type="number" value={to} onChange={(event) => setTo(event.target.value)} />
        </label>
        <label className="evaluation-field flex flex-col gap-1">
          <span className="text-[10px] font-bold text-[var(--ak-text-secondary)] uppercase font-mono">STEP</span>
          <AkInput className="compact-input w-20 h-7 text-xs font-mono" type="number" min={1} value={step} onChange={(event) => setStep(event.target.value)} />
        </label>
        <Button
          variant="primary"
          size="sm"
          data-testid="run-evaluation"
          onClick={() => void run()}
          disabled={running || !validDataset || !splitValid || !spotOnly}
          icon={running ? <Play size={13} className="spin" /> : <FlaskConical size={13} />}
          className="h-7 text-xs font-bold"
        >
          {running ? "Evaluating" : "Run evaluation"}
        </Button>
      </div>

      <p className="evaluation-note text-[10px] text-[var(--ak-text-secondary)] font-mono m-0 opacity-80">
        Candidates are ranked on the training window only; the chosen one is then run once on the holdout.
        Both segments cold-start with fresh cash — this is a single chronological split, not walk-forward.
      </p>

      {!validDataset && (
        <div className="evaluation-caveat flex items-center gap-2 p-2 text-xs text-[var(--ak-signal-action)] bg-yellow-950/20 border border-yellow-800/40" role="status">
          <AlertCircle size={13} className="shrink-0" />
          <span>A canonical dataset id is required. Results saved before snapshots existed cannot be evaluated — rerun the backtest to create one.</span>
        </div>
      )}

      {!spotOnly && (
        <div className="evaluation-caveat flex items-center gap-2 p-2 text-xs text-[var(--ak-signal-action)] bg-yellow-950/20 border border-yellow-800/40" role="status">
          <AlertCircle size={13} className="shrink-0" />
          <span>Evaluation runs on the spot model with shorts disabled. Switch the backtest account mode to spot in the strategy panel.</span>
        </div>
      )}

      {error && (
        <div className="error-inline p-2 text-xs text-[var(--ak-signal-danger)] bg-red-950/20 border border-red-800/40">
          <AlertCircle size={13} /> {error}
        </div>
      )}

      {report && (
        <>
          <div className="evaluation-verdict grid grid-cols-2 md:grid-cols-4 gap-2 p-2 bg-[var(--ak-surface-sunken-2)] border border-[var(--ak-border-subtle)]">
            <div className="evaluation-verdict-cell flex flex-col">
              <span className="text-[9px] font-mono text-[var(--ak-text-secondary)]">SELECTED ON TRAIN</span>
              <strong className="text-xs text-[var(--ak-signal-success)] font-mono font-bold">
                {label(activeKey)} = {String(report.selectedParameters[activeKey])}
              </strong>
            </div>
            <div className="evaluation-verdict-cell flex flex-col">
              <span className="text-[9px] font-mono text-[var(--ak-text-secondary)]">TRAIN RETURN</span>
              <strong className={`text-xs font-mono font-bold ${(bestTraining?.result.metrics.totalReturn ?? 0) >= 0 ? "text-[var(--ak-signal-success)]" : "text-[var(--ak-signal-danger)]"}`}>
                {bestTraining ? pct(bestTraining.result.metrics.totalReturn) : "—"}
              </strong>
            </div>
            <div className="evaluation-verdict-cell flex flex-col">
              <span className="text-[9px] font-mono text-[var(--ak-text-secondary)]">HOLDOUT RETURN</span>
              <strong className={`text-xs font-mono font-bold ${report.holdout.metrics.totalReturn >= 0 ? "text-[var(--ak-signal-success)]" : "text-[var(--ak-signal-danger)]"}`}>
                {pct(report.holdout.metrics.totalReturn)}
              </strong>
            </div>
            <div className="evaluation-verdict-cell flex flex-col">
              <span className="text-[9px] font-mono text-[var(--ak-text-secondary)]">HOLDOUT FINAL EQUITY</span>
              <strong className="text-xs font-mono font-bold">{report.holdout.metrics.finalEquity.toFixed(2)}</strong>
            </div>
          </div>

          <div className="evaluation-bounds flex flex-wrap items-center gap-2 p-2 text-[10px] font-mono text-[var(--ak-text-secondary)] bg-[var(--ak-surface-sunken)] border border-[var(--ak-border-subtle)]">
            <AkTag variant="neutral" className="text-[9px]">TRAIN</AkTag>
            <span>{report.trainingBoundary.bars} bars · {new Date(report.trainingBoundary.startTime).toLocaleString()} → {new Date(report.trainingBoundary.endTimeExclusive).toLocaleString()}</span>
            <AkTag variant="neutral" className="text-[9px]">HOLDOUT</AkTag>
            <span>{report.holdoutBoundary.bars} bars · {new Date(report.holdoutBoundary.startTime).toLocaleString()} → {new Date(report.holdoutBoundary.endTimeExclusive).toLocaleString()}</span>
            <span className="opacity-70">{report.evaluation} · {report.initialization}</span>
          </div>

          <div className="evaluation-table-scroll overflow-auto max-h-80 border border-[var(--ak-border-subtle)]">
            <table className="data-table evaluation-table w-full text-xs">
              <thead>
                <tr className="bg-[var(--ak-surface-sunken)] border-b border-[var(--ak-border-subtle)] text-[10px] text-[var(--ak-text-secondary)] font-mono uppercase text-left">
                  <th className="p-1.5">{label(activeKey)}</th>
                  <th className="p-1.5">TRAIN RETURN</th>
                  <th className="p-1.5">MAX DD</th>
                  <th className="p-1.5">SHARPE</th>
                  <th className="p-1.5">TRADES</th>
                  <th className="p-1.5 text-right">SELECTED</th>
                </tr>
              </thead>
              <tbody>
                {report.training.map((candidate) => {
                  const isSelected = candidate.candidateIndex === report.selectedCandidateIndex;
                  return (
                    <tr key={candidate.result.resultId} className={`border-b border-[var(--ak-border-subtle)] hover:bg-[var(--ak-surface-sunken)] transition-colors ${isSelected ? "is-best bg-[var(--ak-surface-raised)]" : ""}`}>
                      <td className="mono p-1.5 font-bold flex items-center gap-1.5">
                        <span>{String(candidate.parameters[activeKey])}</span>
                        {isSelected && <AkTag variant="advanced" className="text-[9px] px-1 py-0 h-3.5 leading-none">PICKED</AkTag>}
                      </td>
                      <td className={`p-1.5 font-mono font-bold ${candidate.result.metrics.totalReturn >= 0 ? "positive text-[var(--ak-signal-success)]" : "negative text-[var(--ak-signal-danger)]"}`}>
                        {candidate.result.metrics.totalReturn >= 0 ? <TrendingUp size={11} className="inline mr-1" /> : <TrendingDown size={11} className="inline mr-1" />}
                        {pct(candidate.result.metrics.totalReturn)}
                      </td>
                      <td className="negative p-1.5 font-mono text-[var(--ak-signal-danger)]">−{(candidate.result.metrics.maxDrawdown * 100).toFixed(2)}%</td>
                      <td className="p-1.5 font-mono">{candidate.result.metrics.sharpeRatio === null ? "—" : candidate.result.metrics.sharpeRatio.toFixed(2)}</td>
                      <td className="p-1.5 font-mono">{candidate.result.metrics.tradeCount}</td>
                      <td className="p-1.5 text-right">{isSelected ? <Check size={12} className="inline text-[var(--ak-signal-success)]" /> : null}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="evaluation-ids text-[10px] text-[var(--ak-text-secondary)] font-mono m-0 opacity-80 break-all">
            Saved · train dataset {report.trainingDatasetId.slice(0, 24)}… · holdout dataset {report.holdoutDatasetId.slice(0, 24)}… · holdout result {report.holdout.resultId} · parent {report.datasetId.slice(0, 24)}…
          </p>
          <p className="evaluation-note text-[10px] text-[var(--ak-text-secondary)] font-mono m-0 opacity-70">
            {EXCHANGE_LABELS[exchange]} · {symbol} · {timeframe} · selection rule {report.selectionRule}
          </p>
        </>
      )}

      {!report && !error && (
        <div className="empty-state p-8 text-center text-xs text-[var(--ak-text-secondary)]">
          <FlaskConical size={22} className="mx-auto mb-2 text-[var(--ak-signal-info)]" />
          <strong className="block text-sm text-[var(--ak-text-primary)] mb-1">Pick parameters on train, then look once at holdout</strong>
          <span className="opacity-80">
            Sweeping the whole window and quoting the best number is how a strategy looks great and fails live.
            This splits the saved snapshot by time, ranks candidates on the earlier part only, and reports the winner&apos;s result on bars it never saw.
          </span>
        </div>
      )}
    </div>
  );
}
