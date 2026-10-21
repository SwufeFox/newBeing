import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, linkSync, mkdirSync, openSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { getDatabase, storageDirectory } from "./db.js";
import { datasetSnapshots } from "./schema.js";
import type { Candle, ExchangeId, Timeframe } from "@newbeing/core";

/** Sorted object keys, array order preserved, finite numbers as Number.toString; -0 is 0. */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Canonical JSON requires finite numbers.");
    return value.toString();
  }
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${Array.from(value, canonicalJson).join(",")}]`;
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  throw new Error("Unsupported canonical JSON value.");
}

export type SnapshotStage = "temp-written" | "file-published" | "metadata-published";
function snapshotDirectory(): string { return path.join(storageDirectory(), "datasets"); }
export function datasetSnapshotPath(datasetId: string): string {
  if (!/^sha256:[a-f0-9]{64}$/.test(datasetId)) throw new Error("Invalid snapshot ID.");
  return path.join(snapshotDirectory(), `${datasetId.slice(7)}.json`);
}
function verifyFile(datasetId: string): ReturnType<typeof identifyDataset> {
  const filename = datasetSnapshotPath(datasetId);
  if (statSync(filename).size > 2_000_000) throw new Error("Snapshot exceeds the file size limit.");
  const bytes = readFileSync(filename, "utf8");
  const payload = JSON.parse(bytes) as DatasetPayload;
  if (payload.format !== "newbeing-candles-v1") throw new Error("Unsupported snapshot format.");
  const identified = identifyDataset(payload);
  if (identified.datasetId !== datasetId || identified.bytes !== bytes) throw new Error("Snapshot integrity check failed.");
  return identified;
}
function publishMetadata(snapshot: ReturnType<typeof identifyDataset>): void {
  const byteLength = Buffer.byteLength(snapshot.bytes, "utf8");
  const db = getDatabase();
  const existing = db.select().from(datasetSnapshots).where(eq(datasetSnapshots.datasetId, snapshot.datasetId)).get();
  if (existing && existing.byteLength !== byteLength) throw new Error("Snapshot metadata integrity check failed.");
  db.insert(datasetSnapshots).values({ datasetId: snapshot.datasetId, byteLength, createdAt: new Date().toISOString() }).onConflictDoNothing().run();
}
function syncDirectory(): void {
  // Windows does not support fsync on directories. Files are flushed; recovery
  // detects a lost directory entry rather than claiming cross-store atomicity.
  if (process.platform === "win32") return;
  const fd = openSync(snapshotDirectory(), "r");
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
/** Write-once content: flush temp -> atomic non-overwriting hard link -> metadata.
 * An interrupted call may leave a temp or unindexed final file. Retry reconciles
 * either, and readers always verify bytes instead of trusting the registry. */
export function saveDatasetSnapshot(input: DatasetInput, onStage?: (stage: SnapshotStage) => void): string {
  const snapshot = identifyDataset(input);
  mkdirSync(snapshotDirectory(), { recursive: true });
  const filename = datasetSnapshotPath(snapshot.datasetId);
  if (!existsSync(filename)) {
    const temporary = path.join(snapshotDirectory(), `.${snapshot.datasetId.slice(7)}.${randomUUID()}.tmp`);
    const fd = openSync(temporary, "wx");
    try { writeFileSync(fd, snapshot.bytes, "utf8"); fsyncSync(fd); } finally { closeSync(fd); }
    // Hooks deliberately leave the same artifacts a terminated process would.
    onStage?.("temp-written");
    try { linkSync(temporary, filename); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    unlinkSync(temporary);
    syncDirectory();
    onStage?.("file-published");
  }
  const verified = verifyFile(snapshot.datasetId);
  publishMetadata(verified);
  onStage?.("metadata-published");
  return snapshot.datasetId;
}
export function loadDatasetSnapshot(datasetId: string): DatasetPayload {
  const snapshot = verifyFile(datasetId);
  const metadata = getDatabase().select().from(datasetSnapshots).where(eq(datasetSnapshots.datasetId, datasetId)).get();
  if (!metadata || metadata.byteLength !== Buffer.byteLength(snapshot.bytes, "utf8")) throw new Error("Snapshot metadata missing or corrupt; recover snapshot publication first.");
  return snapshot.payload;
}
/** Explicit maintenance operation, run with writers stopped. Valid orphan files
 * are reindexed, stale protocol temps discarded, corrupt/missing files reported. */
export function recoverDatasetSnapshots(): { recovered: string[]; discarded: string[]; errors: Array<{ datasetId: string; error: string }> } {
  mkdirSync(snapshotDirectory(), { recursive: true });
  const result: ReturnType<typeof recoverDatasetSnapshots> = { recovered: [], discarded: [], errors: [] };
  const ids = new Set(getDatabase().select().from(datasetSnapshots).all().map((row) => row.datasetId));
  for (const entry of readdirSync(snapshotDirectory())) {
    if (/^\.[a-f0-9]{64}\.[a-f0-9-]{36}\.tmp$/.test(entry)) {
      unlinkSync(path.join(snapshotDirectory(), entry));
      result.discarded.push(entry);
    } else if (/^[a-f0-9]{64}\.json$/.test(entry)) ids.add(`sha256:${entry.slice(0, -5)}`);
  }
  for (const id of ids) {
    try { publishMetadata(verifyFile(id)); result.recovered.push(id); }
    catch (error) { result.errors.push({ datasetId: id, error: error instanceof Error ? error.message : String(error) }); }
  }
  return result;
}
export interface DatasetInput { exchange: ExchangeId; symbol: string; timeframe: Timeframe; candles: readonly Candle[] }
export interface DatasetPayload extends DatasetInput { format: "newbeing-candles-v1" }
const durations: Record<Timeframe, number> = { "1m": 60_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000, "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000 };
export function identifyDataset(input: DatasetInput): { datasetId: string; bytes: string; payload: DatasetPayload } {
  if (!["binance", "coinbaseexchange", "okx", "kraken"].includes(input.exchange) || !/^[A-Z0-9]{2,20}\/[A-Z0-9]{2,20}$/.test(input.symbol)) throw new Error("Invalid dataset instrument.");
  const duration = durations[input.timeframe];
  if (!duration || !Array.isArray(input.candles) || input.candles.length < 2 || input.candles.length > 1000) throw new Error("Dataset requires 2 to 1000 candles and a supported timeframe.");
  const candles = input.candles.map((c, index) => {
    const { timestamp, open, high, low, close, volume } = c;
    if (![timestamp, open, high, low, close, volume].every(Number.isFinite) || !Number.isSafeInteger(timestamp) || timestamp < 0 || timestamp % duration !== 0 || Math.min(open, high, low, close) <= 0 || volume < 0 || high < Math.max(open, low, close) || low > Math.min(open, high, close)) throw new Error(`Invalid dataset candle at index ${index}.`);
    if (index > 0 && timestamp - input.candles[index - 1]!.timestamp !== duration) throw new Error("Dataset candles must be ordered, unique and contiguous.");
    return { timestamp, open, high, low, close, volume };
  });
  const payload: DatasetPayload = { format: "newbeing-candles-v1", exchange: input.exchange, symbol: input.symbol, timeframe: input.timeframe, candles };
  const bytes = canonicalJson(payload);
  return { datasetId: `sha256:${createHash("sha256").update(bytes, "utf8").digest("hex")}`, bytes, payload };
}
