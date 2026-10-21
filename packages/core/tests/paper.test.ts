import { describe, expect, it } from "vitest";
import { fillPaperOrder, transitionPaperOrder, type PaperOrder, type PaperPortfolio } from "../src/index.js";

const portfolio: PaperPortfolio = { quoteBalance: 10_000, baseBalance: 0, averageEntryPrice: null, realizedPnl: 0, feeRate: 0.001 };
const order: PaperOrder = {
  clientOrderId: "paper-once-1",
  symbol: "BTC/USDT",
  side: "buy",
  quantity: 0.1,
  status: "created",
  fillPrice: null,
  fee: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("decimal simulation ledger", () => {
  const fill = (wallet: PaperPortfolio, side: "buy" | "sell", quantity: number, price = 100) => fillPaperOrder({ ...order, status: "submitted", side, quantity }, wallet, price).portfolio;

  it("buys 0.1 and 0.2 then closes exactly 0.3 without dust", () => {
    const first = fill(portfolio, "buy", 0.1);
    const second = fill(first, "buy", 0.2);
    expect(second.baseBalance).toBe(0.3);
    const closed = fill(second, "sell", 0.3);
    expect(closed.baseBalance).toBe(0);
    expect(closed.costBasis).toBe(0);
    expect(closed.averageEntryPrice).toBeNull();
    expect(closed.realizedPnl).toBe(-0.06);
    expect(closed.quoteBalance).toBe(9999.94);
  });

  it("rejects overselling by one smallest unit and unrepresentable inputs without changing the wallet", () => {
    const held = fill(portfolio, "buy", 0.1);
    const snapshot = structuredClone(held);
    expect(() => fill(held, "sell", 0.100000000001)).toThrow(/Insufficient/);
    expect(() => fill(held, "buy", 1e-13)).toThrow(/representable/);
    expect(() => fill(held, "buy", 0.1 + 0.2)).toThrow(/representable/);
    expect(() => fill(held, "buy", 1e-12, 1)).toThrow(/notional/);
    expect(held).toEqual(snapshot);
  });

  it("closes a residual lot after rounding allocates all entry cost to a partial sale", () => {
    const opened = fill({ ...portfolio, feeRate: 0 }, "buy", 1, 1e-8);
    const partial = fill(opened, "sell", 0.9, 1);
    expect(partial.baseBalance).toBe(0.1);
    expect(partial.costBasis).toBe(0);
    expect(partial.averageEntryPrice).toBe(0);
    const closed = fill(partial, "sell", 0.1, 1);
    expect(closed.baseBalance).toBe(0);
    expect(closed.costBasis).toBe(0);
    expect(closed.averageEntryPrice).toBeNull();
    expect(closed.realizedPnl).toBe(0.99999999);
    expect(closed.quoteBalance).toBe(10000.99999999);
  });

  it("still rejects invalid legacy entry prices", () => {
    for (const averageEntryPrice of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => fill({ ...portfolio, baseBalance: 1, averageEntryPrice }, "sell", 1)).toThrow(/Invalid paper portfolio/);
    }
  });

  it("conserves rounded entry cost through repeated partial closes", () => {
    let wallet = fill(portfolio, "buy", 1, 3.33333333);
    for (let index = 0; index < 10; index++) wallet = fill(wallet, "sell", 0.1, 4.12345678);
    expect(wallet.baseBalance).toBe(0);
    expect(wallet.costBasis).toBe(0);
    expect(wallet.realizedPnl).toBe(0.78266664);
    expect(wallet.quoteBalance).toBe(10000.78266664);
  });
});

describe("paper order state machine", () => {
  it("accepts only legal status transitions", () => {
    const submitted = transitionPaperOrder(order, "submit");
    expect(submitted.status).toBe("submitted");
    expect(() => transitionPaperOrder(submitted, "submit")).toThrow(/Invalid paper order transition/);
  });

  it("fills once and updates the isolated paper quote/base balances", () => {
    const submitted = transitionPaperOrder(order, "submit");
    const filled = fillPaperOrder(submitted, portfolio, 50_000);
    expect(filled.order.status).toBe("filled");
    expect(filled.order.fillPrice).toBe(50_000);
    expect(filled.portfolio.quoteBalance).toBe(4_995);
    expect(filled.portfolio.baseBalance).toBe(0.1);
    expect(() => fillPaperOrder(filled.order, filled.portfolio, 50_000)).toThrow(/Only submitted/);
  });

  it("does not allow overspending or selling unavailable base", () => {
    const submitted = transitionPaperOrder(order, "submit");
    expect(() => fillPaperOrder({ ...submitted, quantity: 1 }, portfolio, 50_000)).toThrow(/Insufficient/);
    const sell = { ...submitted, side: "sell" as const };
    expect(() => fillPaperOrder(sell, portfolio, 50_000)).toThrow(/Insufficient/);
  });
});
