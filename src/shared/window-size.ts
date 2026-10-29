/**
 * 窗口大小记忆：偏好文件（desktop-prefs.json）里的 window:* 键。
 * 主进程负责存取尺寸，渲染层只负责开关。
 */

export const WINDOW_SIZE_PREF = "window:size";
export const REMEMBER_WINDOW_SIZE_PREF = "window:rememberSize";

export type WindowSize = {
  width: number;
  height: number;
};

/** 窗口最小尺寸，与 BrowserWindow 的 minWidth / minHeight 保持一致。 */
export const MIN_WINDOW_WIDTH = 960;
export const MIN_WINDOW_HEIGHT = 640;

export function parseWindowSize(raw: string | undefined): WindowSize | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const { width, height } = parsed as Partial<WindowSize>;
  if (typeof width !== "number" || typeof height !== "number") return null;
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width < MIN_WINDOW_WIDTH || height < MIN_WINDOW_HEIGHT) return null;
  return { width: Math.round(width), height: Math.round(height) };
}

export function serializeWindowSize(size: WindowSize): string {
  return JSON.stringify({
    width: Math.round(size.width),
    height: Math.round(size.height),
  });
}

/** 记住窗口大小默认开启，只有显式写成 off 才关闭。 */
export function isRememberSizeEnabled(
  prefs: Record<string, string | undefined>,
): boolean {
  return prefs[REMEMBER_WINDOW_SIZE_PREF] !== "off";
}
