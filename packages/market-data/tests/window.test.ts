import { describe, expect, it } from "vitest";
import { recentCompletedWindow } from "../src/utils.js";

describe("fixed duration UTC window", () => {
  it("uses epoch duration arithmetic including the exact boundary", () => {
    const boundary = Date.parse("2026-03-29T02:00:00Z");
    expect(recentCompletedWindow("1h", 3, boundary)).toEqual({ since: boundary - 3 * 3_600_000, through: boundary });
    expect(recentCompletedWindow("1h", 3, boundary + 1)).toEqual({ since: boundary - 3 * 3_600_000, through: boundary });
    expect(recentCompletedWindow("1h", 3, boundary - 1)).toEqual({ since: boundary - 4 * 3_600_000, through: boundary - 3_600_000 });
    expect(recentCompletedWindow("1d", 2, Date.parse("2026-03-30T00:00:00Z"))).toEqual({ since: Date.parse("2026-03-28T00:00:00Z"), through: Date.parse("2026-03-30T00:00:00Z") });
  });
});
