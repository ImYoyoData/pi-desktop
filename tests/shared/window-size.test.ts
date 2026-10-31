import { describe, expect, it } from "vitest";
import {
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  REMEMBER_WINDOW_SIZE_PREF,
  WINDOW_SIZE_PREF,
  isRememberSizeEnabled,
  parseWindowSize,
  serializeWindowSize,
} from "../../src/shared/window-size";

describe("parseWindowSize", () => {
  it("解析记住的宽高", () => {
    expect(parseWindowSize('{"width":1200,"height":800}')).toEqual({
      width: 1200,
      height: 800,
    });
  });

  it("空值或非法内容返回 null", () => {
    expect(parseWindowSize(undefined)).toBeNull();
    expect(parseWindowSize("")).toBeNull();
    expect(parseWindowSize("not json")).toBeNull();
    expect(parseWindowSize('{"width":"1200","height":800}')).toBeNull();
    expect(parseWindowSize('{"width":null,"height":800}')).toBeNull();
  });

  it("小于最小尺寸的记录丢弃", () => {
    expect(
      parseWindowSize(
        JSON.stringify({ width: MIN_WINDOW_WIDTH - 1, height: MIN_WINDOW_HEIGHT }),
      ),
    ).toBeNull();
    expect(
      parseWindowSize(
        JSON.stringify({ width: MIN_WINDOW_WIDTH, height: MIN_WINDOW_HEIGHT - 1 }),
      ),
    ).toBeNull();
  });
});

describe("serializeWindowSize", () => {
  it("与 parseWindowSize 往返", () => {
    const size = { width: 1360.4, height: 912.6 };
    expect(parseWindowSize(serializeWindowSize(size))).toEqual({
      width: 1360,
      height: 913,
    });
  });
});

describe("isRememberSizeEnabled", () => {
  it("默认开启，显式 off 才关闭", () => {
    expect(isRememberSizeEnabled({})).toBe(true);
    expect(isRememberSizeEnabled({ [REMEMBER_WINDOW_SIZE_PREF]: "on" })).toBe(true);
    expect(isRememberSizeEnabled({ [REMEMBER_WINDOW_SIZE_PREF]: "off" })).toBe(false);
  });
});

describe("偏好键", () => {
  it("尺寸与开关用不同的键", () => {
    expect(WINDOW_SIZE_PREF).not.toBe(REMEMBER_WINDOW_SIZE_PREF);
  });
});
