import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const display = {
  workArea: { width: 1920, height: 1040 },
  scaleFactor: 1,
};

vi.mock("electron", () => ({
  BrowserWindow: class {},
  screen: { getPrimaryDisplay: () => display },
}));

type FakeWindow = {
  on: (event: string, handler: () => void) => void;
  emit: (event: string) => void;
  isDestroyed: () => boolean;
  getNormalBounds: () => { width: number; height: number };
};

function createFakeWindow(bounds: { width: number; height: number }): FakeWindow {
  const handlers = new Map<string, () => void>();
  return {
    on: (event, handler) => handlers.set(event, handler),
    emit: (event) => handlers.get(event)?.(),
    isDestroyed: () => false,
    getNormalBounds: () => bounds,
  };
}

/** 队列里的写入是 promise 链，几次微任务就能落盘。 */
async function flushWrites(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe("window-size", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-desk-window-size-"));
    process.env.PI_CODING_AGENT_DIR = dir;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.PI_CODING_AGENT_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function writePrefs(prefs: Record<string, string>): void {
    fs.writeFileSync(
      path.join(dir, "desktop-prefs.json"),
      JSON.stringify(prefs),
      "utf8",
    );
  }

  function readPrefs(): Record<string, string> {
    return JSON.parse(fs.readFileSync(path.join(dir, "desktop-prefs.json"), "utf8"));
  }

  it("记住的大小优先于默认尺寸", async () => {
    writePrefs({ "window:size": JSON.stringify({ width: 1200, height: 800 }) });
    const { resolveWindowSize } = await import("../../src/main/window-size");

    expect(resolveWindowSize()).toEqual({ width: 1200, height: 800 });
  });

  it("关掉开关时用默认尺寸", async () => {
    writePrefs({
      "window:size": JSON.stringify({ width: 1200, height: 800 }),
      "window:rememberSize": "off",
    });
    const { resolveWindowSize } = await import("../../src/main/window-size");

    expect(resolveWindowSize()).toEqual({ width: 1550, height: 960 });
  });

  it("没有记录时用默认尺寸", async () => {
    writePrefs({});
    const { resolveWindowSize } = await import("../../src/main/window-size");

    expect(resolveWindowSize()).toEqual({ width: 1550, height: 960 });
  });

  it("记住的尺寸超过屏幕时裁剪", async () => {
    writePrefs({ "window:size": JSON.stringify({ width: 3000, height: 2000 }) });
    const { resolveWindowSize } = await import("../../src/main/window-size");

    expect(resolveWindowSize()).toEqual({ width: 1920, height: 1040 });
  });

  it("窗口尺寸变化后写回偏好", async () => {
    writePrefs({});
    const { trackWindowSize } = await import("../../src/main/window-size");
    const win = createFakeWindow({ width: 1000, height: 700 });

    trackWindowSize(win as never);
    win.emit("resize");
    vi.advanceTimersByTime(500);
    await flushWrites();

    expect(readPrefs()["window:size"]).toBe(
      JSON.stringify({ width: 1000, height: 700 }),
    );
  });

  it("关掉开关后不再写回偏好", async () => {
    writePrefs({ "window:rememberSize": "off" });
    const { trackWindowSize } = await import("../../src/main/window-size");
    const win = createFakeWindow({ width: 1000, height: 700 });

    trackWindowSize(win as never);
    win.emit("resize");
    vi.advanceTimersByTime(500);
    await flushWrites();

    expect(readPrefs()["window:size"]).toBeUndefined();
  });

  it("退出时同步落盘", async () => {
    writePrefs({});
    const { trackWindowSize } = await import("../../src/main/window-size");
    const win = createFakeWindow({ width: 1000, height: 700 });

    trackWindowSize(win as never);
    win.emit("close");

    expect(readPrefs()["window:size"]).toBe(
      JSON.stringify({ width: 1000, height: 700 }),
    );
  });
});
