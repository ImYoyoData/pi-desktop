import { describe, expect, it } from "vitest";
import { isOfflineMode } from "../../src/shared/offline";

describe("isOfflineMode", () => {
  it("未设置 PI_OFFLINE 时为在线", () => {
    expect(isOfflineMode({})).toBe(false);
  });

  it("1 / true / yes（含大小写与空白）视为离线", () => {
    for (const value of ["1", "true", "TRUE", " yes ", "Yes"]) {
      expect(isOfflineMode({ PI_OFFLINE: value })).toBe(true);
    }
  });

  it("其它取值不算离线", () => {
    for (const value of ["", "0", "false", "no", "off"]) {
      expect(isOfflineMode({ PI_OFFLINE: value })).toBe(false);
    }
  });
});