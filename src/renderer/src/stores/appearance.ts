import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";

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

export const useAppearanceStore = defineStore("appearance", () => {
  const themePreference = ref<ThemePreference>(readThemePreference());
  const localePreference = ref<LocalePreference>(readLocalePreference());
  const systemDark = ref(systemPrefersDark());

  const resolvedTheme = computed<ResolvedTheme>(() => {
    if (themePreference.value === "system") {
      return systemDark.value ? "dark" : "light";
    }
    return themePreference.value;
  });

  function applyDomTheme(mode: ResolvedTheme): void {
    const root = document.documentElement;
    root.dataset.theme = mode;
    root.style.colorScheme = mode;
  }

  function setThemePreference(next: ThemePreference): void {
    themePreference.value = next;
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // ignore
    }
    void window.api.window.setThemeSource(next);
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
      systemDark.value = mq.matches;
    };
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }

  function init(): () => void {
    applyDomTheme(resolvedTheme.value);
    void window.api.window.setThemeSource(themePreference.value);
    void window.api.window.setChromeTheme(resolvedTheme.value);
    const stopMq = syncSystemListener();
    const stopWatch = watch(
      resolvedTheme,
      (mode) => {
        applyDomTheme(mode);
        void window.api.window.setChromeTheme(mode);
      },
      { immediate: true },
    );
    return () => {
      stopMq();
      stopWatch();
    };
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
