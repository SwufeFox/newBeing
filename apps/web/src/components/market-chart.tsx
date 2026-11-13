"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  HistogramSeries,
  LineSeries,
  type ChartOptions,
  type DeepPartial,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { AlertTriangle, Clock3, LoaderCircle, Radio, Wifi, WifiOff } from "lucide-react";
import { useWorkspaceStore } from "@/store/workspace";
import { useShallow } from "zustand/react/shallow";
import type { BacktestResult, Candle } from "@newbeing/core";
import { findCandleGaps, reconnectDelayMs, timeframeMilliseconds } from "@newbeing/market-data/utils";
import { chartPalette, type ChartPalette } from "@/lib/chart-palette";
import { usePreferences } from "@/lib/preferences";
import { translate, useCopy, type CopyTable } from "@/lib/i18n";
import { formatQuotePrice } from "@/lib/price-format";

type StreamState = "connecting" | "live" | "reconnecting" | "unavailable" | "polling";

interface CandleResponse {
  candles: Candle[];
  source: string | null;
  gaps: Array<{ from: number; to: number }>;
  cache: { fallback: boolean; cachedAt: string | null };
}

interface MarketChartCopy {
  chartAria: string;
  legendOpen: string;
  legendHigh: string;
  legendLow: string;
  legendClose: string;
  legendVolume: string;
  indicatorToolbar: string;
  toggleSma20: string;
  toggleSma50: string;
  toggleEma20: string;
  toggleBb: string;
  toggleVolume: string;
  streamLive: string;
  streamConnecting: string;
  streamPoll: (seconds: number) => string;
  streamOffline: string;
  streamReconnecting: string;
  streamReplay: string;
  streamFixture: string;
  sourcePending: string;
  loadingHistory: string;
  loadVenueHistory: (venue: string) => string;
  loadingSlow: (venue: string) => string;
  retry: string;
  replayEmpty: string;
  localCache: (time: string) => string;
  timeUnavailable: string;
  gapsDetected: (count: number) => string;
  futureNotLoaded: string;
  publicSpot: (venue: string) => string;
  invalidResponse: string;
  fetchFailed: string;
  noBars: string;
  requestFailed: string;
  candlesUnavailable: string;
  errorDetails: string;
  retryFailed: string;
}

/* Indicator ids (SMA20, BB, VOL) and the TradingView attribution stay literal:
   they name the study and the library, not UI prose. */
const MARKET_CHART_COPY: CopyTable<MarketChartCopy> = {
  en: {
    chartAria: "Interactive market chart",
    legendOpen: "O",
    legendHigh: "H",
    legendLow: "L",
    legendClose: "C",
    legendVolume: "V",
    indicatorToolbar: "Chart indicators",
    toggleSma20: "Toggle Simple Moving Average (SMA 20)",
    toggleSma50: "Toggle Simple Moving Average (SMA 50)",
    toggleEma20: "Toggle Exponential Moving Average (EMA 20)",
    toggleBb: "Toggle Bollinger Bands (20, 2)",
    toggleVolume: "Toggle Volume Histogram",
    streamLive: "Realtime",
    streamConnecting: "Connecting…",
    streamPoll: (seconds) => `${seconds}s refresh`,
    streamOffline: "Offline",
    streamReconnecting: "Reconnecting…",
    streamReplay: "Historical Replay",
    streamFixture: "TEST FIXTURE",
    sourcePending: "UTC · awaiting candle source",
    loadingHistory: "Loading history",
    loadVenueHistory: (venue) => `Loading ${venue} history`,
    loadingSlow: (venue) => `${venue} has not answered yet — still waiting.`,
    retry: "Retry",
    replayEmpty: "Seed a historical session to load past bars only.",
    localCache: (time) => `LOCAL CACHE · last fetched ${time}`,
    timeUnavailable: "time unavailable",
    gapsDetected: (count) => `${count} gap${count === 1 ? "" : "s"} detected`,
    futureNotLoaded: "Future candles are not loaded · UTC",
    publicSpot: (venue) => `UTC · ${venue} public spot data`,
    invalidResponse: "Exchange returned an invalid candle response.",
    fetchFailed: "Could not fetch market candles.",
    noBars: "No valid OHLCV bars were returned for this symbol and timeframe.",
    requestFailed: "Market data request failed.",
    candlesUnavailable: "Market candles are unavailable.",
    errorDetails: "Error details",
    retryFailed: "Retry failed.",
  },
  zh: {
    chartAria: "交互式行情图",
    legendOpen: "开",
    legendHigh: "高",
    legendLow: "低",
    legendClose: "收",
    legendVolume: "量",
    indicatorToolbar: "图表指标",
    toggleSma20: "切换简单移动平均线（SMA 20）",
    toggleSma50: "切换简单移动平均线（SMA 50）",
    toggleEma20: "切换指数移动平均线（EMA 20）",
    toggleBb: "切换布林带（20, 2）",
    toggleVolume: "切换成交量柱状图",
    streamLive: "实时推送",
    streamConnecting: "连接中…",
    streamPoll: (seconds) => `${seconds} 秒刷新`,
    streamOffline: "离线",
    streamReconnecting: "重连中…",
    streamReplay: "历史回放",
    streamFixture: "TEST FIXTURE · 测试数据",
    sourcePending: "UTC · 等待 K 线数据来源",
    loadingHistory: "加载历史",
    loadVenueHistory: (venue) => `加载 ${venue} 历史`,
    loadingSlow: (venue) => `${venue} 尚未响应 — 仍在等待。`,
    retry: "重试",
    replayEmpty: "初始化历史会话，仅加载过去的 K 线。",
    localCache: (time) => `本地缓存 · 最后获取 ${time}`,
    timeUnavailable: "时间不可用",
    gapsDetected: (count) => `${count} 处缺口`,
    futureNotLoaded: "未来 K 线未加载 · UTC",
    publicSpot: (venue) => `UTC · ${venue} 公开现货数据`,
    invalidResponse: "交易所返回了无效的 K 线响应。",
    fetchFailed: "无法获取行情 K 线。",
    noBars: "该标的与周期未返回有效的 OHLCV K 线。",
    requestFailed: "行情请求失败。",
    candlesUnavailable: "行情 K 线不可用。",
    errorDetails: "错误详情",
    retryFailed: "重试失败。",
  },
};

export {
  asUTCTime,
  sanitizeCandlesForChart,
  calculateSMA,
  calculateEMA,
  calculateBollingerBands,
} from "@/lib/indicators";
import {
  asUTCTime,
  mergeCandles,
  sanitizeCandlesForChart,
  calculateSMA,
  calculateEMA,
  calculateBollingerBands,
} from "@/lib/indicators";

function parseCandleResponse(value: unknown): CandleResponse {
  if (typeof value !== "object" || value === null || !("candles" in value) || !Array.isArray(value.candles)) {
    throw new Error(translate(MARKET_CHART_COPY).invalidResponse);
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
    source: "source" in value && typeof value.source === "string" && value.source.trim() ? value.source : null,
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

type ThemeChartOptions = Required<Pick<DeepPartial<ChartOptions>, "layout" | "grid" | "crosshair" | "rightPriceScale" | "timeScale">>;

/** Chart options only — safe to re-apply with `applyOptions` without touching data or range. */
function themeOptions(): ThemeChartOptions {
  return {
    layout: {
      background: { type: ColorType.Solid, color: "#0d1117" },
      textColor: "#8b949e",
      fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
      fontSize: 11,
    },
    grid: {
      vertLines: { color: "rgba(139,148,158,0.07)" },
      horzLines: { color: "rgba(139,148,158,0.07)" },
    },
    crosshair: {
      vertLine: { color: "#59636e", labelBackgroundColor: "#27313a" },
      horzLine: { color: "#59636e", labelBackgroundColor: "#27313a" },
    },
    rightPriceScale: { borderColor: "#232a31" },
    timeScale: { borderColor: "#232a31" },
  };
}

function isAbortError(reason: unknown): boolean {
  return reason instanceof Error && reason.name === "AbortError";
}

interface MarketChartProps {
  backtest: BacktestResult | null;
  replayBars: readonly Candle[] | null;
  onRangeChange: (range: { from: number | null; to: number | null }) => void;
}

export const MarketChart = memo(function MarketChart({ backtest, replayBars, onRangeChange }: MarketChartProps): React.JSX.Element {
  const copy = useCopy(MARKET_CHART_COPY);
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
  const replayBarsRef = useRef<Candle[] | null>(null);
  const [symbol, timeframe, exchange] = useWorkspaceStore(useShallow((state) => [state.symbol, state.timeframe, state.exchange]));
  const dataKey = `${exchange}|${symbol}|${timeframe}`;
  /* One spelling of the venue, used by the overlays and the attribution row. */
  const venueLabel = exchange === "coinbaseexchange" ? "Coinbase Exchange" : exchange.toUpperCase();

  /* Canvas series read plain colour strings, so the ramp lives in a ref that
     the long-lived chart callbacks can read without taking a dependency on the
     preference — a colour change must repaint, never reconnect the feed. */
  const palette = chartPalette(usePreferences().colorVision);
  const paletteRef = useRef<ChartPalette>(palette);
  /* Declared before the chart-creating effect so the first commit already reads
     the right ramp; a render must never mutate a ref. */
  useEffect(() => {
    paletteRef.current = palette;
  }, [palette]);

  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [sourceState, setSourceState] = useState<{ key: string; source: string | null } | null>(null);
  const source = sourceState?.key === dataKey ? sourceState.source : null;
  const fixtureSource = source === "Deterministic test fixture";
  const nativeStream = exchange === "binance" && source === "Binance Spot via CCXT";
  const [errorState, setErrorState] = useState<{ key: string; message: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [cacheInfo, setCacheInfo] = useState<{ fallback: boolean; cachedAt: string | null }>({ fallback: false, cachedAt: null });
  const replayMode = replayBars !== null;
  const error = replayMode ? null : errorState?.key === dataKey ? errorState.message : null;
  const loading = !replayMode && (refreshing || (loadedKey !== dataKey && error === null));
  /* A venue that accepts the socket and never answers looked exactly like a
     hung application. Past six seconds the caption names the venue and says it
     is still waiting. */
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!loading) { setSlow(false); return; }
    const timer = window.setTimeout(() => setSlow(true), 6_000);
    return () => window.clearTimeout(timer);
  }, [loading]);
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
          color: bar.close >= bar.open ? paletteRef.current.upVolume : paletteRef.current.downVolume,
        })));
      } else {
        volumeSeriesRef.current.setData([]);
      }
    }
  }, [indicators]);

  useEffect(() => {
    updateIndicators();
  }, [updateIndicators]);

  /* A colour-vision change repaints the existing series in place: the candle
     options and the volume histogram must follow the token layer, while the
     feed, the loaded bars and the visible range stay untouched. */
  useEffect(() => {
    candleSeriesRef.current?.applyOptions({
      upColor: palette.up,
      downColor: palette.down,
      wickUpColor: palette.up,
      wickDownColor: palette.down,
    });
    updateIndicators();
  }, [palette, updateIndicators]);

  const loadedKeyRef = useRef<string | null>(null);
  const loadedSourceRef = useRef<string | null>(null);
  const historyControllerRef = useRef<AbortController | null>(null);

  const loadHistory = useCallback(async (signal: AbortSignal, force = false): Promise<void> => {
    const key = `${exchange}|${symbol}|${timeframe}`;
    const lastKnown = force ? undefined : barsRef.current.at(-1);
    /* After the initial 600-bar load, refreshes only need candles from the last
       known bar (inclusive, so the newest closed bar can still be corrected). */
    const incremental = !force && loadedKeyRef.current === key && lastKnown !== undefined;
    const url = `/api/market?kind=candles&exchange=${exchange}&symbol=${encodeURIComponent(symbol)}&timeframe=${timeframe}${incremental && lastKnown ? `&since=${lastKnown.timestamp}&limit=50` : "&limit=600"}`;
    const response = await fetch(url, { cache: "no-store", signal });
    const payload: unknown = await response.json();
    if (signal.aborted) throw new DOMException("The operation was aborted.", "AbortError");
    if (!response.ok) {
      const message = typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error === "string"
        ? payload.error
        : translate(MARKET_CHART_COPY).fetchFailed;
      throw new Error(message);
    }
    const parsed = parseCandleResponse(payload);
    const sanitizedCandles = sanitizeCandlesForChart(parsed.candles);
    /* A source change replaces the history; fixture/cache bars must never be
       spliced into a series from a different provider. */
    if (incremental && parsed.source !== loadedSourceRef.current) return loadHistory(signal, true);
    if (!incremental && sanitizedCandles.length === 0) throw new Error(translate(MARKET_CHART_COPY).noBars);
    loadedSourceRef.current = parsed.source;
    setSourceState({ key, source: parsed.source });
    setCacheInfo(parsed.cache);

    if (incremental && lastKnown) {
      const intervalMs = timeframeMilliseconds(timeframe);
      const incoming = sanitizeCandlesForChart(parsed.candles).filter((bar) => bar.timestamp >= lastKnown.timestamp);
      /* An empty incremental response means nothing closed or formed since the
         last poll: keep the existing history instead of churning the series. */
      if (incoming.length === 0) {
        setErrorState(null);
        setLoadedKey(key);
        loadedKeyRef.current = key;
        return;
      }
      const { merged, trimmed, seamGap } = mergeCandles(barsRef.current, incoming, intervalMs);
      /* A seam gap means the venue skipped intervals the chart still needs;
         replace the whole history instead of splicing a hole into it. */
      if (seamGap || findCandleGaps(merged, timeframe).length > 0) return loadHistory(signal, true);
      barsRef.current = merged;
      setLiveGapCount(0);
      setLiveLastBar(merged.at(-1) ?? null);
      /* update() replaces the most recent bar and appends newer ones; a trim
         removed older bars, which only setData can express. */
      if (trimmed) {
        candleSeriesRef.current?.setData(merged.map((bar) => ({ time: asUTCTime(bar.timestamp), open: bar.open, high: bar.high, low: bar.low, close: bar.close })));
      } else {
        for (const bar of incoming) {
          candleSeriesRef.current?.update({ time: asUTCTime(bar.timestamp), open: bar.open, high: bar.high, low: bar.low, close: bar.close });
        }
      }
      updateIndicators();
      setErrorState(null);
      setLoadedKey(key);
      loadedKeyRef.current = key;
      return;
    }

    barsRef.current = sanitizedCandles;
    hoveredBarRef.current = null;
    setHoveredBar(null);
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
    setLoadedKey(key);
    loadedKeyRef.current = key;
  }, [symbol, timeframe, exchange, updateIndicators]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let rangeTimer: ReturnType<typeof setTimeout> | undefined;
    const initialThemeOptions = themeOptions();
    const chart = createChart(container, {
      autoSize: false,
      width: container.clientWidth,
      height: container.clientHeight,
      layout: initialThemeOptions.layout,
      grid: initialThemeOptions.grid,
      crosshair: initialThemeOptions.crosshair,
      rightPriceScale: { ...initialThemeOptions.rightPriceScale, scaleMargins: { top: 0.08, bottom: 0.24 } },
      timeScale: { ...initialThemeOptions.timeScale, timeVisible: true, secondsVisible: false, rightOffset: 4 },
      localization: { locale: "en-US" },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
    });

    const candles = chart.addSeries(CandlestickSeries, {
      upColor: paletteRef.current.up,
      downColor: paletteRef.current.down,
      borderVisible: false,
      wickUpColor: paletteRef.current.up,
      wickDownColor: paletteRef.current.down,
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
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    historyControllerRef.current = controller;
    if (replayMode || loadedKeyRef.current !== dataKey) {
      loadedKeyRef.current = null;
      loadedSourceRef.current = null;
      setSourceState(null);
    }
    if (replayMode) {
      const rawBars = replayBars ?? [];
      const sanitized = sanitizeCandlesForChart(rawBars);
      const previous = replayBarsRef.current;
      /* Replay only appends closed bars; a step that merely extends the revealed
         history can update the series instead of resubmitting every bar. */
      const appended = previous !== null && sanitized.length > previous.length &&
        previous.every((bar, index) => sanitized[index]!.timestamp === bar.timestamp);
      barsRef.current = sanitized;
      if (appended) {
        for (let index = previous.length; index < sanitized.length; index++) {
          const bar = sanitized[index]!;
          candleSeriesRef.current?.update({
            time: asUTCTime(bar.timestamp), open: bar.open, high: bar.high, low: bar.low, close: bar.close,
          });
        }
      } else {
        candleSeriesRef.current?.setData(sanitized.map((bar) => ({
          time: asUTCTime(bar.timestamp), open: bar.open, high: bar.high, low: bar.low, close: bar.close,
        })));
      }
      updateIndicators();
      if (sanitized.length > 0 && (prevReplayLengthRef.current === 0 || sanitized.length < prevReplayLengthRef.current)) {
        chartRef.current?.timeScale().fitContent();
      }
      replayBarsRef.current = sanitized;
      prevReplayLengthRef.current = sanitized.length;
      return () => controller.abort();
    }
    void Promise.resolve().then(() => loadHistory(controller.signal)).catch((reason: unknown) => {
      if (isAbortError(reason)) return;
      setErrorState({ key: dataKey, message: reason instanceof Error ? reason.message : translate(MARKET_CHART_COPY).requestFailed });
    });
    return () => controller.abort();
  }, [loadHistory, symbol, timeframe, replayMode, replayBars, dataKey, updateIndicators]);

  useEffect(() => {
    const intervalMs = timeframeMilliseconds(timeframe);
    if (replayMode || source === null) return;
    const controller = new AbortController();
    const refresh = (onSuccess?: () => void, onFailure?: () => void): void => {
      void loadHistory(controller.signal)
        .then(() => {
          if (!controller.signal.aborted) onSuccess?.();
        })
        .catch((reason: unknown) => {
          if (isAbortError(reason) || controller.signal.aborted) return;
          onFailure?.();
        });
    };
    if (!nativeStream) {
      setStream("polling");
      const pollingMs = Math.max(15_000, Math.min(60_000, intervalMs / 4));
      const timer = window.setInterval(() => {
        if (typeof document !== "undefined" && document.hidden) return;
        refresh(() => setStream("polling"), () => setStream("unavailable"));
      }, pollingMs);
      return () => {
        window.clearInterval(timer);
        controller.abort();
      };
    }
    const streamUrl = `wss://stream.binance.com:9443/ws/${symbol.replace("/", "").toLowerCase()}@kline_${timeframe}`;
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    let attempt = 0;

    const isCurrentSource = (): boolean => !disposed && !controller.signal.aborted && loadedKeyRef.current === dataKey && loadedSourceRef.current === source;
    const connect = (): void => {
      if (!isCurrentSource()) return;
      setStream(attempt === 0 ? "connecting" : "reconnecting");
      try {
        socket = new WebSocket(streamUrl);
      } catch {
        scheduleReconnect();
        return;
      }
      socket.onopen = () => {
        if (!isCurrentSource()) return;
        const wasReconnect = attempt > 0;
        attempt = 0;
        setStream("live");
        if (wasReconnect) refresh(undefined, () => setStream("reconnecting"));
      };
      socket.onmessage = (event: MessageEvent<string>) => {
        if (!isCurrentSource()) return;
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
          refresh(undefined, () => setStream("reconnecting"));
        }
        if (last && parsed.candle.timestamp < last.timestamp) return;
        if (last && parsed.candle.timestamp === last.timestamp) {
          existing[existing.length - 1] = parsed.candle;
        } else {
          existing.push(parsed.candle);
          if (existing.length > 1000) existing.splice(0, existing.length - 1000);
        }
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
            color: parsed.candle.close >= parsed.candle.open ? paletteRef.current.upVolume : paletteRef.current.downVolume,
          });
        }
        if (parsed.closed) {
          const gaps = findCandleGaps(barsRef.current, timeframe);
          setLiveGapCount(gaps.length);
          updateIndicators();
        }
      };
      socket.onerror = () => { if (!disposed) socket?.close(); };
      socket.onclose = () => {
        if (!disposed) scheduleReconnect();
      };
    };

    const scheduleReconnect = (): void => {
      if (!isCurrentSource() || reconnectTimer) return;
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
      controller.abort();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [symbol, timeframe, exchange, loadHistory, replayMode, indicators.volume, updateIndicators, source, nativeStream, dataKey]);

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
        color: trade.side === "long" ? paletteRef.current.up : paletteRef.current.down,
        shape: trade.side === "long" ? "arrowUp" as const : "arrowDown" as const,
        text: `IN ${trade.side.toUpperCase()}`,
      },
      {
        time: asUTCTime(trade.exitTime),
        position: trade.side === "long" ? "aboveBar" as const : "belowBar" as const,
        color: trade.netPnl >= 0 ? paletteRef.current.up : paletteRef.current.down,
        shape: trade.side === "long" ? "arrowDown" as const : "arrowUp" as const,
        text: trade.exitReason === "end-of-data" ? "OUT" : trade.exitReason.replaceAll("-", " ").toUpperCase(),
      },
    ]).filter((m) => Number.isFinite(m.time) && (m.time as number) > 0).sort((a, b) => Number(a.time) - Number(b.time)) ?? [];
    markersRef.current.setMarkers(markers);
  }, [backtest, replayMode]);

  const effectiveStream: StreamState = source === null ? "connecting" : !nativeStream && stream !== "unavailable" ? "polling" : stream;
  const streamLabel = replayMode
    ? copy.streamReplay
    : fixtureSource ? copy.streamFixture
    : effectiveStream === "live"
      ? copy.streamLive
      : effectiveStream === "connecting"
        ? copy.streamConnecting
        : effectiveStream === "polling"
          ? copy.streamPoll(Math.round(Math.max(15_000, Math.min(60_000, timeframeMilliseconds(timeframe) / 4)) / 1000))
          : effectiveStream === "unavailable"
            ? copy.streamOffline
            : copy.streamReconnecting;
  const StreamIcon = replayMode ? Clock3 : effectiveStream === "live" ? Wifi : effectiveStream === "connecting" ? Radio : effectiveStream === "polling" ? Clock3 : WifiOff;

  const displayBar = hoveredBar ?? (lastBar ? { timestamp: lastBar.timestamp, open: lastBar.open, high: lastBar.high, low: lastBar.low, close: lastBar.close, volume: lastBar.volume } : null);

  return (
    <section className="chart-shell" data-testid="market-chart" aria-label={copy.chartAria}>
      <div className="chart-meta flex items-center justify-between gap-2 px-3 py-1.5 bg-[var(--ak-surface-sunken)] border-b border-[var(--ak-border-subtle)] font-mono text-[11px]">
        <div className="chart-meta-left flex items-center gap-2.5 overflow-x-auto min-w-0">
          {displayBar ? (
            <>
              {displayBar.timestamp > 0 && (
                <span className="text-[10px] text-[var(--ak-text-secondary)] opacity-75">
                  {new Date(displayBar.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </span>
              )}
              <span>{copy.legendOpen} <b className="text-[var(--ak-text-primary)]">{formatQuotePrice(displayBar.open)}</b></span>
              <span>{copy.legendHigh} <b className="text-[var(--ak-text-primary)]">{formatQuotePrice(displayBar.high)}</b></span>
              <span>{copy.legendLow} <b className="text-[var(--ak-text-primary)]">{formatQuotePrice(displayBar.low)}</b></span>
              <span>{copy.legendClose} <b className={displayBar.close >= displayBar.open ? "text-[var(--ak-signal-success)]" : "text-[var(--ak-signal-danger)]"}>{formatQuotePrice(displayBar.close)}</b></span>
              {displayBar.volume != null && indicators.volume && (
                <span className="text-[var(--ak-text-secondary)]">{copy.legendVolume} <b className="text-[var(--ak-text-primary)]">{displayBar.volume.toLocaleString(undefined, { maximumFractionDigits: 2 })}</b></span>
              )}
            </>
          ) : (
            /* No bar yet: the empty legend prints the same ledger a populated one
               would, with the values missing, instead of restating the overlay's
               sentence a second time. */
            <span className="text-[var(--ak-text-secondary)] tabular-nums">
              {copy.legendOpen} — · {copy.legendHigh} — · {copy.legendLow} — · {copy.legendClose} —
            </span>
          )}
        </div>
        <div className="chart-meta-right flex items-center gap-3 shrink-0">
          <div className="indicator-toggles flex items-center gap-1" role="toolbar" aria-label={copy.indicatorToolbar}>
            <button
              type="button"
              className="chart-toggle"
              onClick={() => setIndicators((prev) => ({ ...prev, sma20: !prev.sma20 }))}
              aria-pressed={indicators.sma20}
              title={copy.toggleSma20}
            >
              SMA20
            </button>
            <button
              type="button"
              className="chart-toggle"
              onClick={() => setIndicators((prev) => ({ ...prev, sma50: !prev.sma50 }))}
              aria-pressed={indicators.sma50}
              title={copy.toggleSma50}
            >
              SMA50
            </button>
            <button
              type="button"
              className="chart-toggle"
              onClick={() => setIndicators((prev) => ({ ...prev, ema20: !prev.ema20 }))}
              aria-pressed={indicators.ema20}
              title={copy.toggleEma20}
            >
              EMA20
            </button>
            <button
              type="button"
              className="chart-toggle"
              onClick={() => setIndicators((prev) => ({ ...prev, bb: !prev.bb }))}
              aria-pressed={indicators.bb}
              title={copy.toggleBb}
            >
              BB
            </button>
            <button
              type="button"
              className="chart-toggle"
              onClick={() => setIndicators((prev) => ({ ...prev, volume: !prev.volume }))}
              aria-pressed={indicators.volume}
              title={copy.toggleVolume}
            >
              VOL
            </button>
          </div>
          <div className={`stream-indicator ${replayMode ? "stream-replay" : `stream-${effectiveStream}`} flex items-center gap-1.5 text-[10px] whitespace-nowrap`}>
            <StreamIcon size={12} />
            <span>{streamLabel}</span>
          </div>
        </div>
      </div>
      <div className="chart-stage">
        <div ref={containerRef} className="chart-canvas" />
        {loading && (
          <div className="chart-overlay" role="status">
            <LoaderCircle className="spin" size={14} aria-hidden="true" />
            <span>{slow ? copy.loadingSlow(venueLabel) : copy.loadVenueHistory(venueLabel)}</span>
          </div>
        )}
        {error && (
          <div className="chart-overlay chart-error" role="alert">
            <div className="chart-error-plate stripe-edge">
              <div className="chart-error-copy">
                <AlertTriangle size={16} aria-hidden="true" />
                <div className="chart-error-message">
                  <strong className="chart-error-title">{copy.candlesUnavailable}</strong>
                  <details className="chart-error-details">
                    <summary>{copy.errorDetails}</summary>
                    <pre>{error}</pre>
                  </details>
                </div>
              </div>
              <button
                className="link-button"
                onClick={() => {
                  setErrorState(null);
                  setRefreshing(true);
                  const controller = historyControllerRef.current;
                  if (!controller || controller.signal.aborted) { setRefreshing(false); return; }
                  void loadHistory(controller.signal)
                    .catch((reason: unknown) => {
                      if (isAbortError(reason) || controller.signal.aborted) return;
                      setErrorState({ key: dataKey, message: reason instanceof Error ? reason.message : translate(MARKET_CHART_COPY).retryFailed });
                    })
                    .finally(() => setRefreshing(false));
                }}
              >
                {copy.retry}
              </button>
            </div>
          </div>
        )}
        {replayMode && replayBars.length === 0 && (
          <div className="chart-overlay" role="status">
            <Clock3 size={16} />
            <span>{copy.replayEmpty}</span>
          </div>
        )}
      </div>
      <div className="chart-footer">
        <span>{!replayMode && cacheInfo.fallback
          ? <><AlertTriangle size={11} /> {copy.localCache(cacheInfo.cachedAt ? new Date(cacheInfo.cachedAt).toLocaleString() : copy.timeUnavailable)}</>
          : replayMode ? copy.futureNotLoaded : fixtureSource ? `UTC · ${copy.streamFixture}` : gapCount > 0 ? <><AlertTriangle size={11} /> {copy.gapsDetected(gapCount)}</> : source === null ? copy.sourcePending : source.endsWith(" via CCXT") ? copy.publicSpot(venueLabel) : `UTC · ${source}`}</span>
        <a href="https://www.tradingview.com/lightweight-charts/" target="_blank" rel="noreferrer">Charts by TradingView · Lightweight Charts™</a>
      </div>
    </section>
  );
});
