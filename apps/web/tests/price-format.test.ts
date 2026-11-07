import { describe, expect, it } from "vitest";
import { formatQuotePrice } from "../src/lib/price-format.js";

/* The plate, the watchlist, the chart legend and the positions table all render
   one quote through this function. The boundaries matter: a pair that crosses
   0.01 or 0.0001 must not silently change how many digits the reader sees. */
describe("formatQuotePrice", () => {
  it("keeps two decimals down the list for every price at or above 1", () => {
    expect(formatQuotePrice(87_497.24004)).toBe("87,497.24");
    expect(formatQuotePrice(3_191.075813)).toBe("3,191.08");
    expect(formatQuotePrice(1)).toBe("1.00");
  });

  it("densifies below 1 so small pairs keep their significant digits", () => {
    expect(formatQuotePrice(0.5)).toBe("0.5000");
    expect(formatQuotePrice(0.01)).toBe("0.0100");
    expect(formatQuotePrice(0.0001)).toBe("0.000100");
  });

  it("keeps eight decimals for dust prices instead of rounding them to zero", () => {
    expect(formatQuotePrice(0.00001234)).toBe("0.00001234");
  });

  it("renders an absent quote as an em dash rather than 0.00", () => {
    expect(formatQuotePrice(null)).toBe("—");
    expect(formatQuotePrice(undefined)).toBe("—");
    expect(formatQuotePrice(Number.NaN)).toBe("—");
    expect(formatQuotePrice(Number.POSITIVE_INFINITY)).toBe("—");
  });

  it("prints negative prices through the same magnitude rules", () => {
    expect(formatQuotePrice(-2_500.5)).toBe("-2,500.50");
  });
});
