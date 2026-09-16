/** 自定义外观（壁纸、遮罩、界面透明度、预设）的类型与归一化，主进程与渲染进程共用。 */

export type WallpaperKind = "none" | "image" | "video";

export interface WallpaperSettings {
  kind: WallpaperKind;
  /** 图片/视频的本地绝对路径。 */
  path: string;
  /** 遮罩不透明度 0-1，越大壁纸越淡。 */
  veilOpacity: number;
  /** 遮罩模糊 0-1，映射到 VEIL_BLUR_MAX_PX。 */
  veilBlur: number;
}

export interface SurfaceAlphaSettings {
  input: number;
  card: number;
  settings: number;
  /** 工具调用卡片（命令与输出块）底色透明度。 */
  tool: number;
}

export interface CustomAppearanceSettings {
  wallpaper: WallpaperSettings;
  surfaces: SurfaceAlphaSettings;
  /** 消息区最大宽度：占聊天面板宽度的比例。 */
  messageWidth: number;
}

/** 自定义外观设置在 localStorage 的键；v2 起壁纸模式固定为深色玻璃。 */
export const CUSTOM_APPEARANCE_KEY = "pi-desktop:appearance-custom:v2";
export const CUSTOM_APPEARANCE_LEGACY_KEY = "pi-desktop:appearance-custom:v1";

export const VEIL_BLUR_MAX_PX = 40;
/** 消息区宽度档位：占聊天面板宽度的比例。 */
export const MESSAGE_WIDTH_CHOICES = [0.6, 0.75, 0.8, 0.85, 1] as const;
/** 默认档位。 */
export const MESSAGE_WIDTH_DEFAULT = 0.75;

export const WALLPAPER_IMAGE_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "avif",
  "bmp",
  "svg",
] as const;

export const WALLPAPER_VIDEO_EXTENSIONS = ["mp4", "webm", "mov", "m4v", "ogv"] as const;

export function createDefaultWallpaper(): WallpaperSettings {
  return { kind: "none", path: "", veilOpacity: 0.6, veilBlur: 0 };
}

export function createDefaultSurfaces(): SurfaceAlphaSettings {
  return { input: 0, card: 0, settings: 0, tool: 0 };
}

export function createDefaultCustomAppearance(): CustomAppearanceSettings {
  return {
    wallpaper: createDefaultWallpaper(),
    surfaces: createDefaultSurfaces(),
    messageWidth: MESSAGE_WIDTH_DEFAULT,
  };
}

export function normalizeMessageWidth(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return MESSAGE_WIDTH_DEFAULT;
  return MESSAGE_WIDTH_CHOICES.reduce((best, choice) =>
    Math.abs(choice - n) < Math.abs(best - n) ? choice : best,
  );
}

function clamp01(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, n));
}

export function wallpaperKindForPath(filePath: string): "image" | "video" | null {
  const dot = filePath.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = filePath.slice(dot + 1).toLowerCase();
  if ((WALLPAPER_IMAGE_EXTENSIONS as readonly string[]).includes(ext)) return "image";
  if ((WALLPAPER_VIDEO_EXTENSIONS as readonly string[]).includes(ext)) return "video";
  return null;
}

/** 渲染进程可直接喂给 <img>/<video> 的本地媒体地址。 */
export function wallpaperMediaSrc(filePath: string): string {
  return `pi-media://file/?p=${encodeURIComponent(filePath)}`;
}

function normalizeWallpaper(raw: unknown): WallpaperSettings {
  const base = createDefaultWallpaper();
  if (!raw || typeof raw !== "object") return base;
  const input = raw as Record<string, unknown>;
  const path = typeof input.path === "string" ? input.path : "";
  // 已移除的「纯色背景」与缺失路径的旧数据都回退为无背景
  const stored = input.kind;
  const kind: WallpaperKind = stored === "image" || stored === "video" ? stored : "none";
  return {
    kind: kind !== "none" && !path ? "none" : kind,
    path,
    veilOpacity: clamp01(input.veilOpacity, base.veilOpacity),
    veilBlur: clamp01(input.veilBlur, base.veilBlur),
  };
}

function normalizeSurfaces(raw: unknown): SurfaceAlphaSettings {
  const base = createDefaultSurfaces();
  if (!raw || typeof raw !== "object") return base;
  const input = raw as Record<string, unknown>;
  return {
    input: clamp01(input.input, base.input),
    card: clamp01(input.card, base.card),
    settings: clamp01(input.settings, base.settings),
    tool: clamp01(input.tool, base.tool),
  };
}

export function normalizeCustomAppearance(raw: unknown): CustomAppearanceSettings {
  if (!raw || typeof raw !== "object") return createDefaultCustomAppearance();
  const input = raw as Record<string, unknown>;
  return {
    wallpaper: normalizeWallpaper(input.wallpaper),
    surfaces: normalizeSurfaces(input.surfaces),
    messageWidth: normalizeMessageWidth(input.messageWidth),
  };
}
