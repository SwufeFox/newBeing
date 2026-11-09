import { describe, expect, it } from "vitest";
import { formatCompactAmount, formatPercentChange, formatQuotePrice, formatRate, formatSize } from "../src/lib/price-format.js";

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

/* A resting size is a quantity, not a quote: the depth ladder and the trade
   tape print it through its own ladder, and the boundaries matter because a
   size that silently loses its decimals reads as a different quantity. */
describe("formatSize", () => {
  it("keeps four decimals so a resting size stays exact", () => {
    expect(formatSize(0.14)).toBe("0.1400");
    expect(formatSize(866.14)).toBe("866.1400");
    expect(formatSize(1)).toBe("1.0000");
  });

  it("keeps the digits of a dust size instead of rounding it away", () => {
    expect(formatSize(0.00001234)).toBe("0.00001234");
    expect(formatSize(0.0001)).toBe("0.0001");
  });

  it("drops the decimals that a size of ten thousand cannot use", () => {
    expect(formatSize(12_345.6789)).toBe("12,345.68");
  });

  it("renders an absent size as an em dash rather than 0.0000", () => {
    expect(formatSize(null)).toBe("—");
    expect(formatSize(undefined)).toBe("—");
    expect(formatSize(Number.NaN)).toBe("—");
  });
});

/* A traded amount spans magnitudes, so the unit follows the value instead of
   being assumed. The plate used to divide by a million unconditionally, which
   printed 0.00M for a thin market and 1420.00M for a busy one. */
describe("formatCompactAmount", () => {
  it("picks the unit from the magnitude", () => {
    expect(formatCompactAmount(171_700_000)).toBe("171.70M");
    expect(formatCompactAmount(820_000)).toBe("820.00K");
    expect(formatCompactAmount(1_420_000_000)).toBe("1.42B");
  });

  it("prints a small amount without a unit rather than rounding it away", () => {
    expect(formatCompactAmount(842.5)).toBe("842.50");
    expect(formatCompactAmount(0)).toBe("0.00");
  });

  it("renders an absent amount as an em dash", () => {
    expect(formatCompactAmount(null)).toBe("—");
    expect(formatCompactAmount(Number.NaN)).toBe("—");
  });
});

/* A change and a rate are two different numbers. A return or a drawdown has a
   direction and must show it; a win rate is a proportion and must not. The
   workstation printed a win rate as `+54.55%` because both went through the
   signed formatter. */
describe("formatPercentChange", () => {
  it("carries the sign of a return or a drawdown", () => {
    expect(formatPercentChange(0.0287)).toBe("+2.87%");
    expect(formatPercentChange(-0.0572)).toBe("−5.72%");
    expect(formatPercentChange(1.5)).toBe("+150.00%");
  });

  it("leaves a zero change unsigned", () => {
    expect(formatPercentChange(0)).toBe("0.00%");
    expect(formatPercentChange(-0)).toBe("0.00%");
  });

  it("renders an absent change as an em dash", () => {
    expect(formatPercentChange(null)).toBe("—");
    expect(formatPercentChange(Number.NaN)).toBe("—");
  });
});

describe("formatRate", () => {
  it("prints a proportion without a sign", () => {
    expect(formatRate(0.5455)).toBe("54.55%");
    expect(formatRate(0)).toBe("0.00%");
    expect(formatRate(1)).toBe("100.00%");
  });

  it("renders an absent rate as an em dash", () => {
    expect(formatRate(null)).toBe("—");
    expect(formatRate(Number.POSITIVE_INFINITY)).toBe("—");
  });
});
