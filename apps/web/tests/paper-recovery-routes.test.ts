import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beginPaperIntent, closeDatabaseForTests, getPaperPortfolio, listPaperRecoveries, markPaperIntentSubmitted, paperAccountId } from "@newbeing/storage";
import { GET, POST } from "../src/app/api/paper/recovery/route.js";

let directory = "";
beforeEach(() => {
  closeDatabaseForTests();
  directory = mkdtempSync(path.join(tmpdir(), "newbeing-recovery-http-"));
  process.env.NEWBEING_DATA_DIR = directory;
});
afterEach(() => {
  closeDatabaseForTests();
  delete process.env.NEWBEING_DATA_DIR;
  rmSync(directory, { recursive: true, force: true });
});
const action = { action: "cancel", clientOrderId: "pending-route-order", actionId: "route-recovery-action", reason: "Operator stops an interrupted Paper intent." };
function post(body: unknown) {
  return POST(new Request("http://localhost/api/paper/recovery", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
}

describe("Paper recovery HTTP boundary", () => {
  it("shows pending original ownership, durably cancels and returns an exact retry", async () => {
    const owner = paperAccountId("BTC/USD", "kraken");
    beginPaperIntent({ clientOrderId: action.clientOrderId, symbol: "BTC/USD", quantity: 0.1, side: "buy" }, owner);
    markPaperIntentSubmitted(action.clientOrderId);
    const before = getPaperPortfolio(owner);
    const visible = await GET();
    expect(visible.headers.get("cache-control")).toBe("no-store");
    expect((await visible.json()).pending).toMatchObject([{ clientOrderId: action.clientOrderId, accountId: owner }]);
    const response = await post(action);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ order: { status: "cancelled" }, recovery: { accountId: owner, reason: action.reason } });
    closeDatabaseForTests();
    expect(await (await post(action)).json()).toMatchObject({ deduplicated: true });
    expect(await (await GET()).json()).toMatchObject({ pending: [], recoveries: [{ accountId: owner }] });
    expect(getPaperPortfolio(owner)).toEqual(before);
  });

  it.each([
    { ...action, price: 100 }, { ...action, fillPrice: 100 }, { ...action, balance: 99999 },
    { ...action, portfolio: { quoteBalance: 99999 } }, { ...action, action: "fill" },
    { ...action, reason: " " }, { ...action, actionId: "bad" },
  ])("rejects untrusted recovery claims %j", async (body) => {
    expect((await post(body)).status).toBe(400);
    expect(listPaperRecoveries()).toEqual([]);
  });
});
