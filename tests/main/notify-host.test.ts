import { describe, expect, it, vi, beforeEach } from "vitest";

const focusMock = vi.fn();
const showMock = vi.fn();
const restoreMock = vi.fn();
const isMinimizedMock = vi.fn(() => false);
const appFocusMock = vi.fn();

const win = {
  isDestroyed: () => false,
  isMinimized: isMinimizedMock,
  restore: restoreMock,
  show: showMock,
  focus: focusMock,
};

vi.mock("electron", () => ({
  app: { focus: (...args: unknown[]) => appFocusMock(...args) },
  BrowserWindow: {
    getAllWindows: () => [win],
    getFocusedWindow: () => null,
  },
  Notification: class {
    static isSupported = () => true;
    on() {
      return this;
    }
    once() {
      return this;
    }
    show() {}
  },
  ipcMain: { handle: vi.fn() },
}));

describe("focusMainWindow", () => {
  beforeEach(() => {
    focusMock.mockClear();
    showMock.mockClear();
    restoreMock.mockClear();
    appFocusMock.mockClear();
    isMinimizedMock.mockReturnValue(false);
  });

  it("shows and focuses the main window", async () => {
    const { focusMainWindow } = await import("../../src/main/notify-host");
    focusMainWindow();
    expect(showMock).toHaveBeenCalled();
    expect(focusMock).toHaveBeenCalled();
  });

  it("restores when minimized", async () => {
    isMinimizedMock.mockReturnValue(true);
    const { focusMainWindow } = await import("../../src/main/notify-host");
    focusMainWindow();
    expect(restoreMock).toHaveBeenCalled();
    expect(showMock).toHaveBeenCalled();
    expect(focusMock).toHaveBeenCalled();
  });
});
