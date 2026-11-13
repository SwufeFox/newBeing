import { describe, expect, it } from "vitest";
import type { DerivativeInstrument, DerivativeQuote } from "@newbeing/market-data/derivatives";
import { derivativeOptionChain, derivativePositionIsExpired, derivativeQuoteSnapshotIsStale, derivativeProtectionSeed, derivativeInputErrors, derivativeCommandWasRejected, DerivativeRequestError } from "../src/lib/derivatives-ui.js";

function option(settle: "BTC" | "USDC", right: "call" | "put"): DerivativeInstrument {
  const linear = settle === "USDC";
  const nativeId = linear
    ? `BTC_USDC-25DEC26-80000-${right === "call" ? "C" : "P"}`
    : `BTC-25DEC26-80000-${right === "call" ? "C" : "P"}`;
  return {
    id: `deribit:option:${nativeId}`, venue: "deribit", nativeId, symbol: nativeId,
    kind: "option", base: "BTC", quote: "USD", settle, contractSize: 1,
    linear, inverse: !linear, expiry: Date.UTC(2026, 11, 25), strike: 80_000,
    optionRight: right, active: true, quantityStep: 0.1, minContracts: 0.1,
    priceTick: 0.1, priceTickSteps: [], source: "native-api",
  };
}

describe("derivative option-chain grouping", () => {
  it("keeps same-strike options with different settlement currencies in separate chains", () => {
    const chains = derivativeOptionChain([
      option("USDC", "call"), option("USDC", "put"), option("BTC", "call"), option("BTC", "put"),
    ]);
    expect(chains).toHaveLength(2);
    expect(chains.map(({ settle }) => settle)).toEqual(["BTC", "USDC"]);
    for (const chain of chains) {
      expect(chain.rows).toHaveLength(1);
      expect(chain.rows[0]?.call?.settle).toBe(chain.settle);
      expect(chain.rows[0]?.put?.settle).toBe(chain.settle);
    }
  });

  it("marks timestamps outside the native freshness window as stale", () => {
    expect(derivativeQuoteSnapshotIsStale({ timestamp: 100_000 }, 130_001)).toBe(true);
    expect(derivativeQuoteSnapshotIsStale({ timestamp: 100_000 }, 100_000)).toBe(false);
    expect(derivativeQuoteSnapshotIsStale({ timestamp: 106_000 }, 100_000)).toBe(true);
    expect(derivativeQuoteSnapshotIsStale(null, 100_000)).toBe(true);
  });

  it("freezes positions only at a finite expiry boundary", () => {
    expect(derivativePositionIsExpired({ expiry: 1_000 }, 1_000)).toBe(true);
    expect(derivativePositionIsExpired({ expiry: 1_000 }, 1_001)).toBe(true);
    expect(derivativePositionIsExpired({ expiry: 1_001 }, 1_000)).toBe(false);
    expect(derivativePositionIsExpired({ expiry: null }, 1_000)).toBe(false);
    expect(derivativePositionIsExpired({ expiry: Number.NaN }, 1_000)).toBe(false);
    expect(derivativePositionIsExpired({ expiry: 1_000 }, Number.NaN)).toBe(false);
  });
});

describe("derivative ticket intent", () => {
  const instrument = option("USDC", "call");
  const quote: DerivativeQuote = { instrumentId: instrument.id, timestamp: 100_000, bid: 4999, ask: 5001, mark: 5000, last: 5000, index: 80000, fundingRate: null, nextFundingAt: null, openInterest: null, iv: null, delta: null, source: "native-api" };

  it("seeds long, short and reduce-only protection from their actual book side", () => {
    expect(derivativeProtectionSeed(instrument, quote, "open", "long", 100_000)).toBe("5001");
    expect(derivativeProtectionSeed(instrument, quote, "close", "long", 100_000)).toBe("4999");
    expect(derivativeProtectionSeed(instrument, quote, "open", "short", 100_000)).toBe("4999");
    expect(derivativeProtectionSeed(instrument, quote, "close", "short", 100_000)).toBe("5001");
  });

  it("requires a matching fresh book instead of guessing from a mark", () => {
    for (const unavailable of [null, { ...quote, timestamp: 84_999 }, { ...quote, instrumentId: "other" }, { ...quote, bid: null }, { ...quote, ask: Number.NaN }, { ...quote, source: "fixture" as const }]) {
      expect(derivativeProtectionSeed(instrument, unavailable, "close", "long", 100_000)).toBeNull();
    }
  });

  it("uses the engine's decimal quantity and variable tick validation", () => {
    const constraints = { ...instrument, minContracts: 0.01, quantityStep: 0.01, priceTick: 0.1, priceTickSteps: [{ abovePrice: 0.5, tick: 0.5 }] };
    expect(derivativeInputErrors(constraints, "0.015", "0.6")).toEqual({ quantity: "Quantity violates native contract constraints.", maximumPrice: "Price protection violates native price tick." });
    expect(derivativeInputErrors(constraints, "0.01", "0.5")).toEqual({ quantity: null, maximumPrice: null });
    expect(derivativeInputErrors(constraints, "0.01", "1")).toEqual({ quantity: null, maximumPrice: null });
    expect(derivativeInputErrors(constraints, "0.001", "0").quantity).not.toBeNull();
  });

  it("separates definite rejections from lost or unconfirmed responses", () => {
    expect(derivativeCommandWasRejected(new DerivativeRequestError("Quantity rejected", 422, false))).toBe(true);
    expect(derivativeCommandWasRejected(new DerivativeRequestError("Replay", 409))).toBe(true);
    expect(derivativeCommandWasRejected(new DerivativeRequestError("Invalid request", 400))).toBe(true);
    expect(derivativeCommandWasRejected(new DerivativeRequestError("Cannot inspect ledger", 422))).toBe(false);
    expect(derivativeCommandWasRejected(new DerivativeRequestError("Intent exists", 422, true))).toBe(false);
    expect(derivativeCommandWasRejected(new DerivativeRequestError("Unavailable", 503))).toBe(false);
    expect(derivativeCommandWasRejected(new TypeError("Failed to fetch"))).toBe(false);
  });
});
