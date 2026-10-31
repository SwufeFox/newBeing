import { createHash } from "node:crypto";
import os from "node:os";
import { performance } from "node:perf_hooks";
import { compileFactor } from "../dist/factor.js";
import { runBacktest } from "../dist/backtest.js";

const MARKET_COUNT = Number(process.env.SYNTH_MARKETS ?? 4443);
const BAR_COUNT = Number(process.env.SYNTH_BARS ?? 1000);
const WARMUPS = Number(process.env.SYNTH_WARMUPS ?? 1);
const REPEATS = Number(process.env.SYNTH_REPEATS ?? 3);
for (const [name, value, minimum] of [["SYNTH_MARKETS", MARKET_COUNT, 1], ["SYNTH_BARS", BAR_COUNT, 2], ["SYNTH_WARMUPS", WARMUPS, 0], ["SYNTH_REPEATS", REPEATS, 1]]) {
  if (!Number.isInteger(value) || value < minimum) throw new Error(`${name} must be an integer >= ${minimum}`);
}

const names = Array.from({ length: 64 }, (_, i) => `v${i + 1}`);
const statements = [];
let previous = "close";
for (let i = 0; i < 32; i += 1) {
  statements.push(`${names[i]} = ts_mean(${previous}, 5);`);
  previous = names[i];
}
for (let i = 32; i < 62; i += 1) {
  statements.push(`${names[i]} = ${previous} + 1;`);
  previous = names[i];
}
statements.push(`v63 = close > ${previous};`, "v64 = v63 && 1;");
const expression = `${statements.join("\n")}\nv64`;
const compiled = compileFactor(expression);
if (!compiled.ok || !compiled.plan) throw new Error(compiled.errors.map((error) => error.message).join("; "));
const plan = compiled.plan;

const utcStart = Date.UTC(2010, 0, 1);
const DAY = 86_400_000;
function makeCandles(market, count = BAR_COUNT) {
  const marketScale = 25 + ((market * 7919) % 5000) / 100;
  const phase = (market % 997) * 0.0137;
  const drift = ((market % 19) - 9) * 0.00004;
  const candles = new Array(count);
  let previousClose = marketScale;
  for (let t = 0; t < count; t += 1) {
    const wave = Math.sin(t / 23 + phase) * 0.035 + Math.sin(t / 7 + phase * 0.31) * 0.012;
    const close = marketScale * (1 + wave + drift * t);
    const open = t === 0 ? close : previousClose;
    const spread = marketScale * (0.001 + ((market + t) % 7) * 0.0001);
    candles[t] = {
      timestamp: utcStart + t * DAY,
      open,
      high: Math.max(open, close) + spread,
      low: Math.min(open, close) - spread,
      close,
      volume: 1000 + ((market * 104729 + t * 1543) % 900000) / 10,
    };
    previousClose = close;
  }
  return candles;
}

// Independent, deliberately straightforward oracle for this exact 64-node expression.
function referenceValues(candles) {
  let values = candles.map((candle) => candle.close);
  for (let stage = 0; stage < 32; stage += 1) {
    const next = new Array(candles.length).fill(null);
    for (let t = 4; t < candles.length; t += 1) {
      let sum = 0;
      let valid = true;
      for (let k = t - 4; k <= t; k += 1) {
        if (values[k] === null) { valid = false; break; }
        sum += values[k];
      }
      if (valid) next[t] = sum / 5;
    }
    values = next;
  }
  for (let i = 0; i < 30; i += 1) values = values.map((value) => value === null ? null : value + 1);
  return values.map((value, t) => value === null ? null : +(candles[t].close > value));
}
function updateValuesHash(hash, values) {
  const encoded = new Float64Array(values.length);
  for (let index = 0; index < values.length; index += 1) encoded[index] = values[index] === null ? Number.NaN : values[index];
  hash.update(encoded);
}
function valuesHash(valueSets) {
  const hash = createHash("sha256");
  for (const values of valueSets) updateValuesHash(hash, values);
  return hash.digest("hex");
}
function signalsHash(signals) {
  return createHash("sha256").update(signals).digest("hex");
}
function stringsHash(strings) {
  const hash = createHash("sha256");
  for (const value of strings) hash.update(`${value}\n`);
  return hash.digest("hex");
}
function referenceCheck() {
  const checkMarkets = Math.min(4, MARKET_COUNT);
  const checkBars = Math.min(96, BAR_COUNT);
  const checked = [];
  for (let market = 0; market < checkMarkets; market += 1) {
    const candles = makeCandles(market, checkBars);
    const actual = plan.evaluate(candles);
    const expected = referenceValues(candles);
    if (!actual.ok || !actual.values || JSON.stringify(actual.values) !== JSON.stringify(expected)) {
      throw new Error(`Independent 64-node reference mismatch for market ${market}`);
    }
    checked.push(actual.values);
  }
  return { markets: checkMarkets, barsPerMarket: checkBars, match: true, hash: valuesHash(checked) };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
function summarize(samples, workUnits) {
  const mid = median(samples);
  return {
    medianMs: +mid.toFixed(3),
    rangeMs: [+Math.min(...samples).toFixed(3), +Math.max(...samples).toFixed(3)],
    unitsPerSecond: Math.round(workUnits / (mid / 1000)),
  };
}
function memoryMB(bytes) { return +(bytes / 1048576).toFixed(2); }
function measure(label, run, units) {
  const samples = [];
  const stageSamples = new Map();
  const heapDeltas = [];
  const arrayBufferDeltas = [];
  let outputHash;
  for (let iteration = 0; iteration < WARMUPS + REPEATS; iteration += 1) {
    globalThis.gc?.();
    const beforeMemory = process.memoryUsage();
    const result = run();
    const afterMemory = process.memoryUsage();
    const elapsed = result.elapsedMs ?? 0;
    if (iteration >= WARMUPS) {
      samples.push(elapsed);
      heapDeltas.push(afterMemory.heapUsed - beforeMemory.heapUsed);
      arrayBufferDeltas.push(afterMemory.arrayBuffers - beforeMemory.arrayBuffers);
      for (const [name, milliseconds] of Object.entries(result.stages ?? {})) {
        const values = stageSamples.get(name) ?? [];
        values.push(milliseconds);
        stageSamples.set(name, values);
      }
    }
    if (outputHash !== undefined && outputHash !== result.hash) throw new Error(`${label} output changed between repetitions`);
    outputHash = result.hash;
  }
  const stages = Object.fromEntries([...stageSamples].map(([name, values]) => [name, +median(values).toFixed(3)]));
  return {
    ...summarize(samples, units),
    stagesMedianMs: stages,
    heapDeltaMedianMB: memoryMB(median(heapDeltas)),
    arrayBufferDeltaMedianMB: memoryMB(median(arrayBufferDeltas)),
    deterministicHash: outputHash,
  };
}

const totalBars = MARKET_COUNT * BAR_COUNT;
function evaluatePanel(destination = null) {
  const hash = createHash("sha256");
  let factorEvaluationMs = 0;
  let panelMaterializationMs = 0;
  for (let market = 0; market < MARKET_COUNT; market += 1) {
    const candles = makeCandles(market);
    const started = performance.now();
    const result = plan.evaluate(candles);
    factorEvaluationMs += performance.now() - started;
    if (!result.ok || !result.values) throw new Error(result.errors.map((error) => error.message).join("; "));
    if (destination) {
      const copyStarted = performance.now();
      const offset = market * BAR_COUNT;
      for (let t = 0; t < BAR_COUNT; t += 1) destination[offset + t] = result.values[t] === null ? Number.NaN : result.values[t];
      panelMaterializationMs += performance.now() - copyStarted;
    }
    updateValuesHash(hash, result.values);
  }
  return {
    hash: hash.digest("hex"),
    factorEvaluationMs,
    panelMaterializationMs,
    elapsedMs: factorEvaluationMs + panelMaterializationMs,
  };
}
function rankSignals(valuePanel) {
  const signals = new Int8Array(totalBars);
  const ranked = new Int32Array(MARKET_COUNT);
  for (let t = 0; t < BAR_COUNT; t += 1) {
    let validCount = 0;
    for (let market = 0; market < MARKET_COUNT; market += 1) {
      const value = valuePanel[market * BAR_COUNT + t];
      if (Number.isFinite(value)) ranked[validCount++] = market;
    }
    if (validCount < 2) continue;
    ranked.subarray(0, validCount).sort((left, right) => valuePanel[left * BAR_COUNT + t] - valuePanel[right * BAR_COUNT + t] || left - right);
    const tailCount = Math.max(1, Math.ceil(validCount / 5));
    for (let rank = 0; rank < tailCount; rank += 1) signals[ranked[rank] * BAR_COUNT + t] = -1;
    for (let rank = validCount - tailCount; rank < validCount; rank += 1) signals[ranked[rank] * BAR_COUNT + t] = 1;
  }
  return signals;
}

let currentValues = [];
let currentSides = new Int8Array(0);
const longFlatStrategy = {
  id: "synthetic-factor-long-flat", name: "Synthetic factor long/flat", version: "1",
  description: "Benchmark adapter: positive factor values target long; zero/null target flat.", defaults: {},
  createSignalStream: () => {
    let index = 0;
    return { next: () => { const value = currentValues[index++]; return value == null || value === 0 ? "flat" : "long"; } };
  },
  signalAt: (_candles, index) => { const value = currentValues[index]; return value == null || value === 0 ? "flat" : "long"; },
};
const longShortRankStrategy = {
  id: "synthetic-cross-sectional-rank", name: "Synthetic cross-sectional rank", version: "1",
  description: "Benchmark adapter: bottom quintile short, top quintile long, others flat.", defaults: {},
  createSignalStream: () => {
    let index = 0;
    return { next: () => { const side = currentSides[index++]; return side < 0 ? "short" : side > 0 ? "long" : "flat"; } };
  },
  signalAt: (_candles, index) => currentSides[index] < 0 ? "short" : currentSides[index] > 0 ? "long" : "flat",
};
function simulateMarket(market, candles, evaluated) {
  if (!evaluated.ok || !evaluated.values) throw new Error("Factor evaluation failed before single-market backtest");
  currentValues = evaluated.values;
  try {
    const result = runBacktest({
      candles, symbol: `M${String(market).padStart(6, "0")}/USD`, timeframe: "1d", exchange: "synthetic",
      datasetId: "deterministic-synthetic-ohlcv-v1", strategy: longFlatStrategy, parameters: {},
      config: { initialCapital: 10_000, positionFraction: 0.1, feeRate: 0.001, slippageRate: 0.0005, allowShorts: false },
      resultId: `synthetic-${market}`, createdAt: "2010-01-01T00:00:00.000Z",
    });
    return `${result.metrics.finalEquity}:${result.metrics.tradeCount}:${result.metrics.totalFees}`;
  } finally {
    currentValues = [];
  }
}
function simulateRankedMarket(market, candles, sides) {
  currentSides = sides;
  try {
    const result = runBacktest({
      candles, symbol: `M${String(market).padStart(6, "0")}/USD`, timeframe: "1d", exchange: "synthetic",
      datasetId: "deterministic-synthetic-ohlcv-v1", strategy: longShortRankStrategy, parameters: {},
      config: { accountMode: "legacy-margin", initialCapital: 10_000, positionFraction: 0.1, feeRate: 0.001, slippageRate: 0.0005, allowShorts: true },
      resultId: `synthetic-rank-${market}`, createdAt: "2010-01-01T00:00:00.000Z",
    });
    return `${result.metrics.finalEquity}:${result.metrics.tradeCount}:${result.metrics.totalFees}`;
  } finally {
    currentSides = new Int8Array(0);
  }
}
function measuredBacktests() {
  const samples = [];
  const heapDeltas = [];
  const arrayBufferDeltas = [];
  let outputHash;
  for (let iteration = 0; iteration < WARMUPS + REPEATS; iteration += 1) {
    globalThis.gc?.();
    const beforeMemory = process.memoryUsage();
    const summaries = new Array(MARKET_COUNT);
    let elapsedMs = 0;
    for (let market = 0; market < MARKET_COUNT; market += 1) {
      const candles = makeCandles(market);
      const evaluated = plan.evaluate(candles);
      if (!evaluated.ok || !evaluated.values) throw new Error("Factor evaluation failed before single-market backtest");
      const start = performance.now();
      summaries[market] = simulateMarket(market, candles, evaluated);
      elapsedMs += performance.now() - start;
    }
    const afterMemory = process.memoryUsage();
    const currentHash = stringsHash(summaries);
    if (outputHash !== undefined && outputHash !== currentHash) throw new Error("single-market backtest output changed between repetitions");
    outputHash = currentHash;
    if (iteration >= WARMUPS) {
      samples.push(elapsedMs);
      heapDeltas.push(afterMemory.heapUsed - beforeMemory.heapUsed);
      arrayBufferDeltas.push(afterMemory.arrayBuffers - beforeMemory.arrayBuffers);
    }
  }
  return {
    ...summarize(samples, totalBars),
    heapDeltaMedianMB: memoryMB(median(heapDeltas)),
    arrayBufferDeltaMedianMB: memoryMB(median(arrayBufferDeltas)),
    deterministicHash: outputHash,
  };
}

const reference = referenceCheck();
const generationStarted = performance.now();
let generatedBars = 0;
for (let market = 0; market < MARKET_COUNT; market += 1) generatedBars += makeCandles(market).length;
const dataGenerationMs = performance.now() - generationStarted;
const factors = measure("factor evaluation", () => {
  const result = evaluatePanel();
  return { hash: result.hash, elapsedMs: result.factorEvaluationMs, stages: { factorEvaluationMs: result.factorEvaluationMs } };
}, totalBars);

// Store factor scores as one compact market-major Float64Array, not thousands of JS object bars.
let panel = new Float64Array(totalBars);
const panelBuild = evaluatePanel(panel);
const sorting = measure("cross-sectional sorting", () => {
  const start = performance.now();
  const signals = rankSignals(panel);
  const elapsedMs = performance.now() - start;
  return { hash: signalsHash(signals), elapsedMs };
}, totalBars);
panel = null;

const backtest = measuredBacktests();
const endToEnd = measure("factor, cross-sectional rank, independent account simulations", () => {
  const scores = new Float64Array(totalBars);
  const factorPass = evaluatePanel(scores);
  const rankStarted = performance.now();
  const sides = rankSignals(scores);
  const rankingMs = performance.now() - rankStarted;
  const summaries = new Array(MARKET_COUNT);
  let simulationMs = 0;
  for (let market = 0; market < MARKET_COUNT; market += 1) {
    const candles = makeCandles(market);
    const start = performance.now();
    summaries[market] = simulateRankedMarket(market, candles, sides.subarray(market * BAR_COUNT, (market + 1) * BAR_COUNT));
    simulationMs += performance.now() - start;
  }
  const hash = createHash("sha256").update(signalsHash(sides));
  hash.update(stringsHash(summaries));
  const stages = {
    factorEvaluationMs: factorPass.factorEvaluationMs,
    panelMaterializationMs: factorPass.panelMaterializationMs,
    crossSectionalRankingMs: rankingMs,
    independentAccountSimulationMs: simulationMs,
  };
  const elapsedMs = Object.values(stages).reduce((sum, value) => sum + value, 0);
  return { hash: hash.digest("hex"), elapsedMs, stages };
}, totalBars);
const finalMemory = process.memoryUsage();
const maxRss = process.resourceUsage?.().maxRSS;

console.log(JSON.stringify({
  benchmark: "offline synthetic cross-sectional factor/rank/per-market execution stress benchmark",
  scope: { markets: MARKET_COUNT, barsPerMarket: BAR_COUNT, totalBars, timeframe: "UTC 1d", quoteAsset: "synthetic USD", sharedGrid: true, compiledPlanReused: true, execution: "rank synchronously, then simulate each market in an independent account and discard full curves" },
  dataGenerationMs: +dataGenerationMs.toFixed(3),
  generatedBars,
  factor64: factors,
  sortingMicrobenchmark: { label: "横截面排名微基准", method: "each UTC bar: exclude null/nonfinite scores, rank deterministically by score then market index, assign bottom/top 20% short/long signals", panelMaterializationMs: +panelBuild.panelMaterializationMs.toFixed(3), ...sorting },
  singleMarketLongFlatBacktest: backtest,
  endToEndFactorRankAndIndependentSimulations: endToEnd,
  assumptions: { shortModel: "synthetic legacy-margin positions with zero borrow fee", perMarketInitialCapital: 10_000, sharedPortfolioLedger: false, crossQuoteConversion: false },
  referenceCheck: reference,
  runtime: {
    platform: process.platform, arch: process.arch, cpus: os.cpus().length, cpuModel: os.cpus()[0]?.model,
    totalMemoryGB: +(os.totalmem() / 1073741824).toFixed(2), node: process.version, v8: process.versions.v8,
    warmups: WARMUPS, repeats: REPEATS,
    peakRssMB: maxRss === undefined ? null : memoryMB(maxRss * 1024),
    finalMemoryMB: { rss: memoryMB(finalMemory.rss), heapUsed: memoryMB(finalMemory.heapUsed), external: memoryMB(finalMemory.external), arrayBuffers: memoryMB(finalMemory.arrayBuffers) },
    memoryDeltaNote: "median heapUsed and ArrayBuffer deltas per measured run; GC requested before each run when available",
  },
  interpretation: "Synthetic OHLCV stress benchmark only; not real market data, not a shared portfolio ledger, and not an investable net-performance result. Borrow costs and cross-quote conversion are not modeled.",
}, null, 2));
