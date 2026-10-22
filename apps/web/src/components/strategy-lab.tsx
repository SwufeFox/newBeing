"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { loader } from "@monaco-editor/react";
import { Check, Code2, Play, Save, ShieldAlert, Sliders } from "lucide-react";
import { STRATEGIES, type StrategyDefinition, type StrategyParameters } from "@newbeing/core";
import { Button } from "@/components/ui/button";
import { EXCHANGE_LABELS } from "@/lib/exchanges";
import { useWorkspaceStore } from "@/store/workspace";
import { useShallow } from "zustand/react/shallow";
import { AkSelect, AkChoice, AkTag, AkNotice, AkField, AkFieldLabel, AkInput } from "@swufefox/ak-ui-react";

loader.config({ paths: { vs: "/monaco/vs" } });

const Monaco = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => <div className="editor-loading p-4 text-xs font-mono text-[var(--ak-text-secondary)]">Loading local Monaco assets…</div>,
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
  const exchange = useWorkspaceStore((state) => state.exchange);
  const symbol = useWorkspaceStore((state) => state.symbol);
  const timeframe = useWorkspaceStore((state) => state.timeframe);
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

  if (!strategy) return <div className="empty-panel p-4 font-mono text-xs">No built-in strategy is available.</div>;

  const invalidSma = strategy.id === "sma-crossover"
    && typeof params.fastPeriod === "number" && typeof params.slowPeriod === "number"
    && params.fastPeriod >= params.slowPeriod;

  return (
    <div className="strategy-lab flex flex-col gap-3 p-3 bg-[var(--ak-surface-canvas)]">
      <div className="strategy-toolbar flex items-center justify-between gap-2 border-b border-[var(--ak-border-subtle)] pb-2">
        <label className="field-label text-xs font-bold text-[var(--ak-text-secondary)] uppercase tracking-wider" htmlFor="strategy-select">
          STRATEGY TEMPLATE
        </label>
        <AkSelect
          id="strategy-select"
          className="select-input font-bold text-xs"
          value={strategy.id}
          onChange={(event) => updateStrategy(event.target.value)}
        >
          {STRATEGIES.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </AkSelect>
      </div>

      <div className="strategy-description bg-[var(--ak-surface-sunken)] p-2.5 border-l-2 border-[var(--ak-signal-info)]" data-testid="executable-strategy">
        <div className="flex items-center gap-2 mb-1">
          <strong className="text-xs font-mono text-[var(--ak-signal-info)]">
            EXECUTABLE · {strategy.id}@{strategy.version}
          </strong>
        </div>
        <p className="text-xs text-[var(--ak-text-secondary)] leading-relaxed m-0">
          {strategy.executionSummary?.(params) ?? strategy.description}
        </p>
      </div>

      <div className="strategy-params space-y-2 bg-[var(--ak-surface-sunken-2)] p-2.5 border border-[var(--ak-border-subtle)]">
        <div className="flex items-center gap-1.5 text-[11px] font-bold text-[var(--ak-text-secondary)] uppercase tracking-wider pb-1 border-b border-[var(--ak-border-subtle)]">
          <Sliders size={12} className="text-[var(--ak-signal-action)]" />
          <span>TUNABLE PARAMETERS</span>
        </div>
        {parameterEntries.map(([key, defaultValue]) => {
          const value = params[key] ?? defaultValue;
          if (typeof defaultValue === "boolean") {
            return (
              <div className="toggle-row flex items-center justify-between py-1" key={key}>
                <span className="text-xs text-[var(--ak-text-primary)]">{parameterLabel(key)}</span>
                <AkChoice
                  variant="switch"
                  checked={Boolean(value)}
                  onChange={(event) => updateParameter(key, event.target.checked)}
                />
              </div>
            );
          }
          return (
            <div className="param-row flex items-center justify-between gap-2 py-1" key={key}>
              <span className="text-xs text-[var(--ak-text-primary)]">{parameterLabel(key)}</span>
              <AkInput
                className="compact-input w-24 h-7 text-xs font-mono text-right"
                type="number"
                min={0}
                max={1000}
                step={key.toLowerCase().includes("pct") ? 0.1 : 1}
                value={typeof value === "number" ? value : defaultValue}
                onChange={(event) => updateParameter(key, Number(event.target.value))}
              />
            </div>
          );
        })}
        {invalidSma && (
          <div className="inline-alert flex items-center gap-1.5 text-[11px] text-[var(--ak-signal-danger)] p-1.5 bg-red-950/20 border border-red-800/40">
            <ShieldAlert size={13} />
            <span>Fast period must be lower than slow period.</span>
          </div>
        )}
      </div>

      <div className="assumptions-heading text-[11px] font-bold text-[var(--ak-text-secondary)] uppercase tracking-wider pt-1">
        SIMULATION ASSUMPTIONS
      </div>
      <div className="assumption-grid grid grid-cols-2 gap-2 bg-[var(--ak-surface-sunken)] p-2 border border-[var(--ak-border-subtle)]">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-[var(--ak-text-secondary)] font-mono">INITIAL CAPITAL</span>
          <AkInput
            className="compact-input h-7 text-xs font-mono"
            type="number"
            min={100}
            step={1000}
            value={config.initialCapital}
            onChange={(event) => setConfig({ ...config, initialCapital: Math.max(100, Number(event.target.value)) })}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-[var(--ak-text-secondary)] font-mono">POSITION %</span>
          <AkInput
            className="compact-input h-7 text-xs font-mono"
            type="number"
            min={1}
            max={100}
            step={1}
            value={Math.round(config.positionFraction * 100)}
            onChange={(event) => setConfig({ ...config, positionFraction: Math.max(0.01, Math.min(1, Number(event.target.value) / 100)) })}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-[var(--ak-text-secondary)] font-mono">FEE (BPS)</span>
          <AkInput
            className="compact-input h-7 text-xs font-mono"
            type="number"
            min={0}
            max={500}
            step={1}
            value={Math.round(config.feeRate * 10_000)}
            onChange={(event) => setConfig({ ...config, feeRate: Math.max(0, Math.min(0.05, Number(event.target.value) / 10_000)) })}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-[var(--ak-text-secondary)] font-mono">SLIPPAGE (BPS)</span>
          <AkInput
            className="compact-input h-7 text-xs font-mono"
            type="number"
            min={0}
            max={500}
            step={1}
            value={Math.round(config.slippageRate * 10_000)}
            onChange={(event) => setConfig({ ...config, slippageRate: Math.max(0, Math.min(0.05, Number(event.target.value) / 10_000)) })}
          />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-xs">Execution account
        <AkSelect aria-label="Backtest account mode" value={config.accountMode ?? "spot"} onChange={(event) => setConfig({ ...config, accountMode: event.target.value as "spot" | "legacy-margin", allowShorts: false })}>
          <option value="spot">Spot · fee-inclusive sizing</option><option value="legacy-margin">Legacy synthetic margin simulation</option>
        </AkSelect>
      </label>
      {config.accountMode === "legacy-margin" && <label className="flex gap-2 text-xs"><input type="checkbox" checked={config.allowShorts} onChange={(event) => setConfig({ ...config, allowShorts: event.target.checked })} />Allow synthetic shorts (no borrow/funding model)</label>}
      <p className="assumption-note text-[10px] text-[var(--ak-text-secondary)] opacity-70 m-0">
        {config.accountMode === "legacy-margin" ? "Historical synthetic model; no native derivative contract, margin, liquidation or funding simulation." : "Spot inventory and quote fees; budget includes entry fee. Opening gaps precede opening orders; entry-bar targets are deferred."}
      </p>

      <div className="editor-heading flex items-center justify-between border-t border-[var(--ak-border-subtle)] pt-2 mt-1">
        <div className="flex items-center gap-1.5 text-xs font-bold text-[var(--ak-text-primary)]">
          <Code2 size={13} className="text-[var(--ak-signal-info)]" />
          <span>STRATEGY SOURCE</span>
        </div>
        <span className="draft-badge text-[10px] font-mono px-1.5 py-0.5 bg-[var(--ak-surface-raised)] border border-[var(--ak-border)] text-[var(--ak-signal-action)]">
          DRAFT · NOT EXECUTED
        </span>
      </div>

      <div className="editor-frame h-48 border border-[var(--ak-border-strong)] bg-[#1e1e1e]">
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
            padding: { top: 6, bottom: 6 },
          }}
        />
      </div>

      <div className="sandbox-note flex items-center gap-2 p-1.5 text-[10px] text-[var(--ak-text-secondary)] opacity-80">
        <ShieldAlert size={13} className="text-[var(--ak-signal-info)] shrink-0" />
        <span>Only the reviewed built-in strategy runs. This TypeScript draft is stored in local SQLite without arbitrary code execution.</span>
      </div>

      {saveError && (
        <div className="error-inline text-xs text-[var(--ak-signal-danger)] p-1.5 bg-red-950/20 border border-red-800/40">
          {saveError}
        </div>
      )}

      <div className="strategy-actions flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[var(--ak-border-subtle)]">
        <Button
          data-testid="save-strategy-draft"
          variant="outline"
          size="sm"
          onClick={() => void saveSource()}
          icon={saved ? <Check size={13} className="text-[var(--ak-signal-success)]" /> : <Save size={13} />}
          className="text-xs"
        >
          {saved ? "Saved" : "Save draft"}
        </Button>

        <p className="assumption-note text-[10px] text-[var(--ak-text-secondary)] font-mono m-0 opacity-80">
          Runs on {EXCHANGE_LABELS[exchange]} · {symbol} · {timeframe}
        </p>

        <Button
          variant="primary"
          size="sm"
          onClick={onRun}
          disabled={running || invalidSma}
          icon={running ? <Play size={13} className="spin" /> : <Play size={13} />}
          className="text-xs font-bold"
        >
          {running ? "Running" : "Run backtest"}
        </Button>
      </div>
    </div>
  );
}
