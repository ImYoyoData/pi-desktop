import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { shouldRefreshCatalog } from "../../src/main/models-ipc";

describe("shouldRefreshCatalog", () => {
  const savedOffline = process.env.PI_OFFLINE;

  beforeEach(() => {
    delete process.env.PI_OFFLINE;
  });

  afterEach(() => {
    if (savedOffline === undefined) delete process.env.PI_OFFLINE;
    else process.env.PI_OFFLINE = savedOffline;
  });

  it("未显式要求时不刷新（输入框、消息列表等高频路径）", () => {
    expect(shouldRefreshCatalog(undefined)).toBe(false);
    expect(shouldRefreshCatalog({})).toBe(false);
    expect(shouldRefreshCatalog({ refreshCatalog: false })).toBe(false);
  });

  it("只有模型页显式要求时才刷新", () => {
    expect(shouldRefreshCatalog({ refreshCatalog: true })).toBe(true);
  });

  it("离线模式下即使显式要求也不联网", () => {
    process.env.PI_OFFLINE = "1";
    expect(shouldRefreshCatalog({ refreshCatalog: true })).toBe(false);
  });
});