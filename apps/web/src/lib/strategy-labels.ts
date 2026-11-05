"use client";

import type { CopyTable } from "@/lib/i18n";

/**
 * One label per strategy parameter, shared by every panel that lists them.
 *
 * Strategy ids and parameter keys are engine identifiers and never translate;
 * the human label does. Keeping the map in one module is what stops the rail,
 * the strategy lab, the sweep panel and the evaluation panel from drifting into
 * three slightly different names for the same field.
 */
export const PARAMETER_LABELS: CopyTable<Record<string, string>> = {
  en: {
    fastPeriod: "Fast Period",
    slowPeriod: "Slow Period",
    allowShorts: "Allow Shorts",
    period: "Period",
    oversold: "Oversold",
    exitLong: "Exit Long",
    overbought: "Overbought",
    exitShort: "Exit Short",
    lookback: "Lookback",
    thresholdPct: "Threshold Pct",
    reversal: "Reversal",
  },
  zh: {
    fastPeriod: "快线周期",
    slowPeriod: "慢线周期",
    allowShorts: "允许做空",
    period: "周期",
    oversold: "超卖",
    exitLong: "多头离场",
    overbought: "超买",
    exitShort: "空头离场",
    lookback: "回看窗口",
    thresholdPct: "阈值%",
    reversal: "反转",
  },
};

/**
 * Strategy display names. Ids stay in English in the engine and in provenance;
 * only the label a user reads is translated.
 */
export const STRATEGY_NAMES: CopyTable<Record<string, string>> = {
  en: {
    "sma-crossover": "Moving Average Crossover",
    "rsi-mean-reversion": "RSI Mean Reversion",
    "momentum-reversal": "N-day Momentum / Reversal",
  },
  zh: {
    "sma-crossover": "均线交叉",
    "rsi-mean-reversion": "RSI 均值回归",
    "momentum-reversal": "N 日动量 / 反转",
  },
};

/** Fallback prose when a strategy has no parameter-derived execution summary. */
export const STRATEGY_DESCRIPTIONS: CopyTable<Record<string, string>> = {
  en: {
    "sma-crossover": "Long when the fast SMA is above the slow SMA; flat or short when below.",
    "rsi-mean-reversion": "Buy oversold readings and exit near the center; optionally short overbought readings.",
    "momentum-reversal": "Follow a normalized N-bar move, or invert it for a mean-reversion experiment.",
  },
  zh: {
    "sma-crossover": "快线位于慢线上方时做多，下方时空仓或做空。",
    "rsi-mean-reversion": "超卖时买入、回到中位附近离场；可选择在超买时做空。",
    "momentum-reversal": "跟随归一化的 N 根 K 线变动，也可反转为均值回归实验。",
  },
};
