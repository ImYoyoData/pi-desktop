import { defineStore } from "pinia";
import { computed, nextTick, ref, watch } from "vue";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";
export type LocalePreference = "system" | "zh-CN" | "en";

const THEME_KEY = "pi-desktop:theme-preference";
const LOCALE_KEY = "pi-desktop:locale-preference";

type ViewTransitionLike = {
  finished: Promise<void>;
};

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

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * View Transitions need DOM updated before the snapshot. Vue's runtime build
 * (electron-vite) does not export `flushSync`, so await `nextTick` instead.
 */
function startThemeViewTransition(update: () => void): ViewTransitionLike | null {
  const doc = document as Document & {
    startViewTransition?: (cb: () => void | Promise<void>) => ViewTransitionLike;
  };
  if (!doc.startViewTransition || prefersReducedMotion()) return null;
  return doc.startViewTransition(async () => {
    update();
    await nextTick();
  });
}

export const useAppearanceStore = defineStore("appearance", () => {
  const themePreference = ref<ThemePreference>(readThemePreference());
  const localePreference = ref<LocalePreference>(readLocalePreference());
  const systemDark = ref(systemPrefersDark());

  const resolvedTheme = computed<ResolvedTheme>(() =>
    resolveTheme(themePreference.value, systemDark.value),
  );

  function applyDomTheme(mode: ResolvedTheme): void {
    const root = document.documentElement;
    root.dataset.theme = mode;
    root.style.colorScheme = mode;
  }

  function setThemePreference(next: ThemePreference): void {
    const before = resolvedTheme.value;
    const after = resolveTheme(next, systemDark.value);

    const commit = (): void => {
      themePreference.value = next;
      try {
        localStorage.setItem(THEME_KEY, next);
      } catch {
        // ignore
      }
      applyDomTheme(after);
      void window.api.window.setThemeSource(next);
      void window.api.window.setChromeTheme(after);
    };

    if (before === after) {
      commit();
      return;
    }

    const root = document.documentElement;
    root.classList.add("theme-transitioning");
    const transition = startThemeViewTransition(commit);
    if (!transition) {
      commit();
      root.classList.remove("theme-transitioning");
      return;
    }
    void transition.finished.finally(() => {
      root.classList.remove("theme-transitioning");
    });
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
      void window.api.window.setChromeTheme(after);
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
        // Manual toggles already apply inside the view transition; keep this as a
        // safety net for any other resolvedTheme changes.
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
