import { defineStore } from "pinia";
import { computed, ref } from "vue";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";
export type LocalePreference = "system" | "zh-CN" | "en";

const THEME_KEY = "pi-desktop:theme-preference";
const LOCALE_KEY = "pi-desktop:locale-preference";

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

  const resolvedTheme = computed<ResolvedTheme>(() =>
    resolveTheme(themePreference.value, systemDark.value),
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
    void window.api.window.setThemeSource(themePreference.value);
    void window.api.window.setChromeTheme(resolvedTheme.value);
    return syncSystemListener();
  }

  return {
    themePreference,
    localePreference,
    resolvedTheme,
    setThemePreference,
    setLocalePreference,
    init,
  };
});
