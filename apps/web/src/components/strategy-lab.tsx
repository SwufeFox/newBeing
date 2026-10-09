"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { loader } from "@monaco-editor/react";
import { Check, Code2, Play, Save, ShieldAlert } from "lucide-react";
import { STRATEGIES, type StrategyDefinition, type StrategyParameters } from "@newbeing/core";
import { Button } from "@/components/ui/button";
import { useWorkspaceStore } from "@/store/workspace";
import { useShallow } from "zustand/react/shallow";

loader.config({ paths: { vs: "/monaco/vs" } });

const Monaco = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => <div className="editor-loading">Loading local Monaco assets…</div>,
});

interface StrategyLabProps {
  onRun: () => void;
  running: boolean;
}

function sourceFor(strategy: StrategyDefinition): string {
  const common = `/** newBeing strategy draft — reviewed built-in runner: ${strategy.id}@${strategy.version}\n * This editor is saved as research source only. Arbitrary code is not executed.\n * Backtests currently run the deterministic built-in implementation with the parameters below.\n */\n\nimport type { Candle, MarketSide, StrategyParameters } from "@newbeing/core";\n\nexport function signalAt(\n  candles: readonly Candle[],\n  index: number,\n  parameters: StrategyParameters,\n): MarketSide {\n  const bar = candles[index];\n  if (!bar) return "flat";\n`;
  if (strategy.id === "sma-crossover") {
    return `${common}  const fastPeriod = Number(parameters.fastPeriod ?? 20);\n  const slowPeriod = Number(parameters.slowPeriod ?? 50);\n  if (fastPeriod >= slowPeriod || index + 1 < slowPeriod) return "flat";\n\n  const mean = (period: number): number => {\n    const start = index - period + 1;\n    return candles.slice(start, index + 1).reduce((sum, item) => sum + item.close, 0) / period;\n  };\n  return mean(fastPeriod) > mean(slowPeriod) ? "long" : "flat";\n}\n`;
  }
  if (strategy.id === "rsi-mean-reversion") {
    return `${common}  const period = Number(parameters.period ?? 14);\n  if (index < period) return "flat";\n  let gains = 0;\n  let losses = 0;\n  for (let i = index - period + 1; i <= index; i += 1) {\n    const previous = candles[i - 1];\n    const current = candles[i];\n    if (!previous || !current) return "flat";\n    const change = current.close - previous.close;\n    gains += Math.max(0, change);\n    losses += Math.max(0, -change);\n  }\n  const ratio = gains / Math.max(losses, Number.EPSILON);\n  const rsi = 100 - 100 / (1 + ratio);\n  return rsi <= Number(parameters.oversold ?? 30) ? "long" : "flat";\n}\n`;
  }
  return `${common}  const lookback = Number(parameters.lookback ?? 20);\n  const anchor = candles[index - lookback];\n  if (!anchor || anchor.close <= 0) return "flat";\n  const move = bar.close / anchor.close - 1;\n  const threshold = Number(parameters.thresholdPct ?? 2) / 100;\n  if (move >= threshold) return "long";\n  if (move <= -threshold && Boolean(parameters.allowShorts)) return "short";\n  return "flat";\n}\n`;
}

function parameterLabel(key: string): string {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (first) => first.toUpperCase());
}

export function StrategyLab({ onRun, running }: StrategyLabProps): React.JSX.Element {
  const [strategyId, setStrategyId, savedDraft, saveDraft, params, setParams, theme, config, setConfig] = useWorkspaceStore(useShallow((state) => [
    state.selectedStrategyId,
    state.setStrategy,
    state.sourceDrafts[state.selectedStrategyId],
    state.setSourceDraft,
    state.strategyParameters,
    state.setStrategyParameters,
    state.theme,
    state.backtestConfig,
    state.setBacktestConfig,
  ]));
  const strategy = STRATEGIES.find((item) => item.id === strategyId) ?? STRATEGIES[0];
  const [editorValues, setEditorValues] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const source = strategy ? editorValues[strategy.id] ?? savedDraft ?? sourceFor(strategy) : "";
  const setSource = (next: string): void => {
    if (strategy) setEditorValues((current) => ({ ...current, [strategy.id]: next }));
  };

  const parameterEntries = useMemo(() => Object.entries(strategy?.defaults ?? {}), [strategy]);

  const updateStrategy = (nextId: string): void => {
    const next = STRATEGIES.find((item) => item.id === nextId);
    if (next) setStrategyId(next.id, { ...next.defaults });
  };

  const updateParameter = (key: string, value: number | boolean): void => {
    setParams({ ...params, [key]: value });
  };

  const saveSource = async (): Promise<void> => {
    if (!strategy) return;
    setSaveError(null);
    try {
      const safeSlug = strategy.id.replace(/[^a-z0-9-]/g, "-");
      const response = await fetch("/api/strategies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: `custom-${safeSlug}`,
          name: `${strategy.name} draft`,
          description: `Saved source draft based on ${strategy.name}. This source is not executable.`,
          parameters: params,
          source,
        }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const message = typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error === "string"
          ? payload.error
          : "Could not save this draft.";
        throw new Error(message);
      }
      saveDraft(strategy.id, source);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1800);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not save draft.");
    }
  };

  if (!strategy) return <div className="empty-panel">No built-in strategy is available.</div>;

  const invalidSma = strategy.id === "sma-crossover"
    && typeof params.fastPeriod === "number" && typeof params.slowPeriod === "number"
    && params.fastPeriod >= params.slowPeriod;

  return (
    <div className="strategy-lab">
      <div className="strategy-toolbar">
        <label className="field-label" htmlFor="strategy-select">Strategy</label>
        <select id="strategy-select" className="select-input" value={strategy.id} onChange={(event) => updateStrategy(event.target.value)}>
          {STRATEGIES.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </div>
      <p className="strategy-description">{strategy.description}</p>

      <div className="strategy-params">
        {parameterEntries.map(([key, defaultValue]) => {
          const value = params[key] ?? defaultValue;
          if (typeof defaultValue === "boolean") {
            return <label className="toggle-row" key={key}><span>{parameterLabel(key)}</span><input type="checkbox" checked={Boolean(value)} onChange={(event) => updateParameter(key, event.target.checked)} /></label>;
          }
          return <label className="param-row" key={key}><span>{parameterLabel(key)}</span><input className="compact-input" type="number" min={0} max={1000} step={key.toLowerCase().includes("pct") ? 0.1 : 1} value={typeof value === "number" ? value : defaultValue} onChange={(event) => updateParameter(key, Number(event.target.value))} /></label>;
        })}
        {invalidSma && <div className="inline-alert"><ShieldAlert size={13} /> Fast period must be lower than slow period.</div>}
      </div>

      <div className="assumptions-heading">Simulation assumptions</div>
      <div className="assumption-grid">
        <label><span>Initial capital</span><input className="compact-input" type="number" min={100} step={1000} value={config.initialCapital} onChange={(event) => setConfig({ ...config, initialCapital: Math.max(100, Number(event.target.value)) })} /></label>
        <label><span>Position %</span><input className="compact-input" type="number" min={1} max={100} step={1} value={Math.round(config.positionFraction * 100)} onChange={(event) => setConfig({ ...config, positionFraction: Math.max(0.01, Math.min(1, Number(event.target.value) / 100)) })} /></label>
        <label><span>Fee (bps)</span><input className="compact-input" type="number" min={0} max={500} step={1} value={Math.round(config.feeRate * 10_000)} onChange={(event) => setConfig({ ...config, feeRate: Math.max(0, Math.min(0.05, Number(event.target.value) / 10_000)) })} /></label>
        <label><span>Slippage (bps)</span><input className="compact-input" type="number" min={0} max={500} step={1} value={Math.round(config.slippageRate * 10_000)} onChange={(event) => setConfig({ ...config, slippageRate: Math.max(0, Math.min(0.05, Number(event.target.value) / 10_000)) })} /></label>
      </div>
      <p className="assumption-note">Signal at close → next bar open; stop-first if both OHLC barriers hit. Shorting has no borrow/funding/liquidation model.</p>

      <div className="editor-heading"><div><Code2 size={13} /><span>Strategy source</span></div><span className="draft-badge">DRAFT · NOT EXECUTED</span></div>
      <div className="editor-frame">
        <Monaco
          height="100%"
          language="typescript"
          theme={theme === "dark" ? "vs-dark" : "light"}
          value={source}
          onChange={(value) => setSource(value ?? "")}
          options={{
            minimap: { enabled: false },
            fontSize: 11,
            lineNumbersMinChars: 3,
            scrollBeyondLastLine: false,
            wordWrap: "on",
            automaticLayout: true,
            tabSize: 2,
            renderLineHighlight: "gutter",
            overviewRulerBorder: false,
            padding: { top: 10, bottom: 10 },
          }}
        />
      </div>
      <div className="sandbox-note"><ShieldAlert size={13} /><span>Only the reviewed built-in strategy runs. This TypeScript draft is never eval’d and cannot access files, network, or exchange credentials.</span></div>
      {saveError && <div className="error-inline">{saveError}</div>}
      <div className="strategy-actions">
        <Button variant="outline" size="sm" onClick={() => void saveSource()}>{saved ? <Check size={13} /> : <Save size={13} />}{saved ? "Saved" : "Save draft"}</Button>
        <Button variant="primary" size="sm" onClick={onRun} disabled={running || invalidSma}>{running ? <span className="spin"><Play size={13} /></span> : <Play size={13} />}{running ? "Running" : "Run backtest"}</Button>
      </div>
    </div>
  );
}
