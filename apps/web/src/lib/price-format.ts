/**
 * One price rendering for the whole workstation.
 *
 * The plate, the watchlist, the chart legend and the position table were each
 * formatting the same quote with their own rules, so a single BTC print read as
 * `87,497.24004` in the plate and `87,497.24` in the chart on the same screen.
 *
 * Precision follows magnitude rather than significant digits: above 1 the column
 * keeps two decimals so decimal points line up down a list, and sub-dollar pairs
 * densify instead of printing trailing noise.
 */
export function formatQuotePrice(value: number | null | undefined, fallback = "—"): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const magnitude = Math.abs(value);
  const digits = magnitude >= 1 ? 2 : magnitude >= 0.01 ? 4 : magnitude >= 0.0001 ? 6 : 8;
  return value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}
