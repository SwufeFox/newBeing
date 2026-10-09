"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { AlertTriangle, Clock3, LoaderCircle, Radio, Wifi, WifiOff } from "lucide-react";
import { useWorkspaceStore } from "@/store/workspace";
import { useShallow } from "zustand/react/shallow";
import type { BacktestResult, Candle } from "@newbeing/core";
import { findCandleGaps, mergeCandles, reconnectDelayMs, timeframeMilliseconds } from "@newbeing/market-data/utils";

type StreamState = "connecting" | "live" | "reconnecting" | "unavailable" | "replay";

interface CandleResponse {
  candles: Candle[];
  gaps: Array<{ from: number; to: number }>;
}

function asUTCTime(timestampMs: number): UTCTimestamp {
  return Math.floor(timestampMs / 1000) as UTCTimestamp;
}

function parseCandleResponse(value: unknown): CandleResponse {
  if (typeof value !== "object" || value === null || !("candles" in value) || !Array.isArray(value.candles)) {
    throw new Error("Binance returned an invalid candle response.");
  }
  const candles: Candle[] = [];
  for (const item of value.candles) {
    if (typeof item !== "object" || item === null) continue;
    const row = item as Partial<Candle>;
    if ([row.timestamp, row.open, row.high, row.low, row.close, row.volume].some((part) => typeof part !== "number" || !Number.isFinite(part))) continue;
    candles.push({
      timestamp: row.timestamp as number,
      open: row.open as number,
      high: row.high as number,
      low: row.low as number,
      close: row.close as number,
      volume: row.volume as number,
    });
  }
  return { candles, gaps: "gaps" in value && Array.isArray(value.gaps) ? value.gaps as CandleResponse["gaps"] : [] };
}

function parseKlineEvent(value: unknown): { candle: Candle; closed: boolean } | null {
  if (typeof value !== "object" || value === null || !("k" in value)) return null;
  const kline = value.k;
  if (typeof kline !== "object" || kline === null) return null;
  const fields = kline as Record<string, unknown>;
  const timestamp = Number(fields.t);
  const open = Number(fields.o);
  const high = Number(fields.h);
  const low = Number(fields.l);
  const close = Number(fields.c);
  const volume = Number(fields.v);
  if (![timestamp, open, high, low, close, volume].every(Number.isFinite)) return null;
  return {
    candle: { timestamp, open, high, low, close, volume },
    closed: fields.x === true,
  };
}

interface MarketChartProps {
  backtest: BacktestResult | null;
  replayBars: readonly Candle[] | null;
  onRangeChange: (range: { from: number | null; to: number | null }) => void;
}

export function MarketChart({ backtest, replayBars, onRangeChange }: MarketChartProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const barsRef = useRef<Candle[]>([]);
  const [symbol, timeframe, theme, visibleRange] = useWorkspaceStore(useShallow((state) => [state.symbol, state.timeframe, state.theme, state.visibleRange]));
  const visibleRangeRef = useRef(visibleRange);
  const dataKey = `${symbol}|${timeframe}`;
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [errorState, setErrorState] = useState<{ key: string; message: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const replayMode = replayBars !== null;
  const error = replayMode ? null : errorState?.key === dataKey ? errorState.message : null;
  const loading = !replayMode && (refreshing || (loadedKey !== dataKey && error === null));
  const [stream, setStream] = useState<StreamState>("connecting");
  const [liveGapCount, setLiveGapCount] = useState(0);
  const [liveLastBar, setLiveLastBar] = useState<Candle | null>(null);
  const lastBar = replayMode ? replayBars.at(-1) ?? null : liveLastBar;
  const gapCount = replayMode ? findCandleGaps(replayBars, timeframe).length : liveGapCount;

  useEffect(() => {
    visibleRangeRef.current = visibleRange;
  }, [visibleRange]);

  const loadHistory = useCallback(async (signal?: AbortSignal): Promise<void> => {
    const url = `/api/market?kind=candles&symbol=${encodeURIComponent(symbol)}&timeframe=${timeframe}&limit=600`;
    const response = await fetch(url, { cache: "no-store", ...(signal ? { signal } : {}) });
    const payload: unknown = await response.json();
    if (!response.ok) {
      const message = typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error === "string"
        ? payload.error
        : "Could not fetch Binance candles.";
      throw new Error(message);
    }
    const parsed = parseCandleResponse(payload);
    if (parsed.candles.length === 0) throw new Error("No OHLCV bars were returned for this symbol and timeframe.");
    barsRef.current = parsed.candles;
    const gaps = findCandleGaps(parsed.candles, timeframe);
    setLiveGapCount(gaps.length);
    setLiveLastBar(parsed.candles.at(-1) ?? null);
    candleSeriesRef.current?.setData(parsed.candles.map((bar) => ({
      time: asUTCTime(bar.timestamp), open: bar.open, high: bar.high, low: bar.low, close: bar.close,
    })));
    volumeSeriesRef.current?.setData(parsed.candles.map((bar) => ({
      time: asUTCTime(bar.timestamp),
      value: bar.volume,
      color: bar.close >= bar.open ? "rgba(31, 177, 128, 0.32)" : "rgba(234, 82, 94, 0.32)",
    })));
    const chart = chartRef.current;
    if (chart) {
      const storedRange = visibleRangeRef.current;
      if (storedRange.from !== null && storedRange.to !== null && storedRange.from < storedRange.to) {
        chart.timeScale().setVisibleRange({ from: asUTCTime(storedRange.from), to: asUTCTime(storedRange.to) });
      } else {
        chart.timeScale().fitContent();
      }
    }
    setErrorState(null);
    setLoadedKey(`${symbol}|${timeframe}`);
  }, [symbol, timeframe]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let rangeTimer: ReturnType<typeof setTimeout> | undefined;
    const chart = createChart(container, {
      autoSize: false,
      width: container.clientWidth,
      height: container.clientHeight,
      layout: {
        background: { type: ColorType.Solid, color: theme === "dark" ? "#0d1117" : "#ffffff" },
        textColor: theme === "dark" ? "#8b949e" : "#64748b",
        fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: theme === "dark" ? "rgba(139,148,158,0.07)" : "rgba(100,116,139,0.10)" },
        horzLines: { color: theme === "dark" ? "rgba(139,148,158,0.07)" : "rgba(100,116,139,0.10)" },
      },
      crosshair: {
        vertLine: { color: theme === "dark" ? "#59636e" : "#94a3b8", labelBackgroundColor: theme === "dark" ? "#27313a" : "#334155" },
        horzLine: { color: theme === "dark" ? "#59636e" : "#94a3b8", labelBackgroundColor: theme === "dark" ? "#27313a" : "#334155" },
      },
      rightPriceScale: { borderColor: theme === "dark" ? "#232a31" : "#e2e8f0", scaleMargins: { top: 0.08, bottom: 0.24 } },
      timeScale: { borderColor: theme === "dark" ? "#232a31" : "#e2e8f0", timeVisible: true, secondsVisible: false, rightOffset: 4 },
      localization: { locale: "en-US" },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
    });
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: "#1fb180",
      downColor: "#ea525e",
      borderVisible: false,
      wickUpColor: "#1fb180",
      wickDownColor: "#ea525e",
      priceLineVisible: true,
      lastValueVisible: true,
    });
    const volume = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 }, visible: false });
    candleSeriesRef.current = candles;
    volumeSeriesRef.current = volume;
    chartRef.current = chart;
    markersRef.current = createSeriesMarkers(candles, []);
    const onRange = (range: { from: Time; to: Time } | null): void => {
      if (!range) return;
      if (rangeTimer) clearTimeout(rangeTimer);
      rangeTimer = setTimeout(() => {
        onRangeChange({
          from: typeof range.from === "number" ? range.from * 1000 : null,
          to: typeof range.to === "number" ? range.to * 1000 : null,
        });
      }, 250);
    };
    chart.timeScale().subscribeVisibleTimeRangeChange(onRange);
    const resize = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      chart.applyOptions({ width: Math.max(1, Math.floor(entry.contentRect.width)), height: Math.max(1, Math.floor(entry.contentRect.height)) });
    });
    resize.observe(container);
    return () => {
      resize.disconnect();
      chart.timeScale().unsubscribeVisibleTimeRangeChange(onRange);
      if (rangeTimer) clearTimeout(rangeTimer);
      markersRef.current?.setMarkers([]);
      markersRef.current = null;
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  // Chart lifecycle is deliberately recreated only for a theme change; symbol/timeframe load data into the same chart.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);

  useEffect(() => {
    const controller = new AbortController();
    if (replayMode) {
      const bars = replayBars ?? [];
      barsRef.current = [...bars];
      candleSeriesRef.current?.setData(bars.map((bar) => ({
        time: asUTCTime(bar.timestamp), open: bar.open, high: bar.high, low: bar.low, close: bar.close,
      })));
      volumeSeriesRef.current?.setData(bars.map((bar) => ({
        time: asUTCTime(bar.timestamp),
        value: bar.volume,
        color: bar.close >= bar.open ? "rgba(31, 177, 128, 0.32)" : "rgba(234, 82, 94, 0.32)",
      })));
      chartRef.current?.timeScale().fitContent();
      return () => controller.abort();
    }
    void Promise.resolve().then(() => loadHistory(controller.signal)).catch((reason: unknown) => {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      setErrorState({ key: `${symbol}|${timeframe}`, message: reason instanceof Error ? reason.message : "Market data request failed." });
    });
    return () => controller.abort();
  }, [loadHistory, symbol, timeframe, theme, replayMode, replayBars]);

  useEffect(() => {
    const intervalMs = timeframeMilliseconds(timeframe);
    if (replayMode) return;
    const streamUrl = `wss://stream.binance.com:9443/ws/${symbol.replace("/", "").toLowerCase()}@kline_${timeframe}`;
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    let attempt = 0;

    const connect = (): void => {
      if (disposed) return;
      setStream(attempt === 0 ? "connecting" : "reconnecting");
      try {
        socket = new WebSocket(streamUrl);
      } catch {
        scheduleReconnect();
        return;
      }
      socket.onopen = () => {
        if (disposed) return;
        const wasReconnect = attempt > 0;
        attempt = 0;
        setStream("live");
        if (wasReconnect) void loadHistory().catch(() => setStream("reconnecting"));
      };
      socket.onmessage = (event: MessageEvent<string>) => {
        let payload: unknown;
        try {
          payload = JSON.parse(event.data) as unknown;
        } catch {
          return;
        }
        const parsed = parseKlineEvent(payload);
        if (!parsed) return;
        const existing = barsRef.current;
        const last = existing.at(-1);
        if (last && parsed.candle.timestamp > last.timestamp + intervalMs) {
          void loadHistory().catch(() => setStream("reconnecting"));
        }
        if (last && parsed.candle.timestamp < last.timestamp) return;
        const merged = mergeCandles(existing, [parsed.candle]);
        barsRef.current = merged.slice(-1000);
        setLiveLastBar(parsed.candle);
        candleSeriesRef.current?.update({
          time: asUTCTime(parsed.candle.timestamp),
          open: parsed.candle.open,
          high: parsed.candle.high,
          low: parsed.candle.low,
          close: parsed.candle.close,
        });
        volumeSeriesRef.current?.update({
          time: asUTCTime(parsed.candle.timestamp),
          value: parsed.candle.volume,
          color: parsed.candle.close >= parsed.candle.open ? "rgba(31, 177, 128, 0.32)" : "rgba(234, 82, 94, 0.32)",
        });
        if (parsed.closed) {
          const gaps = findCandleGaps(barsRef.current, timeframe);
          setLiveGapCount(gaps.length);
        }
      };
      socket.onerror = () => socket?.close();
      socket.onclose = () => {
        if (!disposed) scheduleReconnect();
      };
    };

    const scheduleReconnect = (): void => {
      if (disposed || reconnectTimer) return;
      setStream("reconnecting");
      const base = reconnectDelayMs(attempt);
      const jitter = Math.floor(Math.random() * Math.min(500, base * 0.2));
      attempt += 1;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = undefined;
        connect();
      }, base + jitter);
    };

    connect();
    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [symbol, timeframe, loadHistory, replayMode]);

  useEffect(() => {
    if (replayMode) {
      markersRef.current?.setMarkers([]);
      return;
    }
    if (!candleSeriesRef.current || !markersRef.current) return;
    const markers = backtest?.trades.flatMap((trade) => [
      {
        time: asUTCTime(trade.entryTime),
        position: trade.side === "long" ? "belowBar" as const : "aboveBar" as const,
        color: trade.side === "long" ? "#1fb180" : "#ea525e",
        shape: trade.side === "long" ? "arrowUp" as const : "arrowDown" as const,
        text: `IN ${trade.side.toUpperCase()}`,
      },
      {
        time: asUTCTime(trade.exitTime),
        position: trade.side === "long" ? "aboveBar" as const : "belowBar" as const,
        color: trade.netPnl >= 0 ? "#1fb180" : "#ea525e",
        shape: trade.side === "long" ? "arrowDown" as const : "arrowUp" as const,
        text: trade.exitReason === "end-of-data" ? "OUT" : trade.exitReason.replaceAll("-", " ").toUpperCase(),
      },
    ]).sort((a, b) => Number(a.time) - Number(b.time)) ?? [];
    markersRef.current.setMarkers(markers);
  }, [backtest, theme, replayMode]);

  const streamLabel = replayMode ? "HISTORICAL REPLAY · FUTURE HIDDEN" : stream === "live" ? "STREAM LIVE" : stream === "connecting" ? "CONNECTING" : stream === "unavailable" ? "OFFLINE" : "RECONNECTING";
  const StreamIcon = replayMode ? Clock3 : stream === "live" ? Wifi : stream === "connecting" ? Radio : WifiOff;

  return (
    <section className="chart-shell" data-testid="market-chart" aria-label="Interactive market chart">
      <div className="chart-meta">
        <div className="chart-meta-left">
          {lastBar ? <><span>O {lastBar.open.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span><span>H {lastBar.high.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span><span>L {lastBar.low.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span><span>C {lastBar.close.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span></> : <span className="muted">Awaiting market data</span>}
        </div>
        <div className={`stream-indicator stream-${stream}`}><StreamIcon size={12} /><span>{streamLabel}</span></div>
      </div>
      <div className="chart-stage">
        <div ref={containerRef} className="chart-canvas" />
        {loading && <div className="chart-overlay"><LoaderCircle className="spin" size={18} /><span>Loading Binance history</span></div>}
        {error && <div className="chart-overlay chart-error"><AlertTriangle size={18} /><span>{error}</span><button className="link-button" onClick={() => {
          setErrorState(null);
          setRefreshing(true);
          void loadHistory().catch((reason: unknown) => {
            setErrorState({ key: dataKey, message: reason instanceof Error ? reason.message : "Retry failed." });
          }).finally(() => setRefreshing(false));
        }}>Retry</button></div>}
        {replayMode && replayBars.length === 0 && <div className="chart-overlay"><Clock3 size={16} /><span>Seed a historical session to load past bars only.</span></div>}
      </div>
      <div className="chart-footer">
        <span>{gapCount > 0 ? <><AlertTriangle size={11} /> {gapCount} gap{gapCount === 1 ? "" : "s"} detected</> : replayMode ? "Future candles are not loaded · UTC" : "UTC · Binance Spot public market data"}</span>
        <a href="https://www.tradingview.com/lightweight-charts/" target="_blank" rel="noreferrer">Charts by TradingView · Lightweight Charts™</a>
      </div>
    </section>
  );
}
