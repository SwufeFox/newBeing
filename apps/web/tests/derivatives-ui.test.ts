import { describe, expect, it } from "vitest";
import type { DerivativeInstrument } from "@newbeing/market-data/derivatives";
import { derivativeOptionChain, derivativeQuoteSnapshotIsStale } from "../src/lib/derivatives-ui.js";

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
});
