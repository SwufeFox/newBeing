import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { closeDatabaseForTests, getDatabase, getWorkspaceState, saveWorkspaceState } from "../src/index.js";
import { derivativesAccountId, getDerivativesAccountRow, migrateDerivativesStorage, mutateDerivativesAccountRow, openDerivativesAccountRow } from "../src/derivatives.js";

let directory: string;
const previousDirectory = process.env.NEWBEING_DATA_DIR;
beforeEach(() => {
  closeDatabaseForTests(); directory = mkdtempSync(path.join(tmpdir(), "newbeing-derivatives-storage-"));
  process.env.NEWBEING_DATA_DIR = directory;
});
afterEach(() => {
  closeDatabaseForTests();
  if (previousDirectory === undefined) delete process.env.NEWBEING_DATA_DIR; else process.env.NEWBEING_DATA_DIR = previousDirectory;
  rmSync(directory, { recursive: true, force: true });
});
const initial = () => ({ id: derivativesAccountId("okx", "USDT"), available: "100.123456789123456789", orders: [] as string[] });
type Account = ReturnType<typeof initial>;

describe("independent derivatives JSON transactions", () => {
  it("migrates an existing database idempotently without changing legacy rows", () => {
    getDatabase().run("INSERT INTO spot_accounts (id, payload) VALUES ('untouched', '{\"amount\":123}')");
    migrateDerivativesStorage(); migrateDerivativesStorage();
    openDerivativesAccountRow(initial());
    const row = getDatabase().get<{ payload: string }>("SELECT payload FROM spot_accounts WHERE id = 'untouched'");
    expect(row?.payload).toBe('{"amount":123}');
  });
  it("seeds once and preserves decimal wire values through reopen", () => {
    openDerivativesAccountRow(initial());
    mutateDerivativesAccountRow<Account, void>(initial().id, (a) => { a.available = "0.000000000000000001"; a.orders.push("filled"); });
    closeDatabaseForTests();
    expect(openDerivativesAccountRow(initial())).toEqual({ ...initial(), available: "0.000000000000000001", orders: ["filled"] });
    expect(derivativesAccountId("deribit", "BTC")).not.toBe(initial().id);
    expect(getDerivativesAccountRow("missing")).toBeUndefined();
  });
  it("acquires the write lock before invoking a mutation callback", () => {
    openDerivativesAccountRow(initial());
    const competing = new Database(path.join(directory, "newbeing.sqlite"), { timeout: 0 });
    try {
      mutateDerivativesAccountRow<Account, void>(initial().id, () => {
        expect(() => competing.prepare("UPDATE derivatives_accounts SET payload = payload").run()).toThrow(/locked/);
      });
      expect(() => competing.prepare("UPDATE derivatives_accounts SET payload = payload").run()).not.toThrow();
    } finally { competing.close(); }
  });
  it("rolls money and orders back on storage failure", () => {
    openDerivativesAccountRow(initial());
    getDatabase().run("CREATE TRIGGER fail_derivatives BEFORE UPDATE ON derivatives_accounts BEGIN SELECT RAISE(ABORT, 'derivatives rollback'); END");
    expect(() => mutateDerivativesAccountRow<Account, void>(initial().id, (a) => { a.available = "0"; a.orders.push("bad"); })).toThrow(/derivatives rollback/);
    expect(getDerivativesAccountRow(initial().id)).toEqual(initial());
  });
  it("rejects async mutations and identity changes atomically", () => {
    openDerivativesAccountRow(initial());
    expect(() => mutateDerivativesAccountRow<Account, Promise<void>>(initial().id, async (a) => { a.available = "0"; })).toThrow(/synchronous/);
    expect(() => mutateDerivativesAccountRow<Account, void>(initial().id, (a) => { a.id = "other"; })).toThrow(/identity/);
    expect(getDerivativesAccountRow(initial().id)).toEqual(initial());
  });
  it("blocks opening and mutation in Replay, including a workspace change inside the transaction", () => {
    openDerivativesAccountRow(initial());
    const state = getWorkspaceState().state;
    expect(() => mutateDerivativesAccountRow<Account, void>(initial().id, (a) => {
      a.available = "0"; saveWorkspaceState({ ...state, activeWorkspace: "replay" });
    })).toThrow(/Replay/);
    expect(getDerivativesAccountRow(initial().id)).toEqual(initial());
    saveWorkspaceState({ ...state, activeWorkspace: "replay" });
    expect(() => openDerivativesAccountRow({ ...initial(), id: "other" })).toThrow(/Replay/);
    expect(() => mutateDerivativesAccountRow<Account, void>(initial().id, () => {})).toThrow(/Replay/);
  });
  it("requires explicit account creation", () => {
    expect(() => mutateDerivativesAccountRow<Account, void>(initial().id, () => {})).toThrow(/Explicitly open/);
  });
});
