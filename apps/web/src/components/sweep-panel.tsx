"use client";

import { useMemo, useState } from "react";
import { AlertCircle, Play, ScanSearch, TrendingDown, TrendingUp, Check, ArrowRight } from "lucide-react";
import { STRATEGIES, type BacktestConfig, type ExchangeId, type StrategyParameters, type Timeframe } from "@newbeing/core";
import { Button } from "@/components/ui/button";
import { EXCHANGE_LABELS } from "@/lib/exchanges";
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
  finalEquity: number;
}

interface SweepRun {
  value: number;
  metrics: SweepRunMetrics;
}

export interface SweepResult {
  sweepId: string;
  exchange: ExchangeId;
  symbol: string;
  timeframe: Timeframe;
  strategyId: string;
  strategyVersion: string;
  parameter: string;
  values: number[];
  runs: SweepRun[];
  parameters: StrategyParameters;
  datasetId: string;
  bars: number;
  createdAt: string;
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

function pct(value: number): string {
  return `${value >= 0 ? "+" : "−"}${(Math.abs(value) * 100).toFixed(2)}%`;
}

export function SweepPanel({ symbol, timeframe, exchange, strategyId, parameters, config }: SweepPanelProps): React.JSX.Element {
  const strategy = STRATEGIES.find((item) => item.id === strategyId) ?? STRATEGIES[0];
  const keys = useMemo(() => sweepableKeys(strategy?.defaults ?? {}), [strategy]);
  const setStrategyParameters = useWorkspaceStore((state) => state.setStrategyParameters);

  const [parameter, setParameter] = useState<string>(keys[0] ?? "");
  const [from, setFrom] = useState("5");
  const [to, setTo] = useState("30");
  const [step, setStep] = useState("5");
  const [result, setResult] = useState<SweepResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [appliedVal, setAppliedVal] = useState<number | null>(null);

  const activeKey = keys.includes(parameter) ? parameter : (keys[0] ?? "");

  const run = async (): Promise<void> => {
    setRunning(true);
    setError(null);
    try {
      const response = await fetch("/api/sweeps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exchange,
          symbol,
          timeframe,
          strategyId,
          parameters,
          config,
          parameter: activeKey,
          from: Number(from),
          to: Number(to),
          step: Number(step),
          limit: 600,
        }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const message = typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error === "string"
          ? payload.error : "Sweep failed.";
        throw new Error(message);
      }
      if (typeof payload !== "object" || payload === null || !("runs" in payload) || !Array.isArray(payload.runs)) {
        throw new Error("Sweep response was malformed.");
      }
      setResult(payload as SweepResult);
    } catch (reason) {
      setResult(null);
      setError(reason instanceof Error ? reason.message : "Sweep failed.");
    } finally {
      setRunning(false);
    }
  };

  const applyParameter = (val: number): void => {
    setStrategyParameters({ ...parameters, [activeKey]: val });
    setAppliedVal(val);
    window.setTimeout(() => setAppliedVal(null), 1800);
  };

  const stats = useMemo(() => {
    if (!result || result.runs.length === 0) return null;
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

  if (keys.length === 0) {
    return <div className="empty-state p-6 text-center text-xs text-[var(--ak-text-secondary)]"><ScanSearch size={22} className="mx-auto mb-2 text-[var(--ak-signal-info)]" /><strong>Nothing to sweep</strong><span>This strategy has no numeric parameter to vary.</span></div>;
  }

  return (
    <div className="sweep-panel flex flex-col gap-3 p-3 bg-[var(--ak-surface-canvas)]">
      <div className="sweep-form flex flex-wrap items-end gap-2.5 p-2.5 bg-[var(--ak-surface-sunken)] border border-[var(--ak-border-subtle)]">
        <label className="sweep-field flex flex-col gap-1">
          <span className="text-[10px] font-bold text-[var(--ak-text-secondary)] uppercase font-mono">PARAMETER</span>
          <AkSelect className="select-input h-7 text-xs font-bold" value={activeKey} onChange={(event) => setParameter(event.target.value)}>
            {keys.map((key) => <option key={key} value={key}>{label(key)}</option>)}
          </AkSelect>
        </label>
        <label className="sweep-field flex flex-col gap-1">
          <span className="text-[10px] font-bold text-[var(--ak-text-secondary)] uppercase font-mono">FROM</span>
          <AkInput className="compact-input w-20 h-7 text-xs font-mono" type="number" value={from} onChange={(event) => setFrom(event.target.value)} />
        </label>
        <label className="sweep-field flex flex-col gap-1">
          <span className="text-[10px] font-bold text-[var(--ak-text-secondary)] uppercase font-mono">TO</span>
          <AkInput className="compact-input w-20 h-7 text-xs font-mono" type="number" value={to} onChange={(event) => setTo(event.target.value)} />
        </label>
        <label className="sweep-field flex flex-col gap-1">
          <span className="text-[10px] font-bold text-[var(--ak-text-secondary)] uppercase font-mono">STEP</span>
          <AkInput className="compact-input w-20 h-7 text-xs font-mono" type="number" min={1} value={step} onChange={(event) => setStep(event.target.value)} />
        </label>
        <Button
          variant="primary"
          size="sm"
          data-testid="run-sweep"
          onClick={() => void run()}
          disabled={running}
          icon={running ? <Play size={13} className="spin" /> : <ScanSearch size={13} />}
          className="h-7 text-xs font-bold"
        >
          {running ? "Sweeping" : "Run sweep"}
        </Button>
      </div>

      <p className="sweep-note text-[10px] text-[var(--ak-text-secondary)] font-mono m-0 opacity-80">
        Every value runs against one candle set — {EXCHANGE_LABELS[exchange]} · {symbol} · {timeframe} — outcomes are deterministic and comparable.
        {result && ` ${result.bars} bars, ${result.values.length} runs, dataset ${result.datasetId.slice(0, 24)}…`}
      </p>

      {error && (
        <div className="error-inline p-2 text-xs text-[var(--ak-signal-danger)] bg-red-950/20 border border-red-800/40">
          <AlertCircle size={13} /> {error}
        </div>
      )}

      {result && stats && (
        <div className="sweep-verdict grid grid-cols-2 md:grid-cols-5 gap-2 p-2 bg-[var(--ak-surface-sunken-2)] border border-[var(--ak-border-subtle)]">
          <div className="sweep-verdict-cell flex flex-col">
            <span className="text-[9px] font-mono text-[var(--ak-text-secondary)]">BEST VALUE</span>
            <strong className="text-xs text-[var(--ak-signal-success)] font-mono font-bold">
              {label(result.parameter)} = {stats.best.value} ({pct(stats.best.metrics.totalReturn)})
            </strong>
          </div>
          <div className="sweep-verdict-cell flex flex-col">
            <span className="text-[9px] font-mono text-[var(--ak-text-secondary)]">WORST VALUE</span>
            <strong className="text-xs text-[var(--ak-signal-danger)] font-mono font-bold">
              {label(result.parameter)} = {stats.worst.value} ({pct(stats.worst.metrics.totalReturn)})
            </strong>
          </div>
          <div className="sweep-verdict-cell flex flex-col">
            <span className="text-[9px] font-mono text-[var(--ak-text-secondary)]">SPREAD</span>
            <strong className="text-xs font-mono font-bold">{(stats.spread * 100).toFixed(2)} pts</strong>
          </div>
          <div className="sweep-verdict-cell flex flex-col">
            <span className="text-[9px] font-mono text-[var(--ak-text-secondary)]">PROFITABLE RUNS</span>
            <strong className={`text-xs font-mono font-bold ${stats.profitable > 0 ? "text-[var(--ak-signal-success)]" : "text-[var(--ak-text-secondary)]"}`}>
              {stats.profitable} / {stats.total}
            </strong>
          </div>
          <div className="sweep-verdict-cell flex flex-col">
            <span className="text-[9px] font-mono text-[var(--ak-text-secondary)]">DISTINCT OUTCOMES</span>
            <strong className={`text-xs font-mono font-bold ${stats.collapsed > 0 ? "text-[var(--ak-text-secondary)]" : ""}`}>
              {stats.distinct} / {stats.total}
            </strong>
          </div>
        </div>
      )}

      {stats && stats.collapsed > 0 && (
        <div className="sweep-caveat flex items-center gap-2 p-2 text-xs text-[var(--ak-signal-action)] bg-yellow-950/20 border border-yellow-800/40" role="status">
          <AlertCircle size={13} className="shrink-0" />
          <span>
            <strong>{stats.collapsed} of {stats.total} values produced an identical result</strong> and are not independent evidence.
            {stats.thinnest <= 1
              ? ` This dataset yields as little as ${stats.thinnest} trade, so most values never differed. Use longer history or shorter timeframe.`
              : " Widen range or step so each value is exercised differently."}
          </span>
        </div>
      )}

      {result && (
        <div className="sweep-table-scroll overflow-auto max-h-80 border border-[var(--ak-border-subtle)]">
          <table className="data-table sweep-table w-full text-xs">
            <thead>
              <tr className="bg-[var(--ak-surface-sunken)] border-b border-[var(--ak-border-subtle)] text-[10px] text-[var(--ak-text-secondary)] font-mono uppercase text-left">
                <th className="p-1.5">{label(result.parameter)}</th>
                <th className="p-1.5">TOTAL RETURN</th>
                <th className="p-1.5">MAX DD</th>
                <th className="p-1.5">SHARPE</th>
                <th className="p-1.5">WIN RATE</th>
                <th className="p-1.5">PF</th>
                <th className="p-1.5">TRADES</th>
                <th className="p-1.5">FINAL</th>
                <th className="p-1.5 text-right">ACTION</th>
              </tr>
            </thead>
            <tbody>
              {result.runs.map((entry) => {
                const isBest = stats ? entry.value === stats.best.value : false;
                const isApplied = appliedVal === entry.value;
                return (
                  <tr
                    key={entry.value}
                    className={`border-b border-[var(--ak-border-subtle)] hover:bg-[var(--ak-surface-sunken)] transition-colors ${isBest ? "is-best bg-[var(--ak-surface-raised)]" : ""}`}
                  >
                    <td className="mono p-1.5 font-bold flex items-center gap-1.5">
                      <span>{entry.value}</span>
                      {isBest && <AkTag variant="advanced" className="text-[9px] px-1 py-0 h-3.5 leading-none">BEST</AkTag>}
                    </td>
                    <td className={`p-1.5 font-mono font-bold ${entry.metrics.totalReturn >= 0 ? "positive text-[var(--ak-signal-success)]" : "negative text-[var(--ak-signal-danger)]"}`}>
                      {entry.metrics.totalReturn >= 0 ? <TrendingUp size={11} className="inline mr-1" /> : <TrendingDown size={11} className="inline mr-1" />}
                      {pct(entry.metrics.totalReturn)}
                    </td>
                    <td className="negative p-1.5 font-mono text-[var(--ak-signal-danger)]">
                      −{(entry.metrics.maxDrawdown * 100).toFixed(2)}%
                    </td>
                    <td className="p-1.5 font-mono">{entry.metrics.sharpeRatio === null ? "—" : entry.metrics.sharpeRatio.toFixed(2)}</td>
                    <td className="p-1.5 font-mono">{(entry.metrics.winRate * 100).toFixed(1)}%</td>
                    <td className="p-1.5 font-mono">{entry.metrics.profitFactor === null ? "—" : entry.metrics.profitFactor.toFixed(2)}</td>
                    <td className="p-1.5 font-mono">{entry.metrics.tradeCount}</td>
                    <td className="mono p-1.5 font-mono">{entry.metrics.finalEquity.toFixed(2)}</td>
                    <td className="p-1.5 text-right">
                      <Button
                        size="sm"
                        variant={isBest ? "primary" : "outline"}
                        className="h-6 text-[10px] px-2"
                        onClick={() => applyParameter(entry.value)}
                        icon={isApplied ? <Check size={11} /> : <ArrowRight size={11} />}
                      >
                        {isApplied ? "Applied" : "Apply"}
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
          <strong className="block text-sm text-[var(--ak-text-primary)] mb-1">Vary one parameter across a range</strong>
          <span className="opacity-80">
            Picking parameters by intuition is guesswork. This runs the strategy at every value on the same historical candles so you can see which ones held up.
          </span>
        </div>
      )}
    </div>
  );
}
