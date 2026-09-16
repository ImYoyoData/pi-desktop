import { defineStore } from "pinia";
import { computed, ref } from "vue";
import {
  applyUiLocale,
  detectSystemLanguage,
  resolveUiLocale,
  type UiLocale,
} from "@renderer/i18n";
import {
  CUSTOM_APPEARANCE_KEY,
  CUSTOM_APPEARANCE_LEGACY_KEY,
  VEIL_BLUR_MAX_PX,
  createDefaultCustomAppearance,
  normalizeCustomAppearance,
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
const COMPACT_BTN_KEY = "pi-desktop:show-compact-button";
const PANEL_DIVIDERS_KEY = "pi-desktop:panel-dividers";
const TRUNCATE_TOOL_OUTPUT_KEY = "pi-desktop:truncate-tool-output";

/** 工具输出预览的可选截断行数；0 表示不截断。 */
export const TRUNCATE_TOOL_OUTPUT_CHOICES = [0, 10, 24, 50, 100] as const;

const TRUNCATE_TOOL_OUTPUT_FALLBACK = 0;

function isTruncateToolOutputChoice(value: number): boolean {
  return (TRUNCATE_TOOL_OUTPUT_CHOICES as readonly number[]).includes(value);
}

function readShowCompactButton(): boolean {
  try {
    return localStorage.getItem(COMPACT_BTN_KEY) === "1";
  } catch {
    return false;
  }
}

function readPanelDividers(): boolean {
  try {
    return localStorage.getItem(PANEL_DIVIDERS_KEY) !== "0";
  } catch {
    return true;
  }
}

function readTruncateToolOutputLines(): number {
  try {
    const raw = localStorage.getItem(TRUNCATE_TOOL_OUTPUT_KEY);
    if (raw === "1") return 24; // 旧版开关：开启时按 24 行截断
    const value = Number(raw);
    return isTruncateToolOutputChoice(value) ? value : TRUNCATE_TOOL_OUTPUT_FALLBACK;
  } catch {
    return TRUNCATE_TOOL_OUTPUT_FALLBACK;
  }
}

function readCustomAppearance(): CustomAppearanceSettings {
  try {
    const current = localStorage.getItem(CUSTOM_APPEARANCE_KEY);
    const raw = current ?? localStorage.getItem(CUSTOM_APPEARANCE_LEGACY_KEY);
    if (!raw) return createDefaultCustomAppearance();
    const parsed = normalizeCustomAppearance(JSON.parse(raw));
    // 从 v1 迁移：保留用户已调好的值，补全后才写回新键，避免每次启动重新迁移
    if (!current) {
      try {
        localStorage.setItem(CUSTOM_APPEARANCE_KEY, JSON.stringify(parsed));
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
    const raw = localStorage.getItem(THEME_KEY);
    if (raw === "light" || raw === "dark" || raw === "system") return raw;
  } catch {
    // ignore
  }
  return "system";
}

function readLocalePreference(): LocalePreference {
  try {
    const raw = localStorage.getItem(LOCALE_KEY);
    if (raw === "zh-CN" || raw === "en" || raw === "system") return raw;
  } catch {
    // ignore
  }
  return "system";
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

export const useAppearanceStore = defineStore("appearance", () => {
  const themePreference = ref<ThemePreference>(readThemePreference());
  const localePreference = ref<LocalePreference>(readLocalePreference());
  const systemDark = ref(systemPrefersDark());
  const showCompactButton = ref(readShowCompactButton());
  const showPanelDividers = ref(readPanelDividers());
  const truncateToolOutputLines = ref(readTruncateToolOutputLines());
  const customAppearance = ref<CustomAppearanceSettings>(readCustomAppearance());
  const wallpaperBroken = ref(false);

  const wallpaper = computed(() => customAppearance.value.wallpaper);
  const surfaces = computed(() => customAppearance.value.surfaces);
  const messageWidth = computed(() => customAppearance.value.messageWidth);

  /** 壁纸生效时界面固定为深色玻璃：底色、文字、naive-ui 与编辑器一起走暗色。 */
  const glassSurface = computed(
    () => customAppearance.value.wallpaper.kind !== "none" && !wallpaperBroken.value,
  );

  const resolvedTheme = computed<ResolvedTheme>(() =>
    glassSurface.value ? "dark" : resolveTheme(themePreference.value, systemDark.value),
  );

  /** 当前生效的界面语言（system 偏好跟随系统语言）。 */
  const resolvedUiLocale = computed<UiLocale>(() =>
    localePreference.value === "system"
      ? resolveUiLocale(detectSystemLanguage())
      : localePreference.value,
  );

  function setThemePreference(next: ThemePreference): void {
    themePreference.value = next;
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // ignore
    }
    applyDomTheme(resolvedTheme.value);
    scheduleChromeSync(next, resolvedTheme.value);
  }

  function setLocalePreference(next: LocalePreference): void {
    localePreference.value = next;
    try {
      localStorage.setItem(LOCALE_KEY, next);
    } catch {
      // ignore
    }
    applyUiLocale(resolvedUiLocale.value);
    void window.api.window.setUiLocale(resolvedUiLocale.value);
  }

  function setShowCompactButton(next: boolean): void {
    showCompactButton.value = next;
    try {
      localStorage.setItem(COMPACT_BTN_KEY, next ? "1" : "0");
    } catch {
      // ignore
    }
  }

  function setShowPanelDividers(next: boolean): void {
    showPanelDividers.value = next;
    try {
      localStorage.setItem(PANEL_DIVIDERS_KEY, next ? "1" : "0");
    } catch {
      // ignore
    }
  }

  function setTruncateToolOutputLines(next: number): void {
    const value = isTruncateToolOutputChoice(next) ? next : TRUNCATE_TOOL_OUTPUT_FALLBACK;
    truncateToolOutputLines.value = value;
    try {
      localStorage.setItem(TRUNCATE_TOOL_OUTPUT_KEY, String(value));
    } catch {
      // ignore
    }
  }

  /** 壁纸开合会切换整套配色，玻璃相关的 DOM 变量与暗色文字一起刷新。 */
  function syncGlassShell(): void {
    applyCustomAppearance(customAppearance.value, wallpaperBroken.value);
    applyDomTheme(resolvedTheme.value);
    scheduleChromeSync(themePreference.value, resolvedTheme.value);
  }

  function persistCustom(next: CustomAppearanceSettings): void {
    customAppearance.value = next;
    try {
      localStorage.setItem(CUSTOM_APPEARANCE_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
    syncGlassShell();
  }

  function updateWallpaper(patch: Partial<WallpaperSettings>): void {
    if ("kind" in patch || "path" in patch) wallpaperBroken.value = false;
    persistCustom({
      ...customAppearance.value,
      wallpaper: { ...customAppearance.value.wallpaper, ...patch },
    });
  }

  /** 壁纸文件缺失或无法解码：保持设置但暂时恢复不透明界面。 */
  function setWallpaperBroken(broken: boolean): void {
    if (wallpaperBroken.value === broken) return;
    wallpaperBroken.value = broken;
    syncGlassShell();
  }

  function setWallpaperFile(path: string): void {
    const kind = wallpaperKindForPath(path);
    if (!kind) return;
    updateWallpaper({ kind, path });
  }

  function clearWallpaper(): void {
    updateWallpaper({ kind: "none", path: "" });
  }

  function setVeilOpacity(value: number): void {
    updateWallpaper({ veilOpacity: clampAlpha(value) });
  }

  function setVeilBlur(value: number): void {
    updateWallpaper({ veilBlur: clampAlpha(value) });
  }

  function setSurfaceAlpha(key: SurfaceAlphaKey, value: number): void {
    persistCustom({
      ...customAppearance.value,
      surfaces: { ...customAppearance.value.surfaces, [key]: clampAlpha(value) },
    });
  }

  function setMessageWidth(value: number): void {
    persistCustom({ ...customAppearance.value, messageWidth: normalizeMessageWidth(value) });
  }

  function syncSystemListener(): () => void {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const before = resolvedTheme.value;
      systemDark.value = mq.matches;
      if (themePreference.value !== "system") return;
      if (before === resolvedTheme.value) return;
      applyDomTheme(resolvedTheme.value);
      scheduleChromeSync("system", resolvedTheme.value);
    };
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }

  function init(): () => void {
    syncGlassShell();
    return syncSystemListener();
  }

  return {
    themePreference,
    localePreference,
    resolvedUiLocale,
    resolvedTheme,
    showCompactButton,
    showPanelDividers,
    truncateToolOutputLines,
    wallpaper,
    surfaces,
    messageWidth,
    wallpaperBroken,
    setThemePreference,
    setLocalePreference,
    setShowCompactButton,
    setShowPanelDividers,
    setTruncateToolOutputLines,
    setWallpaperFile,
    clearWallpaper,
    setVeilOpacity,
    setVeilBlur,
    setSurfaceAlpha,
    setMessageWidth,
    setWallpaperBroken,
    init,
  };
});
