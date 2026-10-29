/** 窗口大小记忆：启动时按上次记住的大小开窗，窗口尺寸变化后回写偏好。 */

import { BrowserWindow, screen } from "electron";
import { prefsPath, readPrefs, updatePrefs, updatePrefsSync } from "./prefs-store";
import {
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  WINDOW_SIZE_PREF,
  isRememberSizeEnabled,
  parseWindowSize,
  serializeWindowSize,
  type WindowSize,
} from "../shared/window-size";

/** 默认窗口尺寸（屏幕像素），按缩放比换算成 DIP。 */
const DEFAULT_WIDTH_PX = 1550;
const DEFAULT_HEIGHT_PX = 960;

/** 拖拽窗口时 resize 事件很密集，攒一会儿再落盘。 */
const SAVE_DEBOUNCE_MS = 400;

function currentPrefs(): Record<string, string> {
  return readPrefs(prefsPath());
}

/** 把尺寸裁进屏幕可用区域，避免窗口大到标题栏够不着。 */
function clampToDisplay(size: WindowSize): WindowSize {
  const { workArea } = screen.getPrimaryDisplay();
  return {
    width: Math.max(MIN_WINDOW_WIDTH, Math.min(size.width, workArea.width)),
    height: Math.max(MIN_WINDOW_HEIGHT, Math.min(size.height, workArea.height)),
  };
}

/** 启动时的窗口尺寸：记住就用记住的，否则用默认尺寸。 */
export function resolveWindowSize(): WindowSize {
  const prefs = currentPrefs();
  if (isRememberSizeEnabled(prefs)) {
    const saved = parseWindowSize(prefs[WINDOW_SIZE_PREF]);
    if (saved) return clampToDisplay(saved);
  }
  const { scaleFactor } = screen.getPrimaryDisplay();
  return {
    width: Math.round(DEFAULT_WIDTH_PX / scaleFactor),
    height: Math.round(DEFAULT_HEIGHT_PX / scaleFactor),
  };
}

/** 窗口尺寸变化后把新尺寸写回偏好，下次启动按它开窗。 */
export function trackWindowSize(win: BrowserWindow): void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const sizePatch = (): Record<string, string> => {
    const bounds = win.getNormalBounds();
    return {
      [WINDOW_SIZE_PREF]: serializeWindowSize({
        width: bounds.width,
        height: bounds.height,
      }),
    };
  };

  const flush = (sync: boolean): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (win.isDestroyed()) return;
    if (!isRememberSizeEnabled(currentPrefs())) return;
    if (sync) updatePrefsSync(sizePatch());
    else void updatePrefs(sizePatch());
  };

  win.on("resize", () => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => flush(false), SAVE_DEBOUNCE_MS);
  });
  // 退出时同步落盘，异步队列来不及跑完也不丢最后一次尺寸。
  win.on("close", () => flush(true));
}
