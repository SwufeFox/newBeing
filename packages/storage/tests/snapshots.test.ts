import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { closeDatabaseForTests, datasetSnapshotPath, getDatabase, identifyDataset, loadDatasetSnapshot, recoverDatasetSnapshots, saveDatasetSnapshot, type SnapshotStage } from "../src/index.js";
const bars = [0, 60_000].map((timestamp) => ({ timestamp, open: 100, high: 110, low: 90, close: 105, volume: 1 }));
const input = { exchange: "binance" as const, symbol: "BTC/USDT", timeframe: "1m" as const, candles: bars };
let directory: string;
beforeEach(() => { closeDatabaseForTests(); directory = mkdtempSync(path.join(tmpdir(), "newbeing-snapshots-")); process.env.NEWBEING_DATA_DIR = directory; });
afterEach(() => { closeDatabaseForTests(); delete process.env.NEWBEING_DATA_DIR; rmSync(directory, { recursive: true, force: true }); });
describe("immutable snapshot publication and recovery", () => {
  it("persists exact candles, survives restart, deduplicates without replacing bytes", () => {
    const id = saveDatasetSnapshot(input);
    expect(readFileSync(datasetSnapshotPath(id), "utf8")).toBe(identifyDataset(input).bytes);
    input.candles[0]!.close = 106;
    expect(loadDatasetSnapshot(id).candles[0]!.close).toBe(105);
    input.candles[0]!.close = 105;
    closeDatabaseForTests();
    expect(loadDatasetSnapshot(id).candles).toEqual(bars);
    expect(saveDatasetSnapshot(input)).toBe(id);
    expect(readdirSync(path.dirname(datasetSnapshotPath(id)))).toEqual([`${id.slice(7)}.json`]);
  });
  it.each<SnapshotStage>(["temp-written", "file-published", "metadata-published"])("recovers simulated interruption at %s", (stage) => {
    const id = identifyDataset(input).datasetId;
    expect(() => saveDatasetSnapshot(input, (at) => { if (at === stage) throw new Error("interrupted"); })).toThrow("interrupted");
    closeDatabaseForTests();
    if (stage !== "metadata-published") expect(() => loadDatasetSnapshot(id)).toThrow();
    const recovery = recoverDatasetSnapshots();
    expect(recovery.errors).toEqual([]);
    if (stage === "temp-written") {
      expect(recovery.discarded).toHaveLength(1);
      expect(recovery.recovered).toEqual([]);
    } else expect(recovery.recovered).toEqual([id]);
    expect(saveDatasetSnapshot(input)).toBe(id);
    expect(loadDatasetSnapshot(id).candles).toEqual(bars);
  });
  it("discards partial temps and refuses to silently repair corrupt or missing published data", () => {
    const id = saveDatasetSnapshot(input);
    const file = datasetSnapshotPath(id);
    const temp = path.join(path.dirname(file), `.${id.slice(7)}.00000000-0000-4000-8000-000000000000.tmp`);
    writeFileSync(temp, '{"format":');
    writeFileSync(file, readFileSync(file, "utf8").replace('"close":105', '"close":106'));
    expect(() => loadDatasetSnapshot(id)).toThrow(/integrity/);
    expect(() => saveDatasetSnapshot(input)).toThrow(/integrity/);
    const recovery = recoverDatasetSnapshots();
    expect(recovery.discarded).toEqual([path.basename(temp)]);
    expect(recovery.errors).toEqual([{ datasetId: id, error: "Snapshot integrity check failed." }]);
    unlinkSync(file);
    expect(() => loadDatasetSnapshot(id)).toThrow();
    expect(recoverDatasetSnapshots().errors[0]!.datasetId).toBe(id);
  });
  it("rejects corrupt metadata and unsafe IDs", () => {
    const id = saveDatasetSnapshot(input);
    getDatabase().run(`UPDATE dataset_snapshots SET byte_length = 1`);
    expect(() => loadDatasetSnapshot(id)).toThrow(/metadata/);
    expect(recoverDatasetSnapshots().errors).toEqual([{ datasetId: id, error: "Snapshot metadata integrity check failed." }]);
    expect(() => loadDatasetSnapshot("../escape")).toThrow(/ID/);
  });
});
