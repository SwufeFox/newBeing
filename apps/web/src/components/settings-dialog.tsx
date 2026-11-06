"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AkDialog, AkSpinner, AkTag } from "@swufefox/ak-ui-react";
import { DEFAULT_PREFERENCES, setPreferences, usePreferences, type ColorVisionMode, type UiLocale } from "@/lib/preferences";
import { EXCHANGE_IDS, EXCHANGE_LABELS, symbolForExchange } from "@/lib/exchanges";
import { CHART_PALETTES } from "@/lib/chart-palette";
import { useCopy } from "@/lib/i18n";
import { useWorkspaceStore } from "@/store/workspace";
import type { ExchangeId } from "@newbeing/core";

const SETTINGS_COPY = {
  en: {
    eyebrow: "SYSTEM // PRTS CONFIGURATION",
    title: "WORKSTATION SETTINGS",
    close: "CLOSE [ESC]",
    reset: "RESET PREFERENCES",
    language: "LANGUAGE",
    languageHint: "Interface copy is stored on this device. Market data, strategy names and result provenance stay in their source language.",
    english: "English",
    chinese: "简体中文",
    colourVision: "COLOUR VISION",
    colourVisionHint: "Swap the red/green direction ramp for a blue/orange one. Arrows, signs and labels still carry the direction on their own.",
    standard: "Standard",
    standardHint: "Green up · red down",
    deuteranopia: "Deuteranopia",
    deuteranopiaHint: "Blue up · orange down",
    sampleUp: "UP",
    sampleDown: "DOWN",
    connectors: "MARKET DATA CONNECTORS",
    connectorsHint: "Public exchange endpoints. No key, account or private endpoint is involved; Paper accounts are local.",
    active: "ACTIVE",
    use: "USE",
    inUse: "IN USE",
    useConnector: (name: string) => `Use ${name}`,
    connectorInUse: (name: string) => `${name} is in use`,
    replayLocked: "Frozen Replay owns the venue and instrument. Finish or exit Replay to switch venue.",
    probe: "PROBE",
    probing: "PROBING",
    probeConnector: (name: string, symbol: string) => `Probe ${name} for ${symbol}`,
    probingSymbol: (symbol: string) => `Checking ${symbol}…`,
    capabilities: "CAPABILITIES",
    paperOnly: "PAPER ONLY",
    connectorsUnavailable: "Connector metadata is unavailable.",
    retryConnectors: "Retry connectors",
    loadingConnectors: "READING CONNECTORS",
    noConnectors: "No connector metadata returned.",
    apiTitle: "LOCAL API BOUNDARY",
    apiPublic: "Market data: public exchange REST/WebSocket endpoints. No API key is requested or stored.",
    apiAi: "AI access: your MCP client runs `pnpm mcp` over local stdio. Model provider keys belong to that client; newBeing stores none and opens no MCP listener.",
    apiPaper: "Execution: Paper only. There is no live order route and no exchange credential handling.",
    currentVenue: "Current venue",
    resetLayout: "RESET LAYOUT",
  },
  zh: {
    eyebrow: "系统 // PRTS 配置",
    title: "工作台设置",
    close: "关闭 [ESC]",
    reset: "重置偏好",
    language: "界面语言",
    languageHint: "界面文案保存在本机。行情、策略名称与结果来源保持其原始语言。",
    english: "English",
    chinese: "简体中文",
    colourVision: "色觉辅助",
    colourVisionHint: "把红绿涨跌配色换成蓝橙配色。涨跌方向仍由箭头、正负号与文字独立表达。",
    standard: "标准配色",
    standardHint: "绿涨 · 红跌",
    deuteranopia: "红绿色弱",
    deuteranopiaHint: "蓝涨 · 橙跌",
    sampleUp: "涨",
    sampleDown: "跌",
    connectors: "行情数据连接器",
    connectorsHint: "仅使用交易所公开接口，不涉及密钥、账户或私有端点；模拟盘账户保存在本机。",
    active: "当前",
    use: "使用",
    inUse: "使用中",
    useConnector: (name: string) => `使用 ${name}`,
    connectorInUse: (name: string) => `正在使用 ${name}`,
    replayLocked: "冻结回放固定了交易所与标的。结束或退出回放后才能切换。",
    probe: "探测",
    probing: "探测中",
    probeConnector: (name: string, symbol: string) => `探测 ${name} 的 ${symbol}`,
    probingSymbol: (symbol: string) => `正在检查 ${symbol}…`,
    capabilities: "能力",
    paperOnly: "仅模拟盘",
    connectorsUnavailable: "连接器元数据不可用。",
    retryConnectors: "重试连接器",
    loadingConnectors: "读取连接器",
    noConnectors: "未返回任何连接器元数据。",
    apiTitle: "本地 API 边界",
    apiPublic: "行情：交易所公开 REST/WebSocket 接口，不需要也不保存任何 API 密钥。",
    apiAi: "AI 接入：由你的 MCP 客户端通过本地 stdio 运行 `pnpm mcp`。模型服务密钥属于该客户端；newBeing 不保存密钥，也不开放 MCP 监听端口。",
    apiPaper: "执行：仅模拟盘。不存在实盘下单通道，也不处理交易所凭证。",
    currentVenue: "当前交易所",
    resetLayout: "重置布局",
  },
};

interface ConnectorView {
  id: ExchangeId;
  name: string;
  timeframes: readonly string[];
  capabilities: Readonly<Record<string, boolean | "emulated">>;
}

type ProbeState = { symbol: string; requestId: number } & (
  | { status: "loading" }
  | { status: "ok"; detail: string }
  | { status: "error"; detail: string }
);

const CAPABILITY_ORDER: readonly [string, string][] = [
  ["fetchOHLCV", "OHLCV"],
  ["fetchTicker", "TICKER"],
  ["fetchTickers", "BATCH"],
  ["fetchOrderBook", "BOOK"],
  ["fetchTrades", "TRADES"],
];

/** Reject anything the connector route did not actually describe. */
function readConnectors(payload: unknown): ConnectorView[] {
  if (typeof payload !== "object" || payload === null || !("connectors" in payload)) return [];
  const raw: unknown = payload.connectors;
  if (!Array.isArray(raw)) return [];
  const items: ConnectorView[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null || !("id" in entry)) continue;
    const id: unknown = entry.id;
    if (typeof id !== "string" || !EXCHANGE_IDS.includes(id as ExchangeId)) continue;
    const name = "name" in entry && typeof entry.name === "string" && entry.name ? entry.name : EXCHANGE_LABELS[id as ExchangeId];
    const rawTimeframes: unknown = "timeframes" in entry ? entry.timeframes : null;
    const timeframes = Array.isArray(rawTimeframes)
      ? rawTimeframes.filter((item: unknown): item is string => typeof item === "string")
      : [];
    const capabilities: Record<string, boolean | "emulated"> = {};
    if ("capabilities" in entry && typeof entry.capabilities === "object" && entry.capabilities !== null) {
      for (const [key, value] of Object.entries(entry.capabilities)) {
        if (value === true || value === false || value === "emulated") capabilities[key] = value;
      }
    }
    items.push({ id: id as ExchangeId, name, timeframes, capabilities });
  }
  return items;
}

interface ProbeInstrument {
  id?: unknown;
  nativeId?: unknown;
  precision?: { price?: unknown; amount?: unknown } | null;
  limits?: { amount?: { min?: unknown } | null; cost?: { min?: unknown } | null } | null;
}

function probeDetail(instrument: ProbeInstrument, symbol: string): string {
  const parts: string[] = [];
  const nativeId = typeof instrument.nativeId === "string" ? instrument.nativeId : instrument.id;
  if (typeof nativeId === "string" && nativeId && nativeId !== symbol) parts.push(nativeId);
  const price = instrument.precision?.price;
  const amount = instrument.precision?.amount;
  if (typeof price === "number" && typeof amount === "number") parts.push(`P${price}·Q${amount}`);
  const minimumCost = instrument.limits?.cost?.min;
  if (typeof minimumCost === "number" && minimumCost > 0) parts.push(`MIN ${minimumCost}`);
  return parts.join(" · ") || "OK";
}

export function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }): React.JSX.Element {
  const copy = useCopy(SETTINGS_COPY);
  const { locale, colorVision } = usePreferences();
  const exchange = useWorkspaceStore((state) => state.exchange);
  const symbol = useWorkspaceStore((state) => state.symbol);
  const setExchange = useWorkspaceStore((state) => state.setExchange);
  const setLayout = useWorkspaceStore((state) => state.setLayout);
  /* A frozen Replay owns the venue and symbol; the server rejects a workspace
     rebind and the UI must not offer it. */
  const replayLocked = useWorkspaceStore((state) => state.activeWorkspace === "replay");
  const [connectors, setConnectors] = useState<ConnectorView[] | null>(null);
  const [connectorError, setConnectorError] = useState<string | null>(null);
  const [connectorRetry, setConnectorRetry] = useState(0);
  const [probes, setProbes] = useState<Record<string, ProbeState>>({});
  const probeRequestId = useRef(0);

  useEffect(() => {
    setProbes({});
  }, [symbol]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setConnectorError(null);
    void (async () => {
      try {
        const response = await fetch("/api/connectors", { cache: "no-store" });
        if (!response.ok) throw new Error(String(response.status));
        const payload: unknown = await response.json();
        if (alive) setConnectors(readConnectors(payload));
      } catch {
        if (alive) {
          setConnectors(null);
          setConnectorError(copy.connectorsUnavailable);
        }
      }
    })();
    return () => { alive = false; };
  }, [open, copy.connectorsUnavailable, connectorRetry]);

  const resetLayout = useCallback((): void => {
    setLayout({ watchlistWidth: 210, inspectorWidth: 320, bottomHeight: 190 });
  }, [setLayout]);

  const probe = useCallback(async (id: ExchangeId): Promise<void> => {
    const requestSymbol = symbolForExchange(symbol, id);
    const requestId = ++probeRequestId.current;
    setProbes((previous) => ({ ...previous, [id]: { status: "loading", symbol: requestSymbol, requestId } }));
    try {
      const response = await fetch(`/api/connectors?venue=${id}&symbol=${encodeURIComponent(requestSymbol)}`, { cache: "no-store" });
      const payload: unknown = await response.json();
      const message = typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error === "string"
        ? payload.error
        : null;
      if (!response.ok || message !== null) throw new Error(message ?? String(response.status));
      const instrument = typeof payload === "object" && payload !== null && "instrument" in payload
        ? payload.instrument as ProbeInstrument
        : null;
      if (instrument === null) throw new Error("No instrument metadata returned.");
      setProbes((previous) => previous[id]?.requestId === requestId
        ? { ...previous, [id]: { status: "ok", detail: probeDetail(instrument, requestSymbol), symbol: requestSymbol, requestId } }
        : previous);
    } catch (error) {
      setProbes((previous) => previous[id]?.requestId === requestId
        ? { ...previous, [id]: { status: "error", detail: error instanceof Error ? error.message : "Probe failed.", symbol: requestSymbol, requestId } }
        : previous);
    }
  }, [symbol]);

  const languageOption = (value: UiLocale, label: string): React.JSX.Element => (
    <button
      type="button"
      className="settings-option"
      aria-pressed={locale === value}
      onClick={() => setPreferences({ locale: value })}
    >
      <span className="settings-option-mark" aria-hidden="true">{locale === value ? "■" : "□"}</span>
      <span>{label}</span>
    </button>
  );

  const colourOption = (value: ColorVisionMode, label: string, hint: string): React.JSX.Element => {
    const palette = CHART_PALETTES[value];
    return (
      <button
        type="button"
        className="settings-option settings-option-stacked"
        aria-pressed={colorVision === value}
        onClick={() => setPreferences({ colorVision: value })}
      >
        <span className="settings-option-head">
          <span className="settings-option-mark" aria-hidden="true">{colorVision === value ? "■" : "□"}</span>
          <span>{label}</span>
        </span>
        <span className="settings-swatch" aria-hidden="true">
          <span style={{ color: palette.up }}>▲ {copy.sampleUp}</span>
          <span style={{ color: palette.down }}>▼ {copy.sampleDown}</span>
        </span>
        <span className="settings-option-hint">{hint}</span>
      </button>
    );
  };

  return (
    <AkDialog
      open={open}
      aria-label={copy.title}
      onOpenChange={onOpenChange}
      eyebrow={copy.eyebrow}
      title={copy.title}
      size="lg"
      tokens={{ "--ak-dialog-w": "46rem" }}
      className="font-mono text-xs"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2 w-full text-[10px] text-[var(--ak-text-secondary)] font-mono">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="settings-inline-button" onClick={resetLayout}>
              {copy.resetLayout}
            </button>
            <button type="button" className="settings-inline-button" onClick={() => setPreferences(DEFAULT_PREFERENCES)}>
              {copy.reset}
            </button>
          </div>
          <button type="button" className="settings-inline-button" onClick={() => onOpenChange(false)}>
            {copy.close}
          </button>
        </div>
      }
    >
      <div className="grid gap-4 pt-1 lg:grid-cols-2">
        <section className="settings-section" aria-labelledby="settings-language">
          <h3 id="settings-language" className="settings-section-title">{copy.language}</h3>
          <div className="settings-option-row" role="group" aria-labelledby="settings-language">
            {languageOption("en", copy.english)}
            {languageOption("zh", copy.chinese)}
          </div>
          <p className="settings-note">{copy.languageHint}</p>
        </section>

        <section className="settings-section" aria-labelledby="settings-colour">
          <h3 id="settings-colour" className="settings-section-title">{copy.colourVision}</h3>
          <div className="settings-option-row" role="group" aria-labelledby="settings-colour">
            {colourOption("default", copy.standard, copy.standardHint)}
            {colourOption("deuteranopia", copy.deuteranopia, copy.deuteranopiaHint)}
          </div>
          <p className="settings-note">{copy.colourVisionHint}</p>
        </section>

        <section className="settings-section lg:col-span-2" aria-labelledby="settings-connectors">
          <h3 id="settings-connectors" className="settings-section-title">
            {copy.connectors}
            <span className="settings-section-meta">{copy.currentVenue}: {EXCHANGE_LABELS[exchange]} · {symbol}</span>
          </h3>
          <p className="settings-note">{copy.connectorsHint}</p>

          {connectorError !== null && <div className="settings-connector-actions">
            <p role="alert" className="settings-note settings-note-error">{connectorError}</p>
            <button type="button" className="settings-inline-button" onClick={() => setConnectorRetry((value) => value + 1)}>{copy.retryConnectors}</button>
          </div>}
          {connectorError === null && connectors === null && (
            <p className="settings-note flex items-center gap-2"><AkSpinner color="#18d1ff" label={copy.loadingConnectors} />{copy.loadingConnectors}…</p>
          )}
          {connectorError === null && connectors !== null && connectors.length === 0 && <p className="settings-note">{copy.noConnectors}</p>}

          <ul className="settings-connector-list">
            {(connectors ?? []).map((connector) => {
              const requestSymbol = symbolForExchange(symbol, connector.id);
              const savedProbe = probes[connector.id];
              const probeState = savedProbe?.symbol === requestSymbol ? savedProbe : undefined;
              const inUse = connector.id === exchange;
              return (
                <li key={connector.id} className="settings-connector">
                  <div className="settings-connector-head">
                    <span className="settings-connector-name">{connector.name}</span>
                    {inUse && <AkTag variant="default" className="text-[9px]">{copy.active}</AkTag>}
                    <span className="settings-connector-id">{connector.id}</span>
                  </div>
                  <div className="settings-capabilities">
                    <span className="settings-capability-label">{copy.capabilities}</span>
                    {CAPABILITY_ORDER.map(([key, label]) => {
                      const value = connector.capabilities[key];
                      if (value === undefined) return null;
                      return (
                        <span
                          key={key}
                          className={`settings-capability ${value === false ? "is-off" : value === "emulated" ? "is-emulated" : ""}`}
                          title={value === "emulated" ? `${label} (emulated)` : `${label} (${value ? "native" : "unavailable"})`}
                        >
                          {value === "emulated" ? `~${label}` : label}
                        </span>
                      );
                    })}
                    <span className="settings-capability is-off">{copy.paperOnly}</span>
                  </div>
                  <div className="settings-connector-actions">
                    <button
                      type="button"
                      className="settings-inline-button"
                      aria-label={inUse ? copy.connectorInUse(connector.name) : copy.useConnector(connector.name)}
                      disabled={inUse || replayLocked}
                      title={replayLocked && !inUse ? copy.replayLocked : undefined}
                      onClick={() => setExchange(connector.id)}
                    >
                      {inUse ? copy.inUse : copy.use}
                    </button>
                    <button
                      type="button"
                      className="settings-inline-button"
                      aria-label={copy.probeConnector(connector.name, requestSymbol)}
                      disabled={probeState?.status === "loading"}
                      onClick={() => void probe(connector.id)}
                    >
                      {probeState?.status === "loading" ? `${copy.probing}…` : copy.probe}
                    </button>
                    <span
                      role="status"
                      className={`settings-probe-result ${probeState?.status === "error" ? "is-error" : probeState?.status === "ok" ? "is-ok" : ""}`}
                    >
                      {probeState?.status === "loading" ? copy.probingSymbol(requestSymbol)
                        : probeState ? `${requestSymbol} · ${probeState.detail}` : ""}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="settings-section lg:col-span-2" aria-labelledby="settings-api">
          <h3 id="settings-api" className="settings-section-title">{copy.apiTitle}</h3>
          <ul className="settings-api-list">
            <li>{copy.apiPublic}</li>
            <li>{copy.apiAi}</li>
            <li>{copy.apiPaper}</li>
          </ul>
        </section>
      </div>
    </AkDialog>
  );
}
