import type { UTCTimestamp } from "lightweight-charts";
import type { Candle } from "@newbeing/core";

export function asUTCTime(timestampMs: number): UTCTimestamp {
  return Math.floor(timestampMs / 1000) as UTCTimestamp;
}

export function floorToDecimals(value: number, decimals: number = 4): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const factor = 10 ** decimals;
  return Math.floor(value * factor + 1e-9) / factor;
}

export function sanitizeCandlesForChart(candles: readonly Candle[] | Candle[]): Candle[] {
  if (!candles || candles.length === 0) return [];
  const valid = candles
    .filter((c) =>
      typeof c === "object" && c !== null &&
      Number.isFinite(c.timestamp) && c.timestamp > 0 &&
      Number.isFinite(c.open) &&
      Number.isFinite(c.high) &&
      Number.isFinite(c.low) &&
      Number.isFinite(c.close)
    )
    .map((c) => ({
      ...c,
      volume: Number.isFinite(c.volume) && (c.volume ?? 0) >= 0 ? Number(c.volume) : 0,
    }));
  valid.sort((a, b) => a.timestamp - b.timestamp);
  const result: Candle[] = [];
  let lastSec = -1;
  for (const bar of valid) {
    const sec = Math.floor(bar.timestamp / 1000);
    if (sec > lastSec) {
      result.push(bar);
      lastSec = sec;
    } else if (result.length > 0) {
      result[result.length - 1] = bar;
    }
  }
  return result;
}

function roundSafe(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 1e8) / 1e8 : 0;
}

export function calculateSMA(candles: Candle[], period: number): Array<{ time: UTCTimestamp; value: number }> {
  const p = Math.floor(period);
  if (!Number.isFinite(p) || p < 1 || candles.length < p) return [];
  const sanitized = sanitizeCandlesForChart(candles);
  if (sanitized.length < p) return [];
  const result: Array<{ time: UTCTimestamp; value: number }> = [];
  let sum = 0;
  for (let i = 0; i < sanitized.length; i++) {
    sum += sanitized[i]!.close;
    if (i >= p) {
      sum -= sanitized[i - p]!.close;
    }
    if (i >= p - 1) {
      const val = roundSafe(sum / p);
      if (Number.isFinite(val)) {
        result.push({
          time: asUTCTime(sanitized[i]!.timestamp),
          value: val,
        });
      }
    }
  }
  return result;
}

export function calculateEMA(candles: Candle[], period: number): Array<{ time: UTCTimestamp; value: number }> {
  const p = Math.floor(period);
  if (!Number.isFinite(p) || p < 1 || candles.length < p) return [];
  const sanitized = sanitizeCandlesForChart(candles);
  if (sanitized.length < p) return [];
  const result: Array<{ time: UTCTimestamp; value: number }> = [];
  const k = 2 / (p + 1);
  let ema = 0;
  for (let i = 0; i < p; i++) {
    ema += sanitized[i]!.close;
  }
  ema /= p;
  result.push({
    time: asUTCTime(sanitized[p - 1]!.timestamp),
    value: roundSafe(ema),
  });

  for (let i = p; i < sanitized.length; i++) {
    ema = (sanitized[i]!.close - ema) * k + ema;
    const val = roundSafe(ema);
    if (Number.isFinite(val)) {
      result.push({
        time: asUTCTime(sanitized[i]!.timestamp),
        value: val,
      });
    }
  }
  return result;
}

export function calculateBollingerBands(candles: Candle[], period: number = 20, multiplier: number = 2): {
  upper: Array<{ time: UTCTimestamp; value: number }>;
  lower: Array<{ time: UTCTimestamp; value: number }>;
} {
  const p = Math.floor(period);
  if (!Number.isFinite(p) || p < 1 || !Number.isFinite(multiplier) || candles.length < p) {
    return { upper: [], lower: [] };
  }
  const sanitized = sanitizeCandlesForChart(candles);
  if (sanitized.length < p) return { upper: [], lower: [] };
  const upper: Array<{ time: UTCTimestamp; value: number }> = [];
  const lower: Array<{ time: UTCTimestamp; value: number }> = [];

  for (let i = p - 1; i < sanitized.length; i++) {
    let sum = 0;
    for (let j = i - p + 1; j <= i; j++) {
      sum += sanitized[j]!.close;
    }
    const mean = sum / p;
    let varianceSum = 0;
    for (let j = i - p + 1; j <= i; j++) {
      varianceSum += (sanitized[j]!.close - mean) ** 2;
    }
    const stdDev = Math.sqrt(Math.max(0, varianceSum / p));
    const time = asUTCTime(sanitized[i]!.timestamp);
    const upVal = roundSafe(mean + multiplier * stdDev);
    const lowVal = roundSafe(mean - multiplier * stdDev);
    if (Number.isFinite(upVal) && Number.isFinite(lowVal)) {
      upper.push({ time, value: upVal });
      lower.push({ time, value: lowVal });
    }
  }
  return { upper, lower };
}
