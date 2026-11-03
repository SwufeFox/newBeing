import type { UTCTimestamp } from "lightweight-charts";
import type { Candle } from "@newbeing/core";

export function asUTCTime(timestampMs: number): UTCTimestamp {
  return Math.floor(timestampMs / 1000) as UTCTimestamp;
}

export interface CandleMergeResult {
  merged: Candle[];
  /** True when the merge pushed history past the cap and older bars were dropped. */
  trimmed: boolean;
  /** True when the incoming bars start after a skipped interval of the existing history. */
  seamGap: boolean;
}

/** Merge freshly fetched candles (from an inclusive `since` fetch) into the
 *  existing chart history. Bars with the newest known timestamp replace it
 *  (venue corrections and forming-bar updates); strictly newer bars append.
 *  A start after a skipped interval of the existing history is reported as a
 *  seam gap so the caller can reload the full history instead of splicing a
 *  hole into the series. */
export function mergeCandles(existing: readonly Candle[], incoming: readonly Candle[], intervalMs: number, maxLength = 1000): CandleMergeResult {
  const sorted = [...incoming].sort((a, b) => a.timestamp - b.timestamp);
  const last = existing.at(-1);
  if (!last) return { merged: sorted, trimmed: sorted.length > maxLength, seamGap: false };
  if (sorted.length === 0 || sorted[0]!.timestamp > last.timestamp + intervalMs) {
    return { merged: [...existing], trimmed: false, seamGap: true };
  }
  const merged = existing.slice();
  for (const bar of sorted) {
    if (bar.timestamp < last.timestamp) continue; // stale rows cannot rewrite confirmed history
    const current = merged.at(-1);
    if (current && bar.timestamp === current.timestamp) merged[merged.length - 1] = bar;
    else merged.push(bar);
  }
  let trimmed = false;
  if (merged.length > maxLength) {
    merged.splice(0, merged.length - maxLength);
    trimmed = true;
  }
  return { merged, trimmed, seamGap: false };
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

  // Sliding-window Welford updates are well conditioned at any price scale: both the mean and the
  // squared-deviation accumulator track the window itself, so no fixed reference is needed.
  let mean = sanitized[0]!.close;
  let s = 0;

  for (let i = 1; i < sanitized.length; i++) {
    if (i < p) {
      const x = sanitized[i]!.close;
      const d = x - mean;
      mean += d / (i + 1);
      s += d * (x - mean);
    } else {
      const a = sanitized[i]!.close;
      const r = sanitized[i - p]!.close;
      const oldMean = mean;
      mean += (a - r) / p;
      s += (a - r) * (a - mean + r - oldMean);
    }
    if (i < p - 1) continue;

    const variance = Math.max(0, s / p);
    const stdDev = Math.sqrt(variance);
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
