import { create } from "zustand";
import * as prefs from "@renderer/utils/prefs";
import {
  applyUiLocale,
  detectSystemLanguage,
  resolveUiLocale,
  type UiLocale,
} from "@renderer/i18n";
import {
  CUSTOM_APPEARANCE_KEY,
  CUSTOM_APPEARANCE_LEGACY_KEY,
  FONT_SIZE_CHOICES,
  FONT_SIZE_DEFAULT,
  VEIL_BLUR_MAX_PX,
  createDefaultCustomAppearance,
  normalizeCustomAppearance,
  normalizeFontSize,
  normalizeMessageWidth,
  wallpaperKindForPath,
  type CustomAppearanceSettings,
  type SurfaceAlphaSettings,
  type WallpaperSettings,
} from "../../../shared/appearance";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";
export type LocalePreference = "system" | "zh-CN" | "en";
export type SurfaceAlphaKey = keyof SurfaceAlphaSettings;

const THEME_KEY = "pi-desktop:theme-preference";
const LOCALE_KEY = "pi-desktop:locale-preference";
const FONT_SIZE_KEY = "pi-desktop:font-size";
const COMPACT_BTN_KEY = "pi-desktop:show-compact-button";
const SESSION_DETAILS_KEY = "pi-desktop:session-details";
const SESSION_TITLE_KEY = "pi-desktop:session-title";
/**
 * Whether tool calls (read / write / edit / bash …) start expanded while the turn
 * is streaming. Off → every card starts folded and the user opens what they want.
 */
const EXPAND_TOOL_CALLS_KEY = "pi-desktop:expand-tool-calls";

/** 外观相关的偏好键：任意一个被改，界面就要重新读取并应用。 */
export const APPEARANCE_KEYS = new Set([
	THEME_KEY,
	LOCALE_KEY,
	FONT_SIZE_KEY,
	COMPACT_BTN_KEY,
	SESSION_DETAILS_KEY,
	SESSION_TITLE_KEY,
	EXPAND_TOOL_CALLS_KEY,
	CUSTOM_APPEARANCE_KEY,
	CUSTOM_APPEARANCE_LEGACY_KEY,
]);

function readShowCompactButton(): boolean {
  try {
    return prefs.getItem(COMPACT_BTN_KEY) === "1";
  } catch {
    return false;
  }
}

function readSessionDetails(): boolean {
  try {
    return prefs.getItem(SESSION_DETAILS_KEY) !== "0";
  } catch {
    return true;
  }
}

function readSessionTitle(): boolean {
  try {
    return prefs.getItem(SESSION_TITLE_KEY) !== "0";
  } catch {
    return true;
  }
}

/** Default OFF: tool calls start folded, which keeps long turns scannable. */
function readExpandToolCalls(): boolean {
  try {
    return prefs.getItem(EXPAND_TOOL_CALLS_KEY) === "1";
  } catch {
    return false;
  }
}

function readCustomAppearance(): CustomAppearanceSettings {
  try {
    const current = prefs.getItem(CUSTOM_APPEARANCE_KEY);
    const raw = current ?? prefs.getItem(CUSTOM_APPEARANCE_LEGACY_KEY);
    if (!raw) return createDefaultCustomAppearance();
    const parsed = normalizeCustomAppearance(JSON.parse(raw));
    // 从 v1 迁移：保留用户已调好的值，补全后才写回新键，避免每次启动重新迁移
    if (!current) {
      try {
        prefs.setItem(CUSTOM_APPEARANCE_KEY, JSON.stringify(parsed));
      } catch {
        // ignore
      }
    }
    return parsed;
  } catch {
    return createDefaultCustomAppearance();
  }
}

/** 壁纸启用时界面改为深色玻璃，同时把滑杆值写进 CSS 变量。 */
function applyCustomAppearance(settings: CustomAppearanceSettings, broken: boolean): void {
  const root = document.documentElement;
  const { wallpaper, surfaces } = settings;
  if (wallpaper.kind === "none" || broken) {
    delete root.dataset.wallpaper;
  } else {
    root.dataset.wallpaper = "on";
  }
  root.style.setProperty("--pi-alpha-input", `${percent(surfaces.input)}%`);
  root.style.setProperty("--pi-alpha-card", `${percent(surfaces.card)}%`);
  root.style.setProperty("--pi-alpha-settings", `${percent(surfaces.settings)}%`);
  root.style.setProperty("--pi-alpha-tool", `${percent(surfaces.tool)}%`);
  root.style.setProperty("--pi-message-max", `${percent(settings.messageWidth)}%`);
  root.style.setProperty("--pi-veil-opacity", `${percent(wallpaper.veilOpacity)}%`);
  root.style.setProperty(
    "--pi-veil-blur",
    `${Math.round(wallpaper.veilBlur * VEIL_BLUR_MAX_PX)}px`,
  );
}

function percent(value: number): number {
  return Math.round(value * 100);
}

function clampAlpha(value: number): number {
  return Math.min(1, Math.max(0, Math.round(value * 100) / 100));
}

function readThemePreference(): ThemePreference {
  try {
    const raw = prefs.getItem(THEME_KEY);
    if (raw === "light" || raw === "dark" || raw === "system") return raw;
  } catch {
    // ignore
  }
  return "system";
}

function readLocalePreference(): LocalePreference {
  try {
    const raw = prefs.getItem(LOCALE_KEY);
    if (raw === "zh-CN" || raw === "en" || raw === "system") return raw;
  } catch {
    // ignore
  }
  return "system";
}

/** 界面字号档位（px）。 */
function readFontSize(): number {
  try {
    const raw = prefs.getItem(FONT_SIZE_KEY);
    if (raw === null) return FONT_SIZE_DEFAULT;
    return normalizeFontSize(raw);
  } catch {
    return FONT_SIZE_DEFAULT;
  }
}

function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function resolveTheme(pref: ThemePreference, sysDark: boolean): ResolvedTheme {
  if (pref === "system") return sysDark ? "dark" : "light";
  return pref;
}

/**
 * Instant theme apply — avoid Document.startViewTransition / full-tree
 * transition:none sweeps (they stall large Electron UIs with Monaco + chat).
 */
function applyDomTheme(mode: ResolvedTheme): void {
  const root = document.documentElement;
  root.dataset.theme = mode;
  root.style.colorScheme = mode;
}

function scheduleChromeSync(pref: ThemePreference, mode: ResolvedTheme): void {
  // Defer native chrome IPC so the CSS variable paint isn't blocked.
  requestAnimationFrame(() => {
    void window.api.window.setThemeSource(pref);
    void window.api.window.setChromeTheme(mode);
  });
}

/** 字号只改根元素 font-size，样式里的 rem 文字随之变化，图标与间距不动。 */
function applyFontSize(size: number): void {
  document.documentElement.style.fontSize = `${size}px`;
}

/** 已下线的开关：清掉历史遗留的偏好键。 */
function dropObsoletePrefs(): void {
  for (const key of [
    "pi-desktop:panel-dividers",
    "pi-desktop:message-preview",
    "pi-desktop:message-preview-image",
    "pi-desktop:session-hover-actions",
    "pi-desktop:show-privilege-level",
  ]) {
    try {
      prefs.removeItem(key);
    } catch {
      // ignore
    }
  }
}

type AppearanceBase = {
  themePreference: ThemePreference;
  localePreference: LocalePreference;
  /** 界面字号档位（px）。 */
  fontSize: number;
  systemDark: boolean;
  showCompactButton: boolean;
  showSessionDetails: boolean;
  showSessionTitle: boolean;
  expandToolCalls: boolean;
  customAppearance: CustomAppearanceSettings;
  wallpaperBroken: boolean;
};

type AppearanceDerived = {
  wallpaper: WallpaperSettings;
  surfaces: SurfaceAlphaSettings;
  messageWidth: number;
  glassSurface: boolean;
  resolvedTheme: ResolvedTheme;
  resolvedUiLocale: UiLocale;
};

export type AppearanceState = AppearanceBase &
  AppearanceDerived & {
    setThemePreference: (next: ThemePreference) => void;
    setLocalePreference: (next: LocalePreference) => void;
    setFontSize: (next: number) => void;
    /** 菜单缩放：在字号档位之间上/下一档。 */
    stepFontSize: (direction: 1 | -1) => void;
    setShowCompactButton: (next: boolean) => void;
    setShowSessionDetails: (next: boolean) => void;
    setShowSessionTitle: (next: boolean) => void;
    setExpandToolCalls: (next: boolean) => void;
    setWallpaperFile: (path: string) => void;
    clearWallpaper: () => void;
    setVeilOpacity: (value: number) => void;
    setVeilBlur: (value: number) => void;
    setSurfaceAlpha: (key: SurfaceAlphaKey, value: number) => void;
    setMessageWidth: (value: number) => void;
    setWallpaperBroken: (broken: boolean) => void;
    init: () => () => void;
    /** 重新读取偏好并应用（另一窗口改了外观时调用）。 */
    refreshFromPrefs: () => void;
  };

/** 派生值统一在这里算，写入 store 前调用，保证状态与派生量始终一致。 */
function derive(base: AppearanceBase): AppearanceDerived {
  const wallpaper = base.customAppearance.wallpaper;
  const surfaces = base.customAppearance.surfaces;
  const messageWidth = base.customAppearance.messageWidth;
  /** 壁纸生效时界面固定为深色玻璃：底色、文字、组件库与编辑器一起走暗色。 */
  const glassSurface = wallpaper.kind !== "none" && !base.wallpaperBroken;
  const resolvedTheme: ResolvedTheme = glassSurface
    ? "dark"
    : resolveTheme(base.themePreference, base.systemDark);
  /** 当前生效的界面语言（system 偏好跟随系统语言）。 */
  const resolvedUiLocale: UiLocale =
    base.localePreference === "system"
      ? resolveUiLocale(detectSystemLanguage())
      : base.localePreference;
  return {
    wallpaper,
    surfaces,
    messageWidth,
    glassSurface,
    resolvedTheme,
    resolvedUiLocale,
  };
}

function initialBase(): AppearanceBase {
  return {
    themePreference: readThemePreference(),
    localePreference: readLocalePreference(),
    fontSize: readFontSize(),
    systemDark: systemPrefersDark(),
    showCompactButton: readShowCompactButton(),
    showSessionDetails: readSessionDetails(),
    showSessionTitle: readSessionTitle(),
    expandToolCalls: readExpandToolCalls(),
    customAppearance: readCustomAppearance(),
    wallpaperBroken: false,
  };
}

export const useAppearanceStore = create<AppearanceState>()((set, get) => {
  /**
   * 写入基础字段并同步重算派生值。
   * zustand 的 set 是浅合并：只提交派生字段会让基础字段不生效，
   * 所以补丁必须和派生值一起返回。
   */
  function commit(patch: Partial<AppearanceBase>): void {
    set((state) => {
      const base = { ...state, ...patch };
      return { ...patch, ...derive(base) };
    });
  }

  /** 壁纸开合会切换整套配色，玻璃相关的 DOM 变量与暗色文字一起刷新。 */
  function syncGlassShell(): void {
    const state = get();
    applyCustomAppearance(state.customAppearance, state.wallpaperBroken);
    applyDomTheme(state.resolvedTheme);
    scheduleChromeSync(state.themePreference, state.resolvedTheme);
  }

  function persistCustom(next: CustomAppearanceSettings): void {
    commit({ customAppearance: next });
    try {
      prefs.setItem(CUSTOM_APPEARANCE_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
    syncGlassShell();
  }

  function updateWallpaper(patch: Partial<WallpaperSettings>): void {
    const state = get();
    if ("kind" in patch || "path" in patch) set({ wallpaperBroken: false });
    persistCustom({
      ...state.customAppearance,
      wallpaper: { ...state.customAppearance.wallpaper, ...patch },
    });
  }

  function syncSystemListener(): () => void {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const before = get().resolvedTheme;
      commit({ systemDark: mq.matches });
      const after = get().resolvedTheme;
      if (get().themePreference !== "system") return;
      if (before === after) return;
      applyDomTheme(after);
      scheduleChromeSync("system", after);
    };
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }

  const base = initialBase();
  // 首帧前就写入根字号，避免启动时先按默认字号绘制再跳变。
  applyFontSize(base.fontSize);

  return {
    ...base,
    ...derive(base),
    setThemePreference: (next) => {
      commit({ themePreference: next });
      try {
        prefs.setItem(THEME_KEY, next);
      } catch {
        // ignore
      }
      const state = get();
      applyDomTheme(state.resolvedTheme);
      scheduleChromeSync(next, state.resolvedTheme);
    },
    setLocalePreference: (next) => {
      commit({ localePreference: next });
      try {
        prefs.setItem(LOCALE_KEY, next);
      } catch {
        // ignore
      }
      const state = get();
      applyUiLocale(state.resolvedUiLocale);
      void window.api.window.setUiLocale(state.resolvedUiLocale);
    },
    setFontSize: (next) => {
      const size = normalizeFontSize(next);
      if (size === get().fontSize) return;
      commit({ fontSize: size });
      try {
        prefs.setItem(FONT_SIZE_KEY, String(size));
      } catch {
        // ignore
      }
      applyFontSize(size);
    },
    stepFontSize: (direction) => {
      const choices: readonly number[] = FONT_SIZE_CHOICES;
      const current = get().fontSize;
      const found = choices.findIndex((choice) => choice === current);
      const from = found < 0 ? choices.indexOf(FONT_SIZE_DEFAULT) : found;
      const next = choices[Math.min(choices.length - 1, Math.max(0, from + direction))];
      get().setFontSize(next);
    },
    setShowCompactButton: (next) => {
      set({ showCompactButton: next });
      try {
        prefs.setItem(COMPACT_BTN_KEY, next ? "1" : "0");
      } catch {
        // ignore
      }
    },
    setShowSessionDetails: (next) => {
      set({ showSessionDetails: next });
      try {
        prefs.setItem(SESSION_DETAILS_KEY, next ? "1" : "0");
      } catch {
        // ignore
      }
    },
    setShowSessionTitle: (next) => {
      set({ showSessionTitle: next });
      try {
        prefs.setItem(SESSION_TITLE_KEY, next ? "1" : "0");
      } catch {
        // ignore
      }
    },
    setExpandToolCalls: (next) => {
      set({ expandToolCalls: next });
      try {
        prefs.setItem(EXPAND_TOOL_CALLS_KEY, next ? "1" : "0");
      } catch {
        // ignore
      }
    },
    setWallpaperFile: (path) => {
      const kind = wallpaperKindForPath(path);
      if (!kind) return;
      updateWallpaper({ kind, path });
    },
    clearWallpaper: () => {
      updateWallpaper({ kind: "none", path: "" });
    },
    setVeilOpacity: (value) => {
      updateWallpaper({ veilOpacity: clampAlpha(value) });
    },
    setVeilBlur: (value) => {
      updateWallpaper({ veilBlur: clampAlpha(value) });
    },
    setSurfaceAlpha: (key, value) => {
      const state = get();
      persistCustom({
        ...state.customAppearance,
        surfaces: { ...state.customAppearance.surfaces, [key]: clampAlpha(value) },
      });
    },
    setMessageWidth: (value) => {
      const state = get();
      persistCustom({
        ...state.customAppearance,
        messageWidth: normalizeMessageWidth(value),
      });
    },
    setWallpaperBroken: (broken) => {
      if (get().wallpaperBroken === broken) return;
      commit({ wallpaperBroken: broken });
      syncGlassShell();
    },
    init: () => {
      syncGlassShell();
      applyFontSize(get().fontSize);
      dropObsoletePrefs();
      return syncSystemListener();
    },
    refreshFromPrefs: () => {
      const base = initialBase();
      commit(base);
      applyFontSize(base.fontSize);
      syncGlassShell();
      applyUiLocale(get().resolvedUiLocale);
    },
  };
});