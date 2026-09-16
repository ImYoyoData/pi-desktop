/** 自定义外观（壁纸、遮罩、界面透明度、预设）的类型与归一化，主进程与渲染进程共用。 */

export type WallpaperKind = "none" | "color" | "image" | "video";

export interface WallpaperSettings {
  kind: WallpaperKind;
  /** 图片/视频的本地绝对路径。 */
  path: string;
  color: string;
  /** 遮罩不透明度 0-1，越大壁纸越淡。 */
  veilOpacity: number;
  /** 遮罩模糊 0-1，映射到 VEIL_BLUR_MAX_PX。 */
  veilBlur: number;
}

export interface SurfaceAlphaSettings {
  input: number;
  card: number;
  settings: number;
}

export interface AppearancePreset {
  id: string;
  name: string;
  wallpaper: WallpaperSettings;
  surfaces: SurfaceAlphaSettings;
}

export interface CustomAppearanceSettings {
  wallpaper: WallpaperSettings;
  surfaces: SurfaceAlphaSettings;
  presets: AppearancePreset[];
}

/** 卡片与设置页的透明度保底：滑到 0 也不会全透明。 */
export const SURFACE_ALPHA_FLOOR = 0.2;
export const VEIL_BLUR_MAX_PX = 40;
export const PRESET_NAME_MAX_LENGTH = 24;

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

/** 预设色板，取自参考设计。 */
export const WALLPAPER_SOLID_COLORS = [
  "#f2c9c9",
  "#e8dcc8",
  "#efe3b8",
  "#c7edcc",
  "#c7d8ee",
  "#d8cdf0",
  "#ccd8ce",
  "#ddd9d2",
] as const;

const DEFAULT_COLOR = "#c7edcc";

export function createDefaultWallpaper(): WallpaperSettings {
  return { kind: "none", path: "", color: DEFAULT_COLOR, veilOpacity: 0.6, veilBlur: 0 };
}

export function createDefaultSurfaces(): SurfaceAlphaSettings {
  return { input: 0.2, card: 0.52, settings: 0.72 };
}

export function createDefaultCustomAppearance(): CustomAppearanceSettings {
  return { wallpaper: createDefaultWallpaper(), surfaces: createDefaultSurfaces(), presets: [] };
}

function clamp01(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, n));
}

function floorAlpha(value: unknown, fallback: number): number {
  return Math.max(SURFACE_ALPHA_FLOOR, clamp01(value, fallback));
}

/** 规范化 #rrggbb；无法识别时返回 null。 */
export function normalizeHexColor(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const raw = input.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) return null;
  return `#${raw.toLowerCase()}`;
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
  const color = normalizeHexColor(input.color) ?? base.color;
  const stored = input.kind;
  const kind: WallpaperKind =
    stored === "color" || stored === "image" || stored === "video" || stored === "none"
      ? stored
      : "none";
  const resolved: WallpaperKind =
    kind === "image" || kind === "video" ? (path ? kind : "none") : kind;
  return {
    kind: resolved,
    path,
    color,
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
    card: floorAlpha(input.card, base.card),
    settings: floorAlpha(input.settings, base.settings),
  };
}

function normalizePresetName(raw: unknown, index: number): string {
  const name = typeof raw === "string" ? raw.trim() : "";
  return (name || `Preset ${index + 1}`).slice(0, PRESET_NAME_MAX_LENGTH);
}

function normalizePreset(raw: unknown, index: number): AppearancePreset | null {
  if (!raw || typeof raw !== "object") return null;
  const input = raw as Record<string, unknown>;
  const id = typeof input.id === "string" && input.id ? input.id : newPresetId();
  return {
    id,
    name: normalizePresetName(input.name, index),
    wallpaper: normalizeWallpaper(input.wallpaper),
    surfaces: normalizeSurfaces(input.surfaces),
  };
}

export function newPresetId(): string {
  return `preset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeCustomAppearance(raw: unknown): CustomAppearanceSettings {
  if (!raw || typeof raw !== "object") return createDefaultCustomAppearance();
  const input = raw as Record<string, unknown>;
  const list = Array.isArray(input.presets) ? input.presets : [];
  const presets: AppearancePreset[] = [];
  for (const [index, item] of list.entries()) {
    const preset = normalizePreset(item, index);
    if (preset) presets.push(preset);
  }
  return {
    wallpaper: normalizeWallpaper(input.wallpaper),
    surfaces: normalizeSurfaces(input.surfaces),
    presets,
  };
}
