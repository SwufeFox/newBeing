import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DEFAULT_WORKSPACE_STATE } from "@newbeing/core";
import { closeDatabaseForTests, getDatabase, paperAccounts, saveWorkspaceState } from "@newbeing/storage";

vi.mock("@/lib/market-adapter", () => ({
  getWebMarketAdapter: () => { throw new Error("The account read must not reach a market adapter."); },
  marketDataSourceLabel: () => "Route fixture",
}));

import { GET } from "../src/app/api/paper/route.js";

let directory = "";

beforeEach(() => {
  closeDatabaseForTests();
  directory = mkdtempSync(path.join(tmpdir(), "newbeing-paper-routes-"));
  process.env.NEWBEING_DATA_DIR = directory;
});

afterEach(() => {
  closeDatabaseForTests();
  delete process.env.NEWBEING_DATA_DIR;
  rmSync(directory, { recursive: true, force: true });
});

function read(url: string): Promise<Response> {
  return GET(new Request(`http://localhost/api/paper${url}`));
}

describe("Paper account HTTP boundary", () => {
  it("serves the wallet with recent orders and hides the order rows in the positions view", async () => {
    const full = await read("?symbol=BTC%2FUSDT&exchange=binance");
    expect(full.status).toBe(200);
    expect(full.headers.get("cache-control")).toBe("no-store");
    const payload = await full.json();
    expect(payload).toMatchObject({
      portfolio: { quoteBalance: 10_000, baseBalance: 0 },
      orders: [],
      hasPendingOrders: false,
      mode: "paper",
      exchange: "binance",
      accountId: "paper:binance-spot:BTC:USDT",
    });

    const positions = await read("?symbol=BTC%2FUSDT&exchange=binance&view=positions");
    expect(positions.status).toBe(200);
    const compact = await positions.json();
    expect(Object.keys(compact).sort()).toEqual(["hasPendingOrders", "portfolio"]);
    expect(compact.portfolio).toEqual(payload.portfolio);
  });

  it("rejects an unknown view and hides normal Paper accounts during Replay", async () => {
    expect((await read("?view=everything")).status).toBe(400);

    saveWorkspaceState({ ...DEFAULT_WORKSPACE_STATE, activeWorkspace: "replay" });
    const blocked = await read("?symbol=BTC%2FUSDT&exchange=binance");
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).error).toMatch(/disabled during Replay/);
    /* A hidden account must not even be created by the rejected read. */
    expect(getDatabase().select().from(paperAccounts).all()).toEqual([]);
  });
});
