import { describe, expect, it } from "vitest";
import { executePaperOrderWithDependencies, type ExecutePaperOrderRequest } from "../src/paper.js";
import { fillPaperOrder, type PaperOrder, type PaperPortfolio } from "@newbeing/core";

type Quote = { price: number; timestamp: number | null };

function fixture(fetchReferencePrice: () => Promise<Quote>) {
  const orders = new Map<string, PaperOrder>();
  const portfolios = new Map<string, PaperPortfolio>();
  const events: string[] = [];
  const initial: PaperPortfolio = { quoteBalance: 10_000, baseBalance: 0, averageEntryPrice: null, realizedPnl: 0, feeRate: 0.001 };
  const dependencies = {
    beginIntent: (input: ExecutePaperOrderRequest) => {
      const existing = orders.get(input.clientOrderId);
      if (existing) return { order: existing, portfolio: portfolios.get(input.symbol) ?? initial, deduplicated: true };
      const created: PaperOrder = { ...input, status: "created", fillPrice: null, fee: 0, createdAt: "2026-01-01T00:00:00.000Z" };
      orders.set(created.clientOrderId, created);
      events.push(`created:${created.clientOrderId}`);
      return { order: created, portfolio: portfolios.get(input.symbol) ?? initial, deduplicated: false };
    },
    markSubmitted: (id: string) => {
      const order = orders.get(id);
      if (!order) throw new Error("Missing intent");
      const submitted = { ...order, status: "submitted" as const };
      orders.set(id, submitted);
      events.push(`submitted:${id}`);
      return submitted;
    },
    fetchReferencePrice,
    now: () => Date.parse("2026-01-01T00:00:00.000Z"),
    maxQuoteAgeMs: 30_000,
    finalize: (id: string, price: number, symbol: string) => {
      const order = orders.get(id);
      if (!order) throw new Error("Missing intent");
      const fill = fillPaperOrder(order, portfolios.get(symbol) ?? initial, price);
      orders.set(id, fill.order);
      portfolios.set(symbol, fill.portfolio);
      events.push(`filled:${id}`);
      return { order: fill.order, portfolio: fill.portfolio, deduplicated: false };
    },
    markUnknown: (id: string, symbol: string) => {
      const order = orders.get(id);
      if (!order) throw new Error("Missing intent");
      const unknown = { ...order, status: "unknown" as const };
      orders.set(id, unknown);
      events.push(`unknown:${id}`);
      return { order: unknown, portfolio: portfolios.get(symbol) ?? initial };
    },
    readPortfolio: (symbol: string) => portfolios.get(symbol) ?? initial,
  };
  return { dependencies, orders, events };
}

const request = { clientOrderId: "stable-paper-id", symbol: "BTC/USDT", side: "buy" as const, quantity: 0.1 };

describe("paper execution reliability", () => {
  it("persists intent before price lookup and deduplicates a repeated client order id", async () => {
    let requests = 0;
    const { dependencies, events } = fixture(async () => {
      requests += 1;
      expect(events.slice(0, 2)).toEqual(["created:stable-paper-id", "submitted:stable-paper-id"]);
      return { price: 50_000, timestamp: Date.parse("2026-01-01T00:00:00.000Z") };
    });
    const first = await executePaperOrderWithDependencies(request, dependencies);
    expect(first.order.status).toBe("filled");
    expect(first.deduplicated).toBe(false);
    const repeat = await executePaperOrderWithDependencies(request, dependencies);
    expect(repeat.order).toEqual(first.order);
    expect(repeat.deduplicated).toBe(true);
    expect(requests).toBe(1);
  });

  it("rejects stale, missing, non-finite, and future quote timestamps before recording a fill", async () => {
    for (const timestamp of [1_767_225_569_999, null, Number.NaN, Number.POSITIVE_INFINITY, 1_767_225_600_001]) {
      const { dependencies, events } = fixture(async () => ({ price: 50_000, timestamp }));
      const result = await executePaperOrderWithDependencies(request, dependencies);
      expect(result.order.status).toBe("unknown");
      expect(result.retrySafe).toBe(false);
      expect(events).toEqual(["created:stable-paper-id", "submitted:stable-paper-id", "unknown:stable-paper-id"]);
      expect(events).not.toContain("filled:stable-paper-id");
    }
  });

  it("accepts a quote at the age threshold and preserves the fresh last-price fallback", async () => {
    const { dependencies, events } = fixture(async () => ({ price: 49_900, timestamp: 1_767_225_570_000 }));
    const result = await executePaperOrderWithDependencies(request, dependencies);
    expect(result.order.status).toBe("filled");
    expect(result.order.fillPrice).toBe(49_900);
    expect(events).toContain("filled:stable-paper-id");
  });
  it("does not auto-retry an ambiguous intent after quote failure", async () => {
    let requests = 0;
    const { dependencies } = fixture(async () => {
      requests += 1;
      throw new Error("network timeout");
    });
    const first = await executePaperOrderWithDependencies(request, dependencies);
    expect(first.order.status).toBe("unknown");
    expect(first.retrySafe).toBe(false);
    const repeat = await executePaperOrderWithDependencies(request, dependencies);
    expect(repeat.order.status).toBe("unknown");
    expect(repeat.deduplicated).toBe(true);
    expect(repeat.retrySafe).toBe(false);
    expect(requests).toBe(1);
  });
});
