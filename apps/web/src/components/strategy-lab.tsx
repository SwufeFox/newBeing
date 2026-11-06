"use client";

import { memo, useEffect, useMemo, useState } from "react";
import { Play, ShieldAlert, Sliders } from "lucide-react";
import { STRATEGIES, type StrategyParameters } from "@newbeing/core";
import { Button } from "@/components/ui/button";
import { EXCHANGE_LABELS } from "@/lib/exchanges";
import { useCopy, type CopyTable } from "@/lib/i18n";
import { PARAMETER_LABELS, STRATEGY_NAMES, STRATEGY_DESCRIPTIONS } from "@/lib/strategy-labels";
import { useWorkspaceStore } from "@/store/workspace";
import { useShallow } from "zustand/react/shallow";
import { AkSelect, AkChoice, AkTag, AkNotice, AkField, AkFieldLabel, AkInput } from "@swufefox/ak-ui-react";

interface StrategyLabProps {
  onRun: () => void;
  running: boolean;
}

interface StrategyLabCopy {
  empty: string;
  template: string;
  executable: string;
  tunable: string;
  resetDefaults: string;
  resetDefaultsTitle: string;
  presetBar: string;
  defaultPreset: string;
  presetLabels: Record<string, string>;
  presetSaved: (name: string) => string;
  presetDeleted: (name: string) => string;
  presetLoaded: (name: string) => string;
  presetReset: string;
  customPresetGroup: (name: string) => string;
  customPresetTitle: (name: string) => string;
  customPresetDelete: (name: string) => string;
  customPresetDeleteTitle: string;
  presetNamePlaceholder: string;
  presetNameLabel: string;
  presetSaveTitle: string;
  presetSaveDisabledTitle: string;
  save: string;
  cancel: string;
  savePreset: string;
  savePresetTitle: string;
  invalidSma: string;
  assumptions: string;
  deterministic: string;
  parameters: Record<string, string>;
  initialCapital: string;
  positionFraction: string;
  highAllocation: (percent: number) => string;
  allocationShare: string;
  fee: string;
  slippage: string;
  executionAccount: string;
  accountModeLabel: string;
  accountSpot: string;
  accountLegacy: string;
  allowShorts: string;
  legacyNote: string;
  spotNote: string;
  runsOn: string;
  running: string;
  runBacktest: string;
  runBacktestTitle: string;
}

const STRATEGY_LAB_COPY: CopyTable<StrategyLabCopy> = {
  en: {
    empty: "No built-in strategy is available.",
    template: "STRATEGY TEMPLATE",
    executable: "EXECUTABLE",
    tunable: "TUNABLE PARAMETERS",
    resetDefaults: "Reset Defaults",
    resetDefaultsTitle: "Reset parameters to factory defaults",
    presetBar: "PRESET:",
    defaultPreset: "Default",
    presetLabels: {
      Aggressive: "Aggressive",
      Conservative: "Conservative",
      Sensitive: "Sensitive",
      Extreme: "Extreme",
      "Short-term": "Short-term",
      "High-conviction": "High-conviction",
    },
    presetSaved: (name) => `Saved preset '${name}'`,
    presetDeleted: (name) => `Deleted preset '${name}'`,
    presetLoaded: (name) => `Loaded '${name}' preset`,
    presetReset: "Reset to defaults",
    customPresetGroup: (name) => `Custom preset ${name}`,
    customPresetTitle: (name) => `Custom preset: ${name}`,
    customPresetDelete: (name) => `Delete custom preset ${name}`,
    customPresetDeleteTitle: "Delete this custom preset",
    presetNamePlaceholder: "Preset name…",
    presetNameLabel: "Preset name (required)",
    presetSaveTitle: "Save this custom preset",
    presetSaveDisabledTitle: "Enter a name to enable Save",
    save: "Save",
    cancel: "Cancel",
    savePreset: "+ Save Preset",
    savePresetTitle: "Save current parameters as a custom preset",
    invalidSma: "Fast period must be lower than slow period.",
    assumptions: "SIMULATION ASSUMPTIONS",
    deterministic: "DETERMINISTIC",
    parameters: { ...PARAMETER_LABELS.en },
    initialCapital: "INITIAL CAPITAL",
    positionFraction: "POSITION %",
    highAllocation: (percent) => `High allocation · ${percent}% of available cash per entry.`,
    allocationShare: "Share of available cash used per entry.",
    fee: "FEE (BPS)",
    slippage: "SLIPPAGE (BPS)",
    executionAccount: "EXECUTION ACCOUNT",
    accountModeLabel: "Backtest account mode",
    accountSpot: "Spot · fee-inclusive sizing",
    accountLegacy: "Legacy synthetic margin simulation",
    allowShorts: "Allow synthetic shorts (no borrow/funding model)",
    legacyNote: "Historical synthetic model; no native derivative contract, margin, liquidation or funding simulation.",
    spotNote: "Spot inventory and quote fees; budget includes entry fee. Opening gaps precede opening orders; entry-bar targets are deferred.",
    runsOn: "Runs on",
    running: "Running",
    runBacktest: "Run backtest",
    runBacktestTitle: "Run backtest [B or ⌘↵]",
  },
  zh: {
    empty: "暂无内置策略。",
    template: "策略模板",
    executable: "可执行",
    tunable: "可调参数",
    resetDefaults: "恢复默认",
    resetDefaultsTitle: "将参数恢复为出厂默认值",
    presetBar: "预设：",
    defaultPreset: "默认",
    presetLabels: {
      Aggressive: "激进",
      Conservative: "稳健",
      Sensitive: "敏感",
      Extreme: "极端",
      "Short-term": "短线",
      "High-conviction": "高确信",
    },
    presetSaved: (name) => `已保存预设“${name}”`,
    presetDeleted: (name) => `已删除预设“${name}”`,
    presetLoaded: (name) => `已加载“${name}”预设`,
    presetReset: "已恢复默认值",
    customPresetGroup: (name) => `自定义预设 ${name}`,
    customPresetTitle: (name) => `自定义预设：${name}`,
    customPresetDelete: (name) => `删除自定义预设 ${name}`,
    customPresetDeleteTitle: "删除这个自定义预设",
    presetNamePlaceholder: "预设名称…",
    presetNameLabel: "预设名称（必填）",
    presetSaveTitle: "保存这个自定义预设",
    presetSaveDisabledTitle: "输入名称后才能保存",
    save: "保存",
    cancel: "取消",
    savePreset: "+ 保存预设",
    savePresetTitle: "将当前参数保存为自定义预设",
    invalidSma: "快线周期必须小于慢线周期。",
    assumptions: "模拟假设",
    deterministic: "确定性",
    parameters: { ...PARAMETER_LABELS.zh },
    initialCapital: "初始资金",
    positionFraction: "仓位比例 %",
    highAllocation: (percent) => `高仓位 · 每次开仓占可用资金 ${percent}%。`,
    allocationShare: "每次开仓占可用资金的比例。",
    fee: "费率 (BPS)",
    slippage: "滑点率 (BPS)",
    executionAccount: "执行账户",
    accountModeLabel: "回测账户模式",
    accountSpot: "现货 · 含手续费计算规模",
    accountLegacy: "旧版合成保证金模拟",
    allowShorts: "允许合成做空（不模拟借币与资金费率）",
    legacyNote: "历史合成模型；不模拟原生衍生品合约、保证金、强平与资金费率。",
    spotNote: "现货库存与报价手续费；预算已包含开仓手续费。开盘跳空先于开仓委托处理；入场 K 线的目标价延后执行。",
    runsOn: "运行于",
    running: "运行中",
    runBacktest: "运行回测",
    runBacktestTitle: "运行回测 [B 或 ⌘↵]",
  },
};

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

function parameterLabel(copy: StrategyLabCopy, key: string): string {
  return copy.parameters[key] ?? key.replace(/([A-Z])/g, " $1").replace(/^./, (first) => first.toUpperCase());
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

export const StrategyLab = memo(function StrategyLab({ onRun, running }: StrategyLabProps): React.JSX.Element {
  const copy = useCopy(STRATEGY_LAB_COPY);
  const strategyNames = useCopy(STRATEGY_NAMES);
  const strategyDescriptions = useCopy(STRATEGY_DESCRIPTIONS);
  const [strategyId, setStrategyId, params, setParams, config, setConfig] = useWorkspaceStore(useShallow((state) => [
    state.selectedStrategyId,
    state.setStrategy,
    state.strategyParameters,
    state.setStrategyParameters,
    state.backtestConfig,
    state.setBacktestConfig,
  ]));
  const exchange = useWorkspaceStore((state) => state.exchange);
  const symbol = useWorkspaceStore((state) => state.symbol);
  const timeframe = useWorkspaceStore((state) => state.timeframe);
  const strategy = STRATEGIES.find((item) => item.id === strategyId) ?? STRATEGIES[0];
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
    setPresetNotice(copy.presetSaved(copy.presetLabels[trimmed] ?? trimmed));
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
    setPresetNotice(copy.presetDeleted(copy.presetLabels[name] ?? name));
    window.setTimeout(() => setPresetNotice(null), 2200);
  };

  const [selectedPresetName, setSelectedPresetName] = useState<string | null>("default");

  const isDefault = useMemo(() => {
    if (!strategy) return true;
    return Object.entries(strategy.defaults).every(([k, v]) => params[k] === v);
  }, [strategy, params]);

  useEffect(() => {
    setSelectedPresetName((current) => {
      if (current === "default") {
        const matchesDefault = strategy && Object.entries(strategy.defaults).every(([k, v]) => params[k] === v);
        return matchesDefault ? "default" : null;
      }
      if (current && strategy) {
        const allPresets = [...(BUILTIN_PRESETS[strategy.id] ?? []), ...customPresets];
        const target = allPresets.find((p) => p.name === current);
        if (target && Object.entries(target.params).every(([k, v]) => params[k] === v)) return current;
      }
      if (strategy && Object.entries(strategy.defaults).every(([k, v]) => params[k] === v)) return "default";
      return null;
    });
  }, [params, strategy, customPresets]);

  const applyPreset = (name: string, nextParams: StrategyParameters): void => {
    if (!strategy) return;
    setSelectedPresetName(name);
    setParams({ ...strategy.defaults, ...nextParams });
    setPresetNotice(copy.presetLoaded(copy.presetLabels[name] ?? name));
    window.setTimeout(() => setPresetNotice(null), 2200);
  };

  const resetDefaults = (): void => {
    if (!strategy) return;
    setSelectedPresetName("default");
    setParams({ ...strategy.defaults });
    setPresetNotice(copy.presetReset);
    window.setTimeout(() => setPresetNotice(null), 2200);
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

  if (!strategy) return <div className="empty-panel p-4 font-mono text-xs">{copy.empty}</div>;

  const invalidSma = strategy.id === "sma-crossover"
    && typeof params.fastPeriod === "number" && typeof params.slowPeriod === "number"
    && params.fastPeriod >= params.slowPeriod;

  return (
    <div className="strategy-lab flex flex-col gap-3 p-3 bg-[var(--ak-surface-canvas)]">
      <div className="strategy-toolbar flex items-center justify-between gap-2 border-b border-[var(--ak-border-subtle)] pb-2">
        <label className="field-label text-xs font-semibold text-[var(--ak-text-secondary)] tracking-normal" htmlFor="strategy-select">
          {copy.template}
        </label>
        <AkSelect
          id="strategy-select"
          className="select-input font-bold text-xs"
          value={strategy.id}
          onChange={(event) => updateStrategy(event.target.value)}
        >
          {STRATEGIES.map((item) => (
            <option key={item.id} value={item.id}>
              {strategyNames[item.id] ?? item.name}
            </option>
          ))}
        </AkSelect>
      </div>

      <div className="strategy-description bg-[var(--ak-surface-sunken)] p-2.5 border border-[var(--ak-border-subtle)] border-l-2 border-l-[var(--c-line-strong)]" data-testid="executable-strategy">
        <div className="flex items-center gap-2 mb-1">
          <strong className="text-xs font-mono text-[var(--ak-text-primary)]">
            <span className="text-[var(--c-accent)] font-bold">{copy.executable}</span> · {strategy.id}@{strategy.version}
          </strong>
        </div>
        <p className="text-xs text-[var(--ak-text-secondary)] leading-relaxed m-0">
          {strategy.executionSummary?.(params) ?? strategyDescriptions[strategy.id] ?? strategy.description}
        </p>
      </div>

      <div className="strategy-params space-y-2 bg-[var(--ak-surface-sunken-2)] p-2.5 border border-[var(--ak-border-subtle)]">
        <div className="flex items-center justify-between pb-1 border-b border-[var(--ak-border-subtle)]">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--c-fg-2)] tracking-normal">
            <Sliders size={12} className="text-[var(--ak-text-secondary)]" />
            <span>{copy.tunable}</span>
          </div>
          <button
            type="button"
            onClick={resetDefaults}
            disabled={isDefault}
            className="text-[10px] font-mono text-[var(--ak-text-secondary)] hover:text-white underline cursor-pointer disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed transition-colors"
            title={copy.resetDefaultsTitle}
          >
            {copy.resetDefaults}
          </button>
        </div>

        <div className="preset-bar space-y-1.5 py-0.5">
          <div className="flex items-center justify-between text-[10px] text-[var(--c-fg-3)]">
            <span className="font-semibold text-[10px] uppercase tracking-wider text-[var(--c-fg-4)]">{copy.presetBar}</span>
            {!showSaveInput && (
              <button
                type="button"
                onClick={() => {
                  setShowSaveInput(true);
                  setNewPresetName("");
                }}
                className="text-[10px] text-[var(--c-accent)] hover:underline cursor-pointer transition-colors"
                title={copy.savePresetTitle}
              >
                {copy.savePreset}
              </button>
            )}
          </div>

          <div className="flex items-center flex-wrap gap-1.5">
            <button
              type="button"
              onClick={resetDefaults}
              className={`px-2 py-0.5 text-[10px] font-mono border rounded-xs transition-all cursor-pointer ${
                selectedPresetName === "default"
                  ? "bg-[var(--ak-surface-raised)] text-[var(--ak-text-primary)] border-[var(--ak-signal-info)] font-semibold shadow-xs"
                  : "bg-transparent text-[var(--ak-text-secondary)] border-[var(--ak-border-subtle)] hover:text-white hover:border-[var(--ak-border-strong)]"
              }`}
            >
              {copy.defaultPreset}
            </button>
            {BUILTIN_PRESETS[strategy.id]?.map((preset) => (
              <button
                key={preset.name}
                type="button"
                onClick={() => applyPreset(preset.name, preset.params)}
                className={`px-2 py-0.5 text-[10px] font-mono border rounded-xs transition-all cursor-pointer ${
                  selectedPresetName === preset.name
                    ? "bg-[var(--ak-surface-raised)] text-[var(--ak-text-primary)] border-[var(--ak-signal-info)] font-semibold shadow-xs"
                    : "bg-transparent text-[var(--ak-text-secondary)] border-[var(--ak-border-subtle)] hover:text-white hover:border-[var(--ak-border-strong)]"
                }`}
              >
                {copy.presetLabels[preset.name] ?? preset.name}
              </button>
            ))}
            {customPresets.map((preset) => (
              <div
                key={preset.name}
                role="group"
                aria-label={copy.customPresetGroup(copy.presetLabels[preset.name] ?? preset.name)}
                className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono border rounded-xs transition-all ${
                  selectedPresetName === preset.name
                    ? "bg-[var(--ak-surface-raised)] text-[var(--ak-text-primary)] border-[var(--c-accent)] font-semibold shadow-xs"
                    : "bg-[var(--ak-surface-sunken)] text-[var(--ak-text-primary)] border-[var(--ak-border-subtle)] hover:border-[var(--ak-border-strong)]"
                }`}
                title={copy.customPresetTitle(copy.presetLabels[preset.name] ?? preset.name)}
              >
                <button
                  type="button"
                  onClick={() => applyPreset(preset.name, preset.params)}
                  aria-pressed={selectedPresetName === preset.name}
                  className="cursor-pointer focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--ak-signal-info)]"
                >
                  {copy.presetLabels[preset.name] ?? preset.name}
                </button>
                <button
                  type="button"
                  onClick={() => deleteCustomPreset(preset.name)}
                  aria-label={copy.customPresetDelete(copy.presetLabels[preset.name] ?? preset.name)}
                  className="hover:text-red-500 font-bold ml-0.5 text-[10px] leading-none opacity-60 hover:opacity-100"
                  title={copy.customPresetDeleteTitle}
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          {showSaveInput && (
            <div className="inline-flex items-center gap-1.5 bg-[var(--ak-surface-sunken-2)] px-2 py-1 border border-[var(--c-accent)] rounded-xs mt-1">
              <input
                type="text"
                placeholder={copy.presetNamePlaceholder}
                aria-label={copy.presetNameLabel}
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
                className="px-1 py-0 text-xs font-mono bg-transparent border-0 text-[var(--ak-text-primary)] outline-none w-28"
                autoFocus
              />
              <button
                type="button"
                onClick={() => saveCustomPreset(newPresetName)}
                disabled={!canSavePreset}
                className="px-2 py-0.5 text-[10px] font-mono bg-[var(--c-accent)] text-black font-bold rounded-xs cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                title={canSavePreset ? copy.presetSaveTitle : copy.presetSaveDisabledTitle}
              >
                {copy.save}
              </button>
              <button
                type="button"
                onClick={() => setShowSaveInput(false)}
                className="px-1.5 py-0.5 text-[10px] font-mono text-[var(--ak-text-secondary)] hover:text-white cursor-pointer"
              >
                {copy.cancel}
              </button>
            </div>
          )}
        </div>

        {presetNotice && (
          <div role="status" className="text-[10px] text-[var(--c-accent)] font-mono px-2 py-1 bg-[var(--c-surface-3)] border border-[var(--ak-border-subtle)] border-l-2 border-l-[var(--c-accent)] rounded-xs">
            {presetNotice}
          </div>
        )}
        {parameterEntries.map(([key, defaultValue]) => {
          const value = params[key] ?? defaultValue;
          const invalidSmaField = invalidSma && (key === "fastPeriod" || key === "slowPeriod");
          const inputId = `strategy-parameter-${key}`;
          if (typeof defaultValue === "boolean") {
            return (
              <div className="toggle-row flex items-center justify-between py-1" key={key}>
                <label htmlFor={inputId} className="text-xs text-[var(--ak-text-primary)]">{parameterLabel(copy, key)}</label>
                <AkChoice
                  variant="switch"
                  id={inputId}
                  checked={Boolean(value)}
                  onChange={(event) => updateParameter(key, event.target.checked)}
                />
              </div>
            );
          }
          return (
            <div className="param-row flex items-center justify-between gap-2 py-1" key={key}>
              <label htmlFor={inputId} className="text-xs text-[var(--ak-text-primary)]">{parameterLabel(copy, key)}</label>
              <AkInput
                className="compact-input w-24 h-7 text-xs font-mono text-right"
                id={inputId}
                type="number"
                min={0}
                max={1000}
                step={key.toLowerCase().includes("pct") ? 0.1 : 1}
                aria-invalid={invalidSmaField || undefined}
                aria-describedby={invalidSmaField ? "strategy-sma-validation" : undefined}
                value={typeof value === "number" ? value : defaultValue}
                onChange={(event) => updateParameter(key, Number(event.target.value))}
              />
            </div>
          );
        })}
        {invalidSma && (
          <div id="strategy-sma-validation" role="alert" className="inline-alert flex items-center gap-1.5 text-[11px] text-[var(--ak-signal-danger)] p-1.5 bg-red-950/20 border border-red-800/40">
            <ShieldAlert size={13} />
            <span>{copy.invalidSma}</span>
          </div>
        )}
      </div>

      <div className="assumptions-heading text-[10px] font-bold text-[var(--ak-text-secondary)] uppercase tracking-wider pt-1 flex items-center justify-between border-b border-[var(--ak-border-subtle)] pb-1">
        <span>{copy.assumptions}</span>
        <span className="text-[10px] font-mono text-[var(--ak-signal-info)]">{copy.deterministic}</span>
      </div>
      <div className="assumption-grid grid grid-cols-2 gap-2 bg-[var(--ak-surface-sunken)] p-2 border border-[var(--ak-border-subtle)]">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-bold text-[var(--ak-text-secondary)] font-mono uppercase">{copy.initialCapital}</span>
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
        <div className="flex flex-col gap-1">
          <label htmlFor="position-fraction-input" className="text-[10px] font-bold text-[var(--ak-text-secondary)] font-mono uppercase">{copy.positionFraction}</label>
          <AkInput
            className="compact-input h-7 text-xs font-mono"
            id="position-fraction-input"
            aria-describedby="position-allocation-description"
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
          <span
            id="position-allocation-description"
            className={`text-[10px] leading-tight ${config.positionFraction >= 0.9 ? "text-[var(--ak-signal-action)]" : "text-[var(--ak-text-secondary)]"}`}
          >
            {config.positionFraction >= 0.9
              ? copy.highAllocation(Math.round(config.positionFraction * 100))
              : copy.allocationShare}
          </span>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-bold text-[var(--ak-text-secondary)] font-mono uppercase">{copy.fee}</span>
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
          <span className="text-[10px] font-bold text-[var(--ak-text-secondary)] font-mono uppercase">{copy.slippage}</span>
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
      <label className="flex flex-col gap-1 text-xs font-medium text-[var(--ak-text-secondary)] tracking-normal">
        <span>{copy.executionAccount}</span>
        <AkSelect aria-label={copy.accountModeLabel} value={config.accountMode ?? "spot"} onChange={(event) => setConfig({ ...config, accountMode: event.target.value as "spot" | "legacy-margin", allowShorts: false })} className="h-7 text-xs font-mono font-normal">
          <option value="spot">{copy.accountSpot}</option>
          <option value="legacy-margin">{copy.accountLegacy}</option>
        </AkSelect>
      </label>
      {config.accountMode === "legacy-margin" && <label className="flex gap-2 text-xs"><input type="checkbox" checked={config.allowShorts} onChange={(event) => setConfig({ ...config, allowShorts: event.target.checked })} />{copy.allowShorts}</label>}
      <p className="assumption-note text-[10px] text-[var(--ak-text-secondary)] opacity-70 m-0">
        {config.accountMode === "legacy-margin" ? copy.legacyNote : copy.spotNote}
      </p>

      <div className="strategy-actions sticky bottom-0 bg-[var(--ak-surface-canvas)] flex flex-col gap-1.5 pt-2 pb-1 border-t border-[var(--ak-border-subtle)] z-10">
        <p className="assumption-note text-[10px] text-[var(--ak-text-secondary)] font-mono m-0 opacity-80 text-center">
          {copy.runsOn} {EXCHANGE_LABELS[exchange]} · {symbol} · {timeframe}
        </p>

        <Button
          variant="primary"
          size="sm"
          onClick={onRun}
          disabled={running || invalidSma}
          icon={running ? <Play size={13} className="spin" /> : <Play size={13} />}
          className="w-full text-xs font-semibold py-1.5 transition-transform active:scale-95"
          title={copy.runBacktestTitle}
        >
          {running ? copy.running : copy.runBacktest}
        </Button>
      </div>
    </div>
  );
});
