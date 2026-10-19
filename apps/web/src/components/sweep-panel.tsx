"use client";

import { useMemo, useState } from "react";
import { AlertCircle, Play, ScanSearch, TrendingDown, TrendingUp } from "lucide-react";
import { STRATEGIES, type BacktestConfig, type ExchangeId, type StrategyParameters, type Timeframe } from "@newbeing/core";
import { Button } from "@/components/ui/button";
import { EXCHANGE_LABELS } from "@/lib/exchanges";

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

  const [parameter, setParameter] = useState<string>(keys[0] ?? "");
  const [from, setFrom] = useState("5");
  const [to, setTo] = useState("30");
  const [step, setStep] = useState("5");
  const [result, setResult] = useState<SweepResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

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

  const stats = useMemo(() => {
    if (!result || result.runs.length === 0) return null;
    const returns = result.runs.map((r) => r.metrics.totalReturn);
    const best = result.runs.reduce((a, b) => (b.metrics.totalReturn > a.metrics.totalReturn ? b : a));
    const worst = result.runs.reduce((a, b) => (b.metrics.totalReturn < a.metrics.totalReturn ? b : a));
    const profitable = result.runs.filter((r) => r.metrics.totalReturn > 0).length;

    /* Two different values can produce byte-identical results — on a dataset
       that only offers one entry, every parameter above that threshold gives
       the same single trade. Reporting eight rows as eight findings would
       overstate what was actually tested, so identical rows are collapsed into
       one finding and the count of distinct outcomes is shown. */
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
    return <div className="empty-state"><ScanSearch size={18} /><strong>Nothing to sweep</strong><span>This strategy has no numeric parameter to vary.</span></div>;
  }

  return <div className="sweep-panel">
    <div className="sweep-form">
      <label className="sweep-field"><span>Parameter</span>
        <select className="select-input" value={activeKey} onChange={(event) => setParameter(event.target.value)}>
          {keys.map((key) => <option key={key} value={key}>{label(key)}</option>)}
        </select>
      </label>
      <label className="sweep-field"><span>From</span><input className="compact-input" type="number" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
      <label className="sweep-field"><span>To</span><input className="compact-input" type="number" value={to} onChange={(event) => setTo(event.target.value)} /></label>
      <label className="sweep-field"><span>Step</span><input className="compact-input" type="number" min={1} value={step} onChange={(event) => setStep(event.target.value)} /></label>
      <Button variant="primary" size="sm" data-testid="run-sweep" onClick={() => void run()} disabled={running}>
        {running ? <span className="spin"><Play size={13} /></span> : <ScanSearch size={13} />}
        {running ? "Sweeping" : "Run sweep"}
      </Button>
    </div>

    <p className="sweep-note">
      Every value runs against one candle set — {EXCHANGE_LABELS[exchange]} · {symbol} · {timeframe} — so the outcomes are comparable.
      {result && ` ${result.bars} bars, ${result.values.length} runs, all from dataset ${result.datasetId.slice(0, 28)}…`}
    </p>

    {error && <div className="error-inline"><AlertCircle size={13} />{error}</div>}

    {result && stats && <div className="sweep-verdict">
      <div className="sweep-verdict-cell"><span>BEST</span><strong className="positive">{label(result.parameter)} = {stats.best.value} · {pct(stats.best.metrics.totalReturn)}</strong></div>
      <div className="sweep-verdict-cell"><span>WORST</span><strong className="negative">{label(result.parameter)} = {stats.worst.value} · {pct(stats.worst.metrics.totalReturn)}</strong></div>
      <div className="sweep-verdict-cell"><span>SPREAD</span><strong>{(stats.spread * 100).toFixed(2)} pts</strong></div>
      <div className="sweep-verdict-cell"><span>PROFITABLE</span><strong className={stats.profitable > 0 ? "positive" : "muted"}>{stats.profitable} / {stats.total}</strong></div>
      {/* Distinct outcomes, not row count: identical rows are one finding. */}
      <div className="sweep-verdict-cell"><span>DISTINCT OUTCOMES</span><strong className={stats.collapsed > 0 ? "muted" : ""}>{stats.distinct} / {stats.total}</strong></div>
    </div>}

    {/* Say it plainly when the data cannot tell the values apart, because the
        table below will otherwise look like that many independent confirmations. */}
    {stats && stats.collapsed > 0 && <div className="sweep-caveat" role="status">
      <AlertCircle size={13} />
      <span>
        <strong>{stats.collapsed} of {stats.total} values produced an identical result</strong> and are not independent evidence.
        {stats.thinnest <= 1
          ? ` This dataset yields as little as ${stats.thinnest} trade, so most of these values never got a chance to differ. Use a longer history or a shorter timeframe.`
          : " Widen the range or step so each value is exercised differently."}
      </span>
    </div>}

    {result && <div className="sweep-table-scroll">
      <table className="data-table sweep-table">
        <thead><tr>
          <th>{label(result.parameter)}</th><th>TOTAL RETURN</th><th>MAX DD</th><th>SHARPE</th><th>WIN RATE</th><th>PF</th><th>TRADES</th><th>FINAL</th>
        </tr></thead>
        <tbody>
          {result.runs.map((entry) => {
            const isBest = stats ? entry.value === stats.best.value : false;
            return <tr key={entry.value} className={isBest ? "is-best" : ""}>
              <td className="mono">{entry.value}{isBest && <span className="best-tag">BEST</span>}</td>
              <td className={entry.metrics.totalReturn >= 0 ? "positive" : "negative"}>
                {entry.metrics.totalReturn >= 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}{pct(entry.metrics.totalReturn)}
              </td>
              <td className="negative">−{(entry.metrics.maxDrawdown * 100).toFixed(2)}%</td>
              <td>{entry.metrics.sharpeRatio === null ? "—" : entry.metrics.sharpeRatio.toFixed(2)}</td>
              {/* A win rate and a drawdown are magnitudes in 0..1, not gains or
                  losses, so they take no sign. */}
              <td>{(entry.metrics.winRate * 100).toFixed(1)}%</td>
              <td>{entry.metrics.profitFactor === null ? "—" : entry.metrics.profitFactor.toFixed(2)}</td>
              <td>{entry.metrics.tradeCount}</td>
              <td className="mono">{entry.metrics.finalEquity.toFixed(2)}</td>
            </tr>;
          })}
        </tbody>
      </table>
    </div>}

    {!result && !error && <div className="empty-state">
      <ScanSearch size={18} />
      <strong>Vary one parameter across a range</strong>
      <span>Picking parameters by intuition is guesswork. This runs the strategy at every value on the same candles so you can see which ones actually held up.</span>
    </div>}
  </div>;
}
