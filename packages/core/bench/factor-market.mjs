import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compileFactor } from "../dist/factor.js";
import { runBacktest } from "../dist/backtest.js";

const benchDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(benchDirectory, "../../..");
const require = createRequire(path.join(repositoryRoot, "packages/storage/package.json"));
const Database = require("better-sqlite3");
const dataDirectory = process.env.NEWBEING_DATA_DIR
  ? path.resolve(process.env.NEWBEING_DATA_DIR)
  : path.join(repositoryRoot, ".newbeing");
const databasePath = path.join(dataDirectory, "newbeing.sqlite");
const durations = new Map([
  ["1m", 60_000], ["5m", 300_000], ["15m", 900_000], ["30m", 1_800_000],
  ["1h", 3_600_000], ["4h", 14_400_000], ["1d", 86_400_000],
]);
const warmups = Number(process.env.FACTOR_BENCH_WARMUPS ?? 1);
const repetitions = Number(process.env.FACTOR_BENCH_REPEATS ?? 3);
if (!Number.isInteger(warmups) || warmups < 0 || !Number.isInteger(repetitions) || repetitions < 1) {
  throw new Error("FACTOR_BENCH_WARMUPS must be >= 0 and FACTOR_BENCH_REPEATS must be >= 1.");
}

const expressionParts = [];
let previous = "close";
for (let index = 1; index <= 32; index += 1) {
  const name = `v${index}`;
  expressionParts.push(`${name} = ts_mean(${previous}, 5);`);
  previous = name;
}
for (let index = 33; index <= 62; index += 1) {
  const name = `v${index}`;
  expressionParts.push(`${name} = ${previous} + 1;`);
  previous = name;
}
expressionParts.push(`v63 = close > ${previous};`);
expressionParts.push("v64 = v63 && 1;");
previous = "v64";
const expression = `${expressionParts.join("\n")}\n${previous}`;

const database = new Database(databasePath, { readonly: true, fileMustExist: true });
database.pragma("query_only = ON");
const now = Date.now();
const eligibleAfter = now - 30 * 24 * 60 * 60 * 1000;
const rows = database.prepare(`
  SELECT exchange, symbol, timeframe, timestamp, open, high, low, close, volume, cached_at
  FROM candle_cache
  WHERE cached_at >= ? AND timestamp <= ?
  ORDER BY exchange, symbol, timeframe, timestamp
`).all(eligibleAfter, now);
database.close();

const grouped = new Map();
for (const row of rows) {
  const duration = durations.get(row.timeframe);
  if (!duration || row.cached_at < row.timestamp + duration || row.timestamp > now - duration) continue;
  const key = `${row.exchange}|${row.symbol}|${row.timeframe}`;
  let candles = grouped.get(key);
  if (!candles) grouped.set(key, candles = []);
  candles.push({ timestamp: row.timestamp, open: row.open, high: row.high, low: row.low, close: row.close, volume: row.volume });
}
const series = [...grouped.entries()]
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([key, candles]) => ({ key, candles }));
if (series.length === 0) throw new Error(`No eligible candle-cache series found in ${databasePath}.`);

function median(values) {
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0 ? (ordered[middle - 1] + ordered[middle]) / 2 : ordered[middle];
}

function hashResults(results) {
  const hash = createHash("sha256");
  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    if (!result.ok || !result.values) throw new Error(result.errors.map((error) => error.message).join("; "));
    hash.update(`${series[index].key}\n`);
    for (const value of result.values) hash.update(`${value === null ? "null" : value.toString()}\n`);
  }
  return hash.digest("hex");
}

function hashBacktests(results) {
  return createHash("sha256").update(JSON.stringify(results)).digest("hex");
}

function evaluateReference(candles) {
  const safe = (value) => Number.isFinite(value) ? value : null;
  let values = candles.map((candle) => safe(candle.close));
  for (let stage = 0; stage < 32; stage += 1) {
    const next = new Array(candles.length).fill(null);
    for (let index = 4; index < candles.length; index += 1) {
      let sum = 0;
      let valid = true;
      for (let cursor = index - 4; cursor <= index; cursor += 1) {
        const value = values[cursor];
        if (value === null) { valid = false; break; }
        sum += value;
      }
      if (valid) next[index] = safe(sum / 5);
    }
    values = next;
  }
  for (let stage = 0; stage < 30; stage += 1) {
    values = values.map((value) => value === null ? null : safe(value + 1));
  }
  values = values.map((value, index) => {
    const close = safe(candles[index]?.close);
    return value === null || close === null ? null : close > value ? 1 : 0;
  });
  values = values.map((value) => value === null ? null : value === 0 ? 0 : 1);
  return values;
}

function runBacktests(factorResults, inputSeries = series) {
  return factorResults.map((factorResult, index) => {
    if (!factorResult.ok || !factorResult.values) throw new Error(factorResult.errors.map((error) => error.message).join("; "));
    const { key, candles } = inputSeries[index];
    const [exchange, symbol, timeframe] = key.split("|");
    let cursor = 0;
    const sideAt = (bar) => factorResult.values[bar] === null || factorResult.values[bar] === 0 ? "flat" : "long";
    const strategy = {
      id: "factor-64-market-benchmark",
      name: "64 node factor benchmark",
      version: "1",
      description: "Benchmark only: positive factor values target long, zero targets flat.",
      defaults: {},
      createSignalStream: () => ({ next: () => sideAt(cursor++) }),
      signalAt: (_candles, index) => sideAt(index),
    };
    return runBacktest({
      candles,
      symbol,
      timeframe,
      exchange,
      datasetId: `local-cache-benchmark:${key}`,
      strategy,
      parameters: {},
      config: { initialCapital: 10_000, positionFraction: 0.1, feeRate: 0.001, slippageRate: 0.0005, allowShorts: false },
      resultId: `factor64-${index}`,
      createdAt: "2026-10-30T00:00:00.000Z",
    });
  });
}

function hashReference() {
  const hash = createHash("sha256");
  for (const item of series) {
    hash.update(`${item.key}\n`);
    for (const value of evaluateReference(item.candles)) hash.update(`${value === null ? "null" : value.toString()}\n`);
  }
  return hash.digest("hex");
}

const compileSamples = [];
let compiled;
for (let iteration = 0; iteration < Math.max(3, repetitions); iteration += 1) {
  const started = performance.now();
  compiled = compileFactor(expression);
  compileSamples.push(performance.now() - started);
  if (!compiled.ok || !compiled.plan) throw new Error(compiled.errors.map((error) => error.message).join("; "));
}

const evaluateAll = (inputSeries = series) => inputSeries.map(({ candles }) => compiled.plan.evaluate(candles));
for (let iteration = 0; iteration < warmups; iteration += 1) evaluateAll();
const elapsedSamples = [];
let outputHash;
for (let iteration = 0; iteration < repetitions; iteration += 1) {
  if (typeof globalThis.gc === "function") globalThis.gc();
  const started = performance.now();
  const results = evaluateAll();
  elapsedSamples.push(performance.now() - started);
  const currentHash = hashResults(results);
  if (outputHash && outputHash !== currentHash) throw new Error("Output hash changed between repetitions.");
  outputHash = currentHash;
}

const referenceHash = hashReference();
if (outputHash !== referenceHash) throw new Error(`64-node result differs from the exact reference: ${referenceHash}`);

function measure(run) {
  for (let iteration = 0; iteration < warmups; iteration += 1) run();
  const samples = [];
  let output;
  for (let iteration = 0; iteration < repetitions; iteration += 1) {
    if (typeof globalThis.gc === "function") globalThis.gc();
    const started = performance.now();
    output = run();
    samples.push(performance.now() - started);
  }
  return { samples, medianMs: median(samples), output };
}

const factorResults = evaluateAll();
const createSeriesCopy = () => series.map(({ key, candles }) => ({ key, candles: candles.map((candle) => ({ ...candle })) }));
function measureCold(run) {
  const samples = [];
  let output;
  let inputSeries = null;
  for (let iteration = 0; iteration < warmups + repetitions; iteration += 1) {
    if (typeof globalThis.gc === "function") globalThis.gc();
    inputSeries = createSeriesCopy();
    const started = performance.now();
    output = run(inputSeries);
    const elapsed = performance.now() - started;
    if (iteration >= warmups) samples.push(elapsed);
    inputSeries = null;
  }
  return { samples, medianMs: median(samples), output };
}
const coldBacktestTiming = measureCold((inputSeries) => runBacktests(factorResults, inputSeries));
const coldPipelineTiming = measureCold((inputSeries) => runBacktests(evaluateAll(inputSeries), inputSeries));
const backtestTiming = measure(() => runBacktests(factorResults));
const pipelineTiming = measure(() => runBacktests(evaluateAll()));
const outputHashes = [
  hashBacktests(coldBacktestTiming.output),
  hashBacktests(coldPipelineTiming.output),
  hashBacktests(backtestTiming.output),
  hashBacktests(pipelineTiming.output),
];
if (outputHashes.some((hash) => hash !== outputHashes[0])) throw new Error("Backtest outputs changed across cold/warm pipelines.");
const backtestOutputHash = outputHashes[0];
const bars = series.reduce((total, item) => total + item.candles.length, 0);
const factorMedianMs = median(elapsedSamples);
const factorSeconds = factorMedianMs / 1000;
const operatorNodes = 64;
const rollingNodes = 32;
const window = 5;
const planNodesPerBar = 97;
const windowReadsPerBar = rollingNodes * window;
const workUnitsPerBar = planNodesPerBar + windowReadsPerBar;
const coldBacktestMedianMs = coldBacktestTiming.medianMs;
const warmBacktestMedianMs = backtestTiming.medianMs;
const coldPipelineMedianMs = coldPipelineTiming.medianMs;
const warmPipelineMedianMs = pipelineTiming.medianMs;
const totalTrades = pipelineTiming.output.reduce((total, result) => total + result.trades.length, 0);
console.log(JSON.stringify({
  database: path.relative(repositoryRoot, databasePath),
  universe: "all eligible local candle_cache series (network excluded)",
  backtestSemantics: "independent per-series simulation; capital resets for each series",
  coldRunMethod: "fresh candle objects; clone preparation excluded from timing",
  warmRunMethod: "same candle objects reused; Decimal close cache primed",
  seriesCount: series.length,
  candleBars: bars,
  dataGroups: series.map(({ key, candles }) => ({ key, bars: candles.length })),
  operatorNodes,
  rollingNodes,
  window,
  warmups,
  repetitions,
  compileMedianMs: Number(median(compileSamples).toFixed(3)),
  factorEvaluationMedianMs: Number(factorMedianMs.toFixed(3)),
  factorEvaluationRangeMs: [Number(Math.min(...elapsedSamples).toFixed(3)), Number(Math.max(...elapsedSamples).toFixed(3))],
  factorBarsPerSecond: Math.round(bars / factorSeconds),
  operatorEvaluationsPerSecond: Math.round(bars * operatorNodes / factorSeconds),
  windowReadsPerSecond: Math.round(bars * windowReadsPerBar / factorSeconds),
  planWorkUnitsPerSecond: Math.round(bars * workUnitsPerBar / factorSeconds),
  coldBacktestSimulationMedianMs: Number(coldBacktestMedianMs.toFixed(3)),
  coldBacktestSimulationRangeMs: [Number(Math.min(...coldBacktestTiming.samples).toFixed(3)), Number(Math.max(...coldBacktestTiming.samples).toFixed(3))],
  coldBacktestBarsPerSecond: Math.round(bars / (coldBacktestMedianMs / 1000)),
  warmBacktestSimulationMedianMs: Number(warmBacktestMedianMs.toFixed(3)),
  warmBacktestSimulationRangeMs: [Number(Math.min(...backtestTiming.samples).toFixed(3)), Number(Math.max(...backtestTiming.samples).toFixed(3))],
  warmBacktestBarsPerSecond: Math.round(bars / (warmBacktestMedianMs / 1000)),
  coldFactorPlusBacktestMedianMs: Number(coldPipelineMedianMs.toFixed(3)),
  coldFactorPlusBacktestRangeMs: [Number(Math.min(...coldPipelineTiming.samples).toFixed(3)), Number(Math.max(...coldPipelineTiming.samples).toFixed(3))],
  coldPipelineBarsPerSecond: Math.round(bars / (coldPipelineMedianMs / 1000)),
  warmFactorPlusBacktestMedianMs: Number(warmPipelineMedianMs.toFixed(3)),
  warmFactorPlusBacktestRangeMs: [Number(Math.min(...pipelineTiming.samples).toFixed(3)), Number(Math.max(...pipelineTiming.samples).toFixed(3))],
  warmPipelineBarsPerSecond: Math.round(bars / (warmPipelineMedianMs / 1000)),
  totalTrades,
  backtestOutputHash,
  exactReferenceMatch: outputHash === referenceHash,
  referenceHash,
  outputHash,
}, null, 2));
