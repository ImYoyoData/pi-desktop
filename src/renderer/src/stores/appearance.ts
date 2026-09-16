import { defineStore } from "pinia";
import { computed, ref } from "vue";
import {
  applyUiLocale,
  detectSystemLanguage,
  resolveUiLocale,
  type UiLocale,
} from "@renderer/i18n";
import {
  PRESET_NAME_MAX_LENGTH,
  VEIL_BLUR_MAX_PX,
  createDefaultCustomAppearance,
  newPresetId,
  normalizeCustomAppearance,
  normalizeHexColor,
  wallpaperKindForPath,
  type AppearancePreset,
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
const TRUNCATE_TOOL_OUTPUT_KEY = "pi-desktop:truncate-tool-output";
const CUSTOM_APPEARANCE_KEY = "pi-desktop:appearance-custom:v1";

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
    const raw = localStorage.getItem(CUSTOM_APPEARANCE_KEY);
    return raw ? normalizeCustomAppearance(JSON.parse(raw)) : createDefaultCustomAppearance();
  } catch {
    return createDefaultCustomAppearance();
  }
}

/** 壁纸启用时界面改为半透明，同时把滑杆值写进 CSS 变量。 */
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
  const truncateToolOutputLines = ref(readTruncateToolOutputLines());
  const customAppearance = ref<CustomAppearanceSettings>(readCustomAppearance());
  const activePresetId = ref<string | null>(null);
  const wallpaperBroken = ref(false);

  const wallpaper = computed(() => customAppearance.value.wallpaper);
  const surfaces = computed(() => customAppearance.value.surfaces);
  const presets = computed(() => customAppearance.value.presets);

  const resolvedTheme = computed<ResolvedTheme>(() =>
    resolveTheme(themePreference.value, systemDark.value),
  );

  /** 当前生效的界面语言（system 偏好跟随系统语言）。 */
  const resolvedUiLocale = computed<UiLocale>(() =>
    localePreference.value === "system"
      ? resolveUiLocale(detectSystemLanguage())
      : localePreference.value,
  );

  function setThemePreference(next: ThemePreference): void {
    const after = resolveTheme(next, systemDark.value);
    themePreference.value = next;
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // ignore
    }
    applyDomTheme(after);
    scheduleChromeSync(next, after);
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

  function setTruncateToolOutputLines(next: number): void {
    const value = isTruncateToolOutputChoice(next) ? next : TRUNCATE_TOOL_OUTPUT_FALLBACK;
    truncateToolOutputLines.value = value;
    try {
      localStorage.setItem(TRUNCATE_TOOL_OUTPUT_KEY, String(value));
    } catch {
      // ignore
    }
  }

  function persistCustom(next: CustomAppearanceSettings): void {
    customAppearance.value = next;
    try {
      localStorage.setItem(CUSTOM_APPEARANCE_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
    applyCustomAppearance(next, wallpaperBroken.value);
  }

  /** 手动改外观后当前激活的预设不再等价，取消高亮。 */
  function commitCustom(next: CustomAppearanceSettings): void {
    activePresetId.value = null;
    persistCustom(next);
  }

  function updateWallpaper(patch: Partial<WallpaperSettings>): void {
    if ("kind" in patch || "path" in patch) wallpaperBroken.value = false;
    commitCustom({
      ...customAppearance.value,
      wallpaper: { ...customAppearance.value.wallpaper, ...patch },
    });
  }

  /** 壁纸文件缺失或无法解码：保持设置但暂时恢复不透明界面。 */
  function setWallpaperBroken(broken: boolean): void {
    if (wallpaperBroken.value === broken) return;
    wallpaperBroken.value = broken;
    applyCustomAppearance(customAppearance.value, broken);
  }

  function setWallpaperFile(path: string): void {
    const kind = wallpaperKindForPath(path);
    if (!kind) return;
    updateWallpaper({ kind, path });
  }

  function setWallpaperColor(color: string): void {
    const hex = normalizeHexColor(color);
    if (!hex) return;
    updateWallpaper({ kind: "color", color: hex });
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
    commitCustom({
      ...customAppearance.value,
      surfaces: { ...customAppearance.value.surfaces, [key]: clampAlpha(value) },
    });
  }

  function savePreset(name: string): void {
    const trimmed = name.trim().slice(0, PRESET_NAME_MAX_LENGTH);
    if (!trimmed) return;
    const preset: AppearancePreset = {
      id: newPresetId(),
      name: trimmed,
      wallpaper: { ...customAppearance.value.wallpaper },
      surfaces: { ...customAppearance.value.surfaces },
    };
    persistCustom({
      ...customAppearance.value,
      presets: [...customAppearance.value.presets, preset],
    });
    activePresetId.value = preset.id;
  }

  function applyPreset(id: string): void {
    const preset = customAppearance.value.presets.find((item) => item.id === id);
    if (!preset) return;
    wallpaperBroken.value = false;
    persistCustom({
      ...customAppearance.value,
      wallpaper: { ...preset.wallpaper },
      surfaces: { ...preset.surfaces },
    });
    activePresetId.value = id;
  }

  function removePreset(id: string): void {
    commitCustom({
      ...customAppearance.value,
      presets: customAppearance.value.presets.filter((item) => item.id !== id),
    });
  }

  function syncSystemListener(): () => void {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const before = resolvedTheme.value;
      systemDark.value = mq.matches;
      if (themePreference.value !== "system") return;
      const after = resolveTheme("system", systemDark.value);
      if (before === after) return;
      applyDomTheme(after);
      scheduleChromeSync("system", after);
    };
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }

  function init(): () => void {
    applyDomTheme(resolvedTheme.value);
    applyCustomAppearance(customAppearance.value, false);
    void window.api.window.setThemeSource(themePreference.value);
    void window.api.window.setChromeTheme(resolvedTheme.value);
    return syncSystemListener();
  }

  return {
    themePreference,
    localePreference,
    resolvedUiLocale,
    resolvedTheme,
    showCompactButton,
    truncateToolOutputLines,
    wallpaper,
    surfaces,
    presets,
    activePresetId,
    wallpaperBroken,
    setThemePreference,
    setLocalePreference,
    setShowCompactButton,
    setTruncateToolOutputLines,
    setWallpaperFile,
    setWallpaperColor,
    clearWallpaper,
    setVeilOpacity,
    setVeilBlur,
    setSurfaceAlpha,
    setWallpaperBroken,
    savePreset,
    applyPreset,
    removePreset,
    init,
  };
});
