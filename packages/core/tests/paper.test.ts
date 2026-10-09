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
