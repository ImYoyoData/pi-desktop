import { describe, expect, it } from "vitest";
import { formatDuration } from "../../src/renderer/src/utils/format-duration";

describe("formatDuration", () => {
  it("keeps ms below one second and switches to s above", () => {
    expect(formatDuration(0)).toBe("0ms");
    expect(formatDuration(999)).toBe("999ms");
    expect(formatDuration(1_000)).toBe("1.0s");
    expect(formatDuration(12_500)).toBe("12s");
  });
});
