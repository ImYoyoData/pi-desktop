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

/** 内置字体：界面与代码字体都从这些字体里选。 */
export interface BuiltinFont {
  id: string;
  label: string;
  family: string;
}

/** Codex 用 Geist，GitHub 用 Mona Sans / Monaspace，均为 OFL 授权。 */
export const BUILTIN_FONTS: readonly BuiltinFont[] = [
  { id: "builtin:geist", label: "Codex · Geist", family: "Geist" },
  { id: "builtin:geist-mono", label: "Codex · Geist Mono", family: "Geist Mono" },
  { id: "builtin:mona-sans", label: "GitHub · Mona Sans", family: "Mona Sans" },
  { id: "builtin:monaspace", label: "GitHub · Monaspace Neon", family: "Monaspace Neon" },
];

/** 用户添加的本地字体文件；family 是注入 @font-face 时用的内部族名。 */
export interface LocalFont {
  id: string;
  name: string;
  path: string;
  family: string;
}

export interface FontSettings {
  /** 界面字体标识；空串表示跟随系统默认。 */
  ui: string;
  /** 代码字体标识；空串表示跟随系统默认。 */
  mono: string;
  local: LocalFont[];
}

export const FONT_FILE_EXTENSIONS = ["ttf", "otf", "woff", "woff2"] as const;

const DEFAULT_UI_FONT_STACK = `-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif`;
const DEFAULT_MONO_FONT_STACK = `"SF Mono", "JetBrains Mono", "Fira Code", Consolas, "Liberation Mono", Menlo, Courier, "PingFang SC", "Microsoft YaHei"`;

export interface CustomAppearanceSettings {
  wallpaper: WallpaperSettings;
  surfaces: SurfaceAlphaSettings;
  /** 消息区最大宽度：占聊天面板宽度的比例。 */
  messageWidth: number;
  /** 输入框最大宽度；缺省表示跟随消息区宽度。 */
  inputWidth?: number;
  fonts: FontSettings;
}

/** 自定义外观设置在 localStorage 的键；v2 起壁纸模式固定为深色玻璃。 */
export const CUSTOM_APPEARANCE_KEY = "pi-desktop:appearance-custom:v2";
export const CUSTOM_APPEARANCE_LEGACY_KEY = "pi-desktop:appearance-custom:v1";

export const VEIL_BLUR_MAX_PX = 40;
/** 消息区宽度档位：占聊天面板宽度的比例。 */
export const MESSAGE_WIDTH_CHOICES = [0.6, 0.75, 0.8, 0.85, 1] as const;
/** 默认档位。 */
export const MESSAGE_WIDTH_DEFAULT = 0.75;

/** 界面字号档位（px）：只改变文字大小，图标与间距保持原样。 */
export const FONT_SIZE_CHOICES = [9, 10, 11, 12, 13, 14, 15, 16] as const;
/** 默认字号（px），也是样式里 px 换算 rem 的基准。 */
export const FONT_SIZE_DEFAULT = 13;

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

export function createDefaultFontSettings(): FontSettings {
  return { ui: "", mono: "", local: [] };
}

export function createDefaultCustomAppearance(): CustomAppearanceSettings {
  return {
    wallpaper: createDefaultWallpaper(),
    surfaces: createDefaultSurfaces(),
    messageWidth: MESSAGE_WIDTH_DEFAULT,
    fonts: createDefaultFontSettings(),
  };
}

export function normalizeMessageWidth(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return MESSAGE_WIDTH_DEFAULT;
  return MESSAGE_WIDTH_CHOICES.reduce((best, choice) =>
    Math.abs(choice - n) < Math.abs(best - n) ? choice : best,
  );
}

/** 输入框宽度：缺省或非法值返回 undefined，表示跟随消息区宽度。 */
export function normalizeInputWidth(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return undefined;
  return normalizeMessageWidth(n);
}

export function normalizeFontSize(value: unknown): number {
  let n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return FONT_SIZE_DEFAULT;
  // 旧版存的是缩放比例（0.9–1.5），按默认字号换算成 px 后再吸附到档位
  if (n > 0 && n <= 3) n = Math.round(n * FONT_SIZE_DEFAULT);
  return FONT_SIZE_CHOICES.reduce((best, choice) =>
    Math.abs(choice - n) < Math.abs(best - n) ? choice : best,
  );
}

/** 设计稿 px 字号换算为随根字号缩放的 rem 值。 */
export function fontSizeRem(basePx: number): string {
  return `${Number((basePx / FONT_SIZE_DEFAULT).toFixed(4))}rem`;
}

/** 设计稿 px 字号换算为当前设置下的实际 px（Monaco / xterm 等只收数字的场合）。 */
export function fontSizePx(basePx: number, rootPx: number): number {
  return Math.round(((basePx / FONT_SIZE_DEFAULT) * rootPx) * 2) / 2;
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

export function isFontFilePath(filePath: string): boolean {
  const dot = filePath.lastIndexOf(".");
  if (dot < 0) return false;
  return (FONT_FILE_EXTENSIONS as readonly string[]).includes(
    filePath.slice(dot + 1).toLowerCase(),
  );
}

/** 渲染进程可直接喂给 <img>/<video>/@font-face 的本地媒体地址。 */
export function localMediaSrc(filePath: string): string {
  return `pi-media://file/?p=${encodeURIComponent(filePath)}`;
}

export function wallpaperMediaSrc(filePath: string): string {
  return localMediaSrc(filePath);
}

function familyForFontId(id: string, local: LocalFont[]): string | null {
  const builtin = BUILTIN_FONTS.find((font) => font.id === id);
  if (builtin) return builtin.family;
  return local.find((font) => font.id === id)?.family ?? null;
}

function composeFontStack(id: string, local: LocalFont[], fallback: string): string {
  const family = familyForFontId(id, local);
  return family ? `"${family}", ${fallback}` : fallback;
}

/** 界面字体栈：自定义字体排在最前，后面接系统与中文回退。 */
export function resolveUiFontStack(fonts: FontSettings): string {
  return composeFontStack(fonts.ui, fonts.local, DEFAULT_UI_FONT_STACK);
}

/** 代码字体栈：Markdown 代码块、Monaco 与终端共用。 */
export function resolveMonoFontStack(fonts: FontSettings): string {
  return composeFontStack(fonts.mono, fonts.local, DEFAULT_MONO_FONT_STACK);
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

function normalizeLocalFonts(raw: unknown): LocalFont[] {
  if (!Array.isArray(raw)) return [];
  const fields = ["id", "name", "path", "family"] as const;
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const entry = item as Record<string, unknown>;
    if (!fields.every((key) => typeof entry[key] === "string" && entry[key])) return [];
    return [
      {
        id: entry.id as string,
        name: entry.name as string,
        path: entry.path as string,
        family: entry.family as string,
      },
    ];
  });
}

function normalizeFontSelection(value: unknown, local: LocalFont[]): string {
  if (typeof value !== "string" || !value) return "";
  const known =
    BUILTIN_FONTS.some((font) => font.id === value) ||
    local.some((font) => font.id === value);
  return known ? value : "";
}

export function normalizeFontSettings(raw: unknown): FontSettings {
  const input = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const local = normalizeLocalFonts(input.local);
  return {
    ui: normalizeFontSelection(input.ui, local),
    mono: normalizeFontSelection(input.mono, local),
    local,
  };
}

export function normalizeCustomAppearance(raw: unknown): CustomAppearanceSettings {
  if (!raw || typeof raw !== "object") return createDefaultCustomAppearance();
  const input = raw as Record<string, unknown>;
  return {
    wallpaper: normalizeWallpaper(input.wallpaper),
    surfaces: normalizeSurfaces(input.surfaces),
    messageWidth: normalizeMessageWidth(input.messageWidth),
    inputWidth: normalizeInputWidth(input.inputWidth),
    fonts: normalizeFontSettings(input.fonts),
  };
}
