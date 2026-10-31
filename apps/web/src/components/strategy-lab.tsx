"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
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

const BUILTIN_PRESETS: Record<string, Array<{ name: string; params: StrategyParameters }>> = {
  "sma-crossover": [
    { name: "Aggressive", params: { fastPeriod: 5, slowPeriod: 15 } },
    { name: "Conservative", params: { fastPeriod: 20, slowPeriod: 50 } },
  ],
  "rsi-mean-reversion": [
    { name: "Sensitive", params: { period: 9, oversold: 35, overbought: 65 } },
    { name: "Extreme", params: { period: 21, oversold: 20, overbought: 80 } },
  ],
  "momentum-reversal": [
    { name: "Short-term", params: { lookback: 10, thresholdPct: 2 } },
    { name: "High-conviction", params: { lookback: 40, thresholdPct: 5 } },
  ],
};

function parameterLabel(key: string): string {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (first) => first.toUpperCase());
}

function loadStoredPresets(strategyId?: string): Array<{ name: string; params: StrategyParameters }> {
  if (!strategyId || typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(`newbeing:strategy-presets:${strategyId}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // ignore
  }
  return [];
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
  const [presetNotice, setPresetNotice] = useState<string | null>(null);
  const [customPresetsByStrategy, setCustomPresetsByStrategy] = useState<Record<string, Array<{ name: string; params: StrategyParameters }>>>({});
  const [showSaveInput, setShowSaveInput] = useState(false);
  const [newPresetName, setNewPresetName] = useState("");
  const canSavePreset = newPresetName.trim().length > 0;

  const customPresets = useMemo(() => {
    return customPresetsByStrategy[strategyId] ?? loadStoredPresets(strategyId);
  }, [customPresetsByStrategy, strategyId]);

  const saveCustomPreset = (name: string): void => {
    if (!strategy || !name.trim()) return;
    const trimmed = name.trim();
    const existing = customPresets.filter((p) => p.name !== trimmed);
    const updated = [...existing, { name: trimmed, params: { ...params } }];
    setCustomPresetsByStrategy((prev) => ({ ...prev, [strategy.id]: updated }));
    try {
      localStorage.setItem(`newbeing:strategy-presets:${strategy.id}`, JSON.stringify(updated));
    } catch {
      // ignore
    }
    setPresetNotice(`Saved preset '${trimmed}'`);
    setShowSaveInput(false);
    setNewPresetName("");
    window.setTimeout(() => setPresetNotice(null), 2200);
  };

  const deleteCustomPreset = (name: string): void => {
    if (!strategy) return;
    const updated = customPresets.filter((p) => p.name !== name);
    setCustomPresetsByStrategy((prev) => ({ ...prev, [strategy.id]: updated }));
    try {
      localStorage.setItem(`newbeing:strategy-presets:${strategy.id}`, JSON.stringify(updated));
    } catch {
      // ignore
    }
    setPresetNotice(`Deleted preset '${name}'`);
    window.setTimeout(() => setPresetNotice(null), 2200);
  };

  const isDefault = useMemo(() => {
    if (!strategy) return true;
    return Object.entries(strategy.defaults).every(([k, v]) => params[k] === v);
  }, [strategy, params]);

  const applyPreset = (name: string, nextParams: StrategyParameters): void => {
    if (!strategy) return;
    setParams({ ...strategy.defaults, ...nextParams });
    setPresetNotice(`Loaded '${name}' preset`);
    window.setTimeout(() => setPresetNotice(null), 2200);
  };

  const resetDefaults = (): void => {
    if (!strategy) return;
    setParams({ ...strategy.defaults });
    setPresetNotice("Reset to defaults");
    window.setTimeout(() => setPresetNotice(null), 2200);
  };

  const source = strategy ? editorValues[strategy.id] ?? savedDraft ?? sourceFor(strategy) : "";
  const setSource = (next: string): void => {
    if (strategy) setEditorValues((current) => ({ ...current, [strategy.id]: next }));
  };

  const parameterEntries = useMemo(() => Object.entries(strategy?.defaults ?? {}), [strategy]);

  const updateStrategy = (nextId: string): void => {
    const next = STRATEGIES.find((item) => item.id === nextId);
    if (next) setStrategyId(next.id, { ...next.defaults });
  };

  const updateParameter = (key: string, raw: string | boolean | number): void => {
    if (typeof raw === "boolean") {
      setParams({ ...params, [key]: raw });
      return;
    }
    const num = Number(raw);
    if (!Number.isFinite(num) || num < 0) return;
    setParams({ ...params, [key]: num });
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

  const saveSourceRef = useRef(saveSource);
  useEffect(() => {
    saveSourceRef.current = saveSource;
  });

  // Global hotkey: Ctrl+S / Cmd+S to save draft
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveSourceRef.current();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

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
        <div className="flex items-center justify-between pb-1 border-b border-[var(--ak-border-subtle)]">
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-[var(--ak-text-secondary)] uppercase tracking-wider">
            <Sliders size={12} className="text-[var(--ak-signal-action)]" />
            <span>TUNABLE PARAMETERS</span>
          </div>
          <button
            type="button"
            onClick={resetDefaults}
            disabled={isDefault}
            className="text-[9px] font-mono text-[var(--ak-text-secondary)] hover:text-white underline cursor-pointer disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed transition-colors"
            title="Reset parameters to factory defaults"
          >
            Reset Defaults
          </button>
        </div>

        <div className="preset-bar flex items-center flex-wrap gap-1 py-0.5">
          <span className="text-[9px] font-mono text-[var(--ak-text-secondary)] uppercase mr-1">PRESET:</span>
          <button
            type="button"
            onClick={resetDefaults}
            className={`px-1.5 py-0.5 text-[9px] font-mono border transition-all cursor-pointer ${
              isDefault
                ? "bg-[var(--ak-signal-info)] text-black border-transparent font-bold"
                : "bg-transparent text-[var(--ak-text-secondary)] border-[var(--ak-border-subtle)] hover:text-white"
            }`}
          >
            Default
          </button>
          {BUILTIN_PRESETS[strategy.id]?.map((preset) => {
            const isActive = Object.entries(preset.params).every(([k, v]) => params[k] === v);
            return (
              <button
                key={preset.name}
                type="button"
                onClick={() => applyPreset(preset.name, preset.params)}
                className={`px-1.5 py-0.5 text-[9px] font-mono border transition-all cursor-pointer ${
                  isActive
                    ? "bg-[var(--ak-signal-info)] text-black border-transparent font-bold"
                    : "bg-transparent text-[var(--ak-text-secondary)] border-[var(--ak-border-subtle)] hover:text-white"
                }`}
              >
                {preset.name}
              </button>
            );
          })}
          {customPresets.map((preset) => {
            const isActive = Object.entries(preset.params).every(([k, v]) => params[k] === v);
            return (
              <div
                key={preset.name}
                role="group"
                aria-label={`Custom preset ${preset.name}`}
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-mono border transition-all ${
                  isActive
                    ? "bg-[var(--ak-signal-action)] text-black border-transparent font-bold"
                    : "bg-[var(--ak-surface-sunken)] text-[var(--ak-text-primary)] border-[var(--ak-border-subtle)] hover:border-[var(--ak-signal-action)]"
                }`}
                title={`Custom preset: ${preset.name}`}
              >
                <button
                  type="button"
                  onClick={() => applyPreset(preset.name, preset.params)}
                  aria-pressed={isActive}
                  className="cursor-pointer focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--ak-signal-info)]"
                >
                  {preset.name}
                </button>
                <button
                  type="button"
                  onClick={() => deleteCustomPreset(preset.name)}
                  aria-label={`Delete custom preset ${preset.name}`}
                  className="hover:text-red-500 font-bold ml-0.5 text-[10px] leading-none opacity-60 hover:opacity-100"
                  title="Delete this custom preset"
                >
                  ×
                </button>
              </div>
            );
          })}
          {showSaveInput ? (
            <div className="inline-flex items-center gap-1 bg-[var(--ak-surface-sunken-2)] px-1 py-0.5 border border-[var(--ak-signal-info)]">
              <input
                type="text"
                placeholder="Preset name…"
                aria-label="Preset name (required)"
                required
                value={newPresetName}
                onChange={(e) => setNewPresetName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (canSavePreset) saveCustomPreset(newPresetName);
                  }
                  if (e.key === "Escape") setShowSaveInput(false);
                }}
                className="px-1 py-0 text-[9px] font-mono bg-transparent border-0 text-[var(--ak-text-primary)] outline-none w-20"
                autoFocus
              />
              <button
                type="button"
                onClick={() => saveCustomPreset(newPresetName)}
                disabled={!canSavePreset}
                className="px-1.5 py-0.5 text-[9px] font-mono bg-[var(--ak-signal-info)] text-black font-bold cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                title={canSavePreset ? "Save this custom preset" : "Enter a name to enable Save"}
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => setShowSaveInput(false)}
                className="px-1 py-0.5 text-[9px] font-mono text-[var(--ak-text-secondary)] hover:text-white cursor-pointer"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setShowSaveInput(true);
                setNewPresetName("");
              }}
              className="px-1.5 py-0.5 text-[9px] font-mono border border-dashed border-[var(--ak-border-subtle)] text-[var(--ak-signal-info)] hover:border-[var(--ak-signal-info)] hover:text-white transition-all cursor-pointer"
              title="Save current parameters as a custom preset"
            >
              + Save Preset
            </button>
          )}
        </div>

        {presetNotice && (
          <div className="text-[10px] text-[var(--ak-signal-info)] font-mono px-1 py-0.5 bg-[var(--ak-surface-sunken)] border-l-2 border-[var(--ak-signal-info)] animate-pulse">
            {presetNotice}
          </div>
        )}
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

      <div className="assumptions-heading text-[10px] font-bold text-[var(--ak-text-secondary)] uppercase tracking-wider pt-1 flex items-center justify-between border-b border-[var(--ak-border-subtle)] pb-1">
        <span>SIMULATION ASSUMPTIONS</span>
        <span className="text-[9px] font-mono text-[var(--ak-signal-info)]">DETERMINISTIC</span>
      </div>
      <div className="assumption-grid grid grid-cols-2 gap-2 bg-[var(--ak-surface-sunken)] p-2 border border-[var(--ak-border-subtle)]">
        <label className="flex flex-col gap-1">
          <span className="text-[9px] font-bold text-[var(--ak-text-secondary)] font-mono uppercase">INITIAL CAPITAL</span>
          <AkInput
            className="compact-input h-7 text-xs font-mono"
            type="number"
            min={100}
            step={1000}
            value={config.initialCapital}
            onChange={(event) => {
              const val = Number(event.target.value);
              if (Number.isFinite(val)) {
                setConfig({ ...config, initialCapital: Math.max(100, val) });
              }
            }}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[9px] font-bold text-[var(--ak-text-secondary)] font-mono uppercase">POSITION %</span>
          <AkInput
            className="compact-input h-7 text-xs font-mono"
            type="number"
            min={1}
            max={100}
            step={1}
            value={Math.round(config.positionFraction * 100)}
            onChange={(event) => {
              const val = Number(event.target.value);
              if (Number.isFinite(val)) {
                setConfig({ ...config, positionFraction: Math.max(0.01, Math.min(1, val / 100)) });
              }
            }}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[9px] font-bold text-[var(--ak-text-secondary)] font-mono uppercase">FEE (BPS)</span>
          <AkInput
            className="compact-input h-7 text-xs font-mono"
            type="number"
            min={0}
            max={500}
            step={1}
            value={Math.round(config.feeRate * 10_000)}
            onChange={(event) => {
              const val = Number(event.target.value);
              if (Number.isFinite(val)) {
                setConfig({ ...config, feeRate: Math.max(0, Math.min(0.05, val / 10_000)) });
              }
            }}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[9px] font-bold text-[var(--ak-text-secondary)] font-mono uppercase">SLIPPAGE (BPS)</span>
          <AkInput
            className="compact-input h-7 text-xs font-mono"
            type="number"
            min={0}
            max={500}
            step={1}
            value={Math.round(config.slippageRate * 10_000)}
            onChange={(event) => {
              const val = Number(event.target.value);
              if (Number.isFinite(val)) {
                setConfig({ ...config, slippageRate: Math.max(0, Math.min(0.05, val / 10_000)) });
              }
            }}
          />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-[10px] font-bold text-[var(--ak-text-secondary)] uppercase tracking-wider">
        <span>EXECUTION ACCOUNT</span>
        <AkSelect aria-label="Backtest account mode" value={config.accountMode ?? "spot"} onChange={(event) => setConfig({ ...config, accountMode: event.target.value as "spot" | "legacy-margin", allowShorts: false })} className="h-7 text-xs font-mono font-normal">
          <option value="spot">Spot · fee-inclusive sizing</option>
          <option value="legacy-margin">Legacy synthetic margin simulation</option>
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

      <div className="strategy-actions sticky bottom-0 bg-[var(--ak-surface-canvas)] flex flex-col gap-1.5 pt-2 pb-1 border-t border-[var(--ak-border-subtle)] z-10">
        <p className="assumption-note text-[10px] text-[var(--ak-text-secondary)] font-mono m-0 opacity-80 text-center">
          Runs on {EXCHANGE_LABELS[exchange]} · {symbol} · {timeframe}
        </p>

        <div className="grid grid-cols-2 gap-2 w-full">
          <Button
            data-testid="save-strategy-draft"
            variant="outline"
            size="sm"
            onClick={() => void saveSource()}
            icon={saved ? <Check size={13} className="text-[var(--ak-signal-success)]" /> : <Save size={13} />}
            className="w-full text-xs transition-transform active:scale-95"
            title="Save draft [⌘S]"
          >
            {saved ? "Saved" : "Save draft"}
          </Button>

          <Button
            variant="primary"
            size="sm"
            onClick={onRun}
            disabled={running || invalidSma}
            icon={running ? <Play size={13} className="spin" /> : <Play size={13} />}
            className="w-full text-xs font-bold transition-transform active:scale-95"
            title="Run backtest [B or ⌘↵]"
          >
            {running ? "Running" : "Run backtest"}
          </Button>
        </div>
      </div>
    </div>
  );
}
