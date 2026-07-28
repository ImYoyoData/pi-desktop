import { describe, expect, it } from "vitest";
import { piPackagesHasMore } from "../../src/shared/pi-market";

describe("piPackagesHasMore", () => {
  it("detects more pages from range hint", () => {
    expect(piPackagesHasMore("1-50 / 5364", 1, 50)).toBe(true);
    expect(piPackagesHasMore("51-100 / 5364", 2, 50)).toBe(true);
    expect(piPackagesHasMore("5351-5364 / 5364", 108, 14)).toBe(false);
  });

  it("falls back to page size when hint missing", () => {
    expect(piPackagesHasMore(null, 1, 50)).toBe(true);
    expect(piPackagesHasMore(null, 1, 12)).toBe(false);
  });
});
