"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  HistogramSeries,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { AlertTriangle, Clock3, Radio, Wifi, WifiOff } from "lucide-react";
import { useWorkspaceStore } from "@/store/workspace";
import { useShallow } from "zustand/react/shallow";
import type { BacktestResult, Candle } from "@newbeing/core";
import { findCandleGaps, mergeCandles, reconnectDelayMs, timeframeMilliseconds } from "@newbeing/market-data/utils";
import { AkSpinner } from "@swufefox/ak-ui-react";

type StreamState = "connecting" | "live" | "reconnecting" | "unavailable" | "polling";

interface CandleResponse {
  candles: Candle[];
  gaps: Array<{ from: number; to: number }>;
  cache: { fallback: boolean; cachedAt: string | null };
}

export {
  asUTCTime,
  sanitizeCandlesForChart,
  calculateSMA,
  calculateEMA,
  calculateBollingerBands,
} from "@/lib/indicators";
import {
  asUTCTime,
  sanitizeCandlesForChart,
  calculateSMA,
  calculateEMA,
  calculateBollingerBands,
} from "@/lib/indicators";

function parseCandleResponse(value: unknown): CandleResponse {
  if (typeof value !== "object" || value === null || !("candles" in value) || !Array.isArray(value.candles)) {
    throw new Error("Exchange returned an invalid candle response.");
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
  const cacheValue = "cache" in value && typeof value.cache === "object" && value.cache !== null ? value.cache as Record<string, unknown> : null;
  return {
    candles,
    gaps: "gaps" in value && Array.isArray(value.gaps) ? value.gaps as CandleResponse["gaps"] : [],
    cache: {
      fallback: cacheValue?.fallback === true,
      cachedAt: typeof cacheValue?.cachedAt === "string" ? cacheValue.cachedAt : null,
    },
  };
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

export const MarketChart = memo(function MarketChart({ backtest, replayBars, onRangeChange }: MarketChartProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const sma20SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const sma50SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const ema20SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const bbUpperSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const bbLowerSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const barsRef = useRef<Candle[]>([]);
  const prevReplayLengthRef = useRef<number>(0);
  const [symbol, timeframe, exchange, theme] = useWorkspaceStore(useShallow((state) => [state.symbol, state.timeframe, state.exchange, state.theme]));
  const dataKey = `${exchange}|${symbol}|${timeframe}`;

  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [errorState, setErrorState] = useState<{ key: string; message: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [cacheInfo, setCacheInfo] = useState<{ fallback: boolean; cachedAt: string | null }>({ fallback: false, cachedAt: null });
  const replayMode = replayBars !== null;
  const error = replayMode ? null : errorState?.key === dataKey ? errorState.message : null;
  const loading = !replayMode && (refreshing || (loadedKey !== dataKey && error === null));
  const [stream, setStream] = useState<StreamState>("connecting");
  const [liveGapCount, setLiveGapCount] = useState(0);
  const [liveLastBar, setLiveLastBar] = useState<Candle | null>(null);
  const [hoveredBar, setHoveredBar] = useState<{
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number | undefined;
  } | null>(null);
  const hoveredBarRef = useRef<typeof hoveredBar>(null);

  const [indicators, setIndicators] = useState({
    sma20: false,
    sma50: false,
    ema20: false,
    bb: false,
    volume: true,
  });

  const lastLegendUpdate = useRef(0);
  const lastBar = replayMode ? replayBars.at(-1) ?? null : liveLastBar;
  const gapCount = replayMode ? findCandleGaps(replayBars, timeframe).length : liveGapCount;

  const updateIndicators = useCallback(() => {
    const bars = barsRef.current;
    if (!bars.length) return;
    if (sma20SeriesRef.current) {
      sma20SeriesRef.current.setData(indicators.sma20 ? calculateSMA(bars, 20) : []);
    }
    if (sma50SeriesRef.current) {
      sma50SeriesRef.current.setData(indicators.sma50 ? calculateSMA(bars, 50) : []);
    }
    if (ema20SeriesRef.current) {
      ema20SeriesRef.current.setData(indicators.ema20 ? calculateEMA(bars, 20) : []);
    }
    if (bbUpperSeriesRef.current && bbLowerSeriesRef.current) {
      if (indicators.bb) {
        const bb = calculateBollingerBands(bars, 20, 2);
        bbUpperSeriesRef.current.setData(bb.upper);
        bbLowerSeriesRef.current.setData(bb.lower);
      } else {
        bbUpperSeriesRef.current.setData([]);
        bbLowerSeriesRef.current.setData([]);
      }
    }
    if (volumeSeriesRef.current) {
      if (indicators.volume) {
        volumeSeriesRef.current.setData(bars.map((bar) => ({
          time: asUTCTime(bar.timestamp),
          value: bar.volume,
          color: bar.close >= bar.open ? "rgba(31, 177, 128, 0.32)" : "rgba(234, 82, 94, 0.32)",
        })));
      } else {
        volumeSeriesRef.current.setData([]);
      }
    }
  }, [indicators]);

  useEffect(() => {
    updateIndicators();
  }, [updateIndicators]);

  const loadHistory = useCallback(async (signal?: AbortSignal): Promise<void> => {
    const url = `/api/market?kind=candles&exchange=${exchange}&symbol=${encodeURIComponent(symbol)}&timeframe=${timeframe}&limit=600`;
    const response = await fetch(url, { cache: "no-store", ...(signal ? { signal } : {}) });
    const payload: unknown = await response.json();
    if (!response.ok) {
      const message = typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error === "string"
        ? payload.error
        : "Could not fetch market candles.";
      throw new Error(message);
    }
    const parsed = parseCandleResponse(payload);
    const sanitizedCandles = sanitizeCandlesForChart(parsed.candles);
    if (sanitizedCandles.length === 0) throw new Error("No valid OHLCV bars were returned for this symbol and timeframe.");
    setCacheInfo(parsed.cache);
    barsRef.current = sanitizedCandles;
    const gaps = findCandleGaps(sanitizedCandles, timeframe);
    setLiveGapCount(gaps.length);
    setLiveLastBar(sanitizedCandles.at(-1) ?? null);
    candleSeriesRef.current?.setData(sanitizedCandles.map((bar) => ({
      time: asUTCTime(bar.timestamp), open: bar.open, high: bar.high, low: bar.low, close: bar.close,
    })));
    updateIndicators();

    const chart = chartRef.current;
    if (chart) {
      const storedRange = useWorkspaceStore.getState().visibleRange;
      const span = parsed.candles.length > 1
        ? parsed.candles[parsed.candles.length - 1]!.timestamp - parsed.candles[0]!.timestamp
        : 0;
      const storedSpan = storedRange.from !== null && storedRange.to !== null ? storedRange.to - storedRange.from : 0;
      if (storedSpan > 0 && span > 0 && storedSpan >= span / 10) {
        chart.timeScale().setVisibleRange({ from: asUTCTime(storedRange.from!), to: asUTCTime(storedRange.to!) });
      } else {
        chart.timeScale().fitContent();
      }
    }
    setErrorState(null);
    setLoadedKey(`${exchange}|${symbol}|${timeframe}`);
  }, [symbol, timeframe, exchange, updateIndicators]);

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

    const sma20 = chart.addSeries(LineSeries, {
      color: "#ffd800",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const sma50 = chart.addSeries(LineSeries, {
      color: "#18d1ff",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const ema20 = chart.addSeries(LineSeries, {
      color: "#c084fc",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const bbUpper = chart.addSeries(LineSeries, {
      color: "rgba(56, 189, 248, 0.65)",
      lineWidth: 1,
      lineStyle: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const bbLower = chart.addSeries(LineSeries, {
      color: "rgba(56, 189, 248, 0.65)",
      lineWidth: 1,
      lineStyle: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    candleSeriesRef.current = candles;
    volumeSeriesRef.current = volume;
    sma20SeriesRef.current = sma20;
    sma50SeriesRef.current = sma50;
    ema20SeriesRef.current = ema20;
    bbUpperSeriesRef.current = bbUpper;
    bbLowerSeriesRef.current = bbLower;
    chartRef.current = chart;
    markersRef.current = createSeriesMarkers(candles, []);

    const onCrosshair = (param: MouseEventParams<Time>): void => {
      if (!param.time || !param.seriesData) {
        if (hoveredBarRef.current !== null) {
          hoveredBarRef.current = null;
          setHoveredBar(null);
        }
        return;
      }
      const data = param.seriesData.get(candles) as { open: number; high: number; low: number; close: number } | undefined;
      if (data && typeof data.open === "number") {
        const vData = param.seriesData.get(volume) as { value: number } | undefined;
        const timestamp = typeof param.time === "number" ? param.time * 1000 : 0;
        const volumeValue = vData?.value;
        const current = hoveredBarRef.current;
        if (
          current?.timestamp === timestamp &&
          current.open === data.open &&
          current.high === data.high &&
          current.low === data.low &&
          current.close === data.close &&
          current.volume === volumeValue
        ) return;
        const nextBar = {
          timestamp,
          open: data.open,
          high: data.high,
          low: data.low,
          close: data.close,
          volume: volumeValue,
        };
        hoveredBarRef.current = nextBar;
        setHoveredBar(nextBar);
      } else if (hoveredBarRef.current !== null) {
        hoveredBarRef.current = null;
        setHoveredBar(null);
      }
    };
    chart.subscribeCrosshairMove(onCrosshair);

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
      chart.unsubscribeCrosshairMove(onCrosshair);
      if (rangeTimer) clearTimeout(rangeTimer);
      markersRef.current?.setMarkers([]);
      markersRef.current = null;
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      sma20SeriesRef.current = null;
      sma50SeriesRef.current = null;
      ema20SeriesRef.current = null;
      bbUpperSeriesRef.current = null;
      bbLowerSeriesRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);

  useEffect(() => {
    const controller = new AbortController();
    if (replayMode) {
      const rawBars = replayBars ?? [];
      const sanitized = sanitizeCandlesForChart([...rawBars]);
      barsRef.current = sanitized;
      candleSeriesRef.current?.setData(sanitized.map((bar) => ({
        time: asUTCTime(bar.timestamp), open: bar.open, high: bar.high, low: bar.low, close: bar.close,
      })));
      updateIndicators();
      if (sanitized.length > 0 && (prevReplayLengthRef.current === 0 || sanitized.length < prevReplayLengthRef.current)) {
        chartRef.current?.timeScale().fitContent();
      }
      prevReplayLengthRef.current = sanitized.length;
      return () => controller.abort();
    }
    void Promise.resolve().then(() => loadHistory(controller.signal)).catch((reason: unknown) => {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      setErrorState({ key: dataKey, message: reason instanceof Error ? reason.message : "Market data request failed." });
    });
    return () => controller.abort();
  }, [loadHistory, symbol, timeframe, theme, replayMode, replayBars, dataKey, updateIndicators]);

  useEffect(() => {
    const intervalMs = timeframeMilliseconds(timeframe);
    if (replayMode) return;
    if (exchange !== "binance") {
      const pollingMs = Math.max(15_000, Math.min(60_000, intervalMs / 4));
      const timer = window.setInterval(() => {
        if (typeof document !== "undefined" && document.hidden) return;
        void loadHistory().then(() => setStream("polling")).catch(() => setStream("unavailable"));
      }, pollingMs);
      return () => window.clearInterval(timer);
    }
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
        const now = performance.now();
        if (now - lastLegendUpdate.current > 150) {
          lastLegendUpdate.current = now;
          setLiveLastBar(parsed.candle);
        }
        candleSeriesRef.current?.update({
          time: asUTCTime(parsed.candle.timestamp),
          open: parsed.candle.open,
          high: parsed.candle.high,
          low: parsed.candle.low,
          close: parsed.candle.close,
        });
        if (indicators.volume) {
          volumeSeriesRef.current?.update({
            time: asUTCTime(parsed.candle.timestamp),
            value: parsed.candle.volume,
            color: parsed.candle.close >= parsed.candle.open ? "rgba(31, 177, 128, 0.32)" : "rgba(234, 82, 94, 0.32)",
          });
        }
        if (parsed.closed) {
          const gaps = findCandleGaps(barsRef.current, timeframe);
          setLiveGapCount(gaps.length);
          updateIndicators();
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
  }, [symbol, timeframe, exchange, loadHistory, replayMode, indicators.volume, updateIndicators]);

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
    ]).filter((m) => Number.isFinite(m.time) && (m.time as number) > 0).sort((a, b) => Number(a.time) - Number(b.time)) ?? [];
    markersRef.current.setMarkers(markers);
  }, [backtest, theme, replayMode]);

  const effectiveStream: StreamState = !replayMode && exchange !== "binance" ? "polling" : stream;
  const streamLabel = replayMode ? "HISTORICAL REPLAY · FUTURE HIDDEN" : effectiveStream === "live" ? "STREAM LIVE" : effectiveStream === "connecting" ? "CONNECTING" : effectiveStream === "polling" ? `REST · ${Math.round(Math.max(15_000, Math.min(60_000, timeframeMilliseconds(timeframe) / 4)) / 1000)}S POLL` : effectiveStream === "unavailable" ? "OFFLINE" : "RECONNECTING";
  const StreamIcon = replayMode ? Clock3 : effectiveStream === "live" ? Wifi : effectiveStream === "connecting" ? Radio : effectiveStream === "polling" ? Clock3 : WifiOff;

  const displayBar = hoveredBar ?? (lastBar ? { timestamp: lastBar.timestamp, open: lastBar.open, high: lastBar.high, low: lastBar.low, close: lastBar.close, volume: lastBar.volume } : null);

  return (
    <section className="chart-shell" data-testid="market-chart" aria-label="Interactive market chart">
      <div className="chart-meta flex items-center justify-between gap-2 px-3 py-1.5 bg-[var(--ak-surface-sunken)] border-b border-[var(--ak-border-subtle)] font-mono text-[11px]">
        <div className="chart-meta-left flex items-center gap-2.5 overflow-x-auto min-w-0">
          {displayBar ? (
            <>
              {displayBar.timestamp > 0 && (
                <span className="text-[10px] text-[var(--ak-text-secondary)] opacity-75">
                  {new Date(displayBar.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </span>
              )}
              <span>O <b className="text-[var(--ak-text-primary)]">{displayBar.open.toLocaleString(undefined, { maximumFractionDigits: 4 })}</b></span>
              <span>H <b className="text-[var(--ak-text-primary)]">{displayBar.high.toLocaleString(undefined, { maximumFractionDigits: 4 })}</b></span>
              <span>L <b className="text-[var(--ak-text-primary)]">{displayBar.low.toLocaleString(undefined, { maximumFractionDigits: 4 })}</b></span>
              <span>C <b className={displayBar.close >= displayBar.open ? "text-[var(--ak-signal-success)]" : "text-[var(--ak-signal-danger)]"}>{displayBar.close.toLocaleString(undefined, { maximumFractionDigits: 4 })}</b></span>
              {displayBar.volume != null && indicators.volume && (
                <span className="text-[var(--ak-text-secondary)]">V <b className="text-[var(--ak-text-primary)]">{displayBar.volume.toLocaleString(undefined, { maximumFractionDigits: 2 })}</b></span>
              )}
            </>
          ) : (
            <span className="muted text-[var(--ak-text-secondary)] opacity-60">Awaiting market data</span>
          )}
        </div>
        <div className="chart-meta-right flex items-center gap-3 shrink-0">
          <div className="indicator-toggles flex items-center gap-1 font-mono text-[9px]" role="toolbar" aria-label="Chart indicators">
            <button
              type="button"
              className={`px-1.5 py-0.5 border cursor-pointer uppercase transition-all ${indicators.sma20 ? "bg-amber-500/20 text-amber-300 border-amber-500/50 font-bold" : "border-[var(--ak-border-subtle)] text-[var(--ak-text-secondary)] hover:text-white"}`}
              onClick={() => setIndicators((prev) => ({ ...prev, sma20: !prev.sma20 }))}
              title="Toggle Simple Moving Average (SMA 20)"
            >
              SMA20
            </button>
            <button
              type="button"
              className={`px-1.5 py-0.5 border cursor-pointer uppercase transition-all ${indicators.sma50 ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/50 font-bold" : "border-[var(--ak-border-subtle)] text-[var(--ak-text-secondary)] hover:text-white"}`}
              onClick={() => setIndicators((prev) => ({ ...prev, sma50: !prev.sma50 }))}
              title="Toggle Simple Moving Average (SMA 50)"
            >
              SMA50
            </button>
            <button
              type="button"
              className={`px-1.5 py-0.5 border cursor-pointer uppercase transition-all ${indicators.ema20 ? "bg-purple-500/20 text-purple-300 border-purple-500/50 font-bold" : "border-[var(--ak-border-subtle)] text-[var(--ak-text-secondary)] hover:text-white"}`}
              onClick={() => setIndicators((prev) => ({ ...prev, ema20: !prev.ema20 }))}
              title="Toggle Exponential Moving Average (EMA 20)"
            >
              EMA20
            </button>
            <button
              type="button"
              className={`px-1.5 py-0.5 border cursor-pointer uppercase transition-all ${indicators.bb ? "bg-sky-500/20 text-sky-300 border-sky-500/50 font-bold" : "border-[var(--ak-border-subtle)] text-[var(--ak-text-secondary)] hover:text-white"}`}
              onClick={() => setIndicators((prev) => ({ ...prev, bb: !prev.bb }))}
              title="Toggle Bollinger Bands (20, 2)"
            >
              BB
            </button>
            <button
              type="button"
              className={`px-1.5 py-0.5 border cursor-pointer uppercase transition-all ${indicators.volume ? "bg-[var(--ak-surface-raised)] text-[var(--ak-text-primary)] border-[var(--ak-border-strong)] font-bold" : "border-[var(--ak-border-subtle)] text-[var(--ak-text-secondary)] hover:text-white"}`}
              onClick={() => setIndicators((prev) => ({ ...prev, volume: !prev.volume }))}
              title="Toggle Volume Histogram"
            >
              VOL
            </button>
          </div>
          <div className={`stream-indicator stream-${effectiveStream} flex items-center gap-1 text-[10px]`}>
            <StreamIcon size={12} />
            <span>{streamLabel}</span>
          </div>
        </div>
      </div>
      <div className="chart-stage">
        <div ref={containerRef} className="chart-canvas" />
        {loading && (
          <div className="chart-overlay">
            <AkSpinner color="#18d1ff" label="Loading history" />
            <span>Loading {exchange === "coinbaseexchange" ? "Coinbase Exchange" : exchange.toUpperCase()} history</span>
          </div>
        )}
        {error && (
          <div className="chart-overlay chart-error">
            <AlertTriangle size={18} />
            <span>{error}</span>
            <button
              className="link-button"
              onClick={() => {
                setErrorState(null);
                setRefreshing(true);
                void loadHistory()
                  .catch((reason: unknown) => {
                    setErrorState({ key: dataKey, message: reason instanceof Error ? reason.message : "Retry failed." });
                  })
                  .finally(() => setRefreshing(false));
              }}
            >
              Retry
            </button>
          </div>
        )}
        {replayMode && replayBars.length === 0 && (
          <div className="chart-overlay">
            <Clock3 size={16} />
            <span>Seed a historical session to load past bars only.</span>
          </div>
        )}
      </div>
      <div className="chart-footer">
        <span>{!replayMode && cacheInfo.fallback
          ? <><AlertTriangle size={11} /> LOCAL CACHE · last fetched {cacheInfo.cachedAt ? new Date(cacheInfo.cachedAt).toLocaleString() : "time unavailable"}</>
          : gapCount > 0 ? <><AlertTriangle size={11} /> {gapCount} gap{gapCount === 1 ? "" : "s"} detected</> : replayMode ? "Future candles are not loaded · UTC" : `UTC · ${exchange === "coinbaseexchange" ? "Coinbase Exchange" : exchange.toUpperCase()} public spot data`}</span>
        <a href="https://www.tradingview.com/lightweight-charts/" target="_blank" rel="noreferrer">Charts by TradingView · Lightweight Charts™</a>
      </div>
    </section>
  );
});
