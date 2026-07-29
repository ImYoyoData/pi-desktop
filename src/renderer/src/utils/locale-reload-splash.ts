/** Session flag: language switch is reloading the renderer. */
export const LOCALE_RELOAD_KEY = "pi-desktop:locale-reloading";

const SPLASH_ID = "locale-reload-splash";

type SplashLocale = "zh-CN" | "en";

function resolveSplashLocale(raw: string | null): SplashLocale {
  if (raw === "zh-CN" || raw === "en") return raw;
  try {
    const nav = navigator.language || "";
    if (/^zh\b/i.test(nav)) return "zh-CN";
  } catch {
    // ignore
  }
  return "en";
}

function splashCopy(locale: SplashLocale): { title: string; detail: string } {
  if (locale === "zh-CN") {
    return { title: "正在切换语言…", detail: "界面即将就绪" };
  }
  return { title: "Switching language…", detail: "Almost ready" };
}

function ensureSplashStyles(): void {
  if (document.getElementById(`${SPLASH_ID}-style`)) return;
  const style = document.createElement("style");
  style.id = `${SPLASH_ID}-style`;
  style.textContent = `
#${SPLASH_ID} {
  position: fixed;
  inset: 0;
  z-index: 2147483646;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  margin: 0;
  padding: 24px;
  box-sizing: border-box;
  background: var(--bg, #f6f7f9);
  color: var(--fg, #1f2328);
  font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
  -webkit-app-region: no-drag;
  transition: opacity 0.22s ease, visibility 0.22s ease;
}
html[data-theme="dark"] #${SPLASH_ID} {
  background: var(--bg, #121417);
  color: var(--fg, #e8eaed);
}
#${SPLASH_ID}.is-leaving {
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
}
#${SPLASH_ID} .locale-reload-spinner {
  width: 28px;
  height: 28px;
  border: 2.5px solid color-mix(in srgb, currentColor 22%, transparent);
  border-top-color: currentColor;
  border-radius: 50%;
  animation: locale-reload-spin 0.7s linear infinite;
}
#${SPLASH_ID} .locale-reload-title {
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.01em;
}
#${SPLASH_ID} .locale-reload-detail {
  font-size: 12px;
  opacity: 0.62;
}
@keyframes locale-reload-spin {
  to { transform: rotate(360deg); }
}
`;
  document.head.appendChild(style);
}

/** Show full-window language-switch overlay (before reload or on boot). */
export function showLocaleReloadSplash(preference?: string | null): void {
  if (typeof document === "undefined") return;
  ensureSplashStyles();
  const locale = resolveSplashLocale(
    preference ??
      (() => {
        try {
          return sessionStorage.getItem(LOCALE_RELOAD_KEY);
        } catch {
          return null;
        }
      })(),
  );
  const copy = splashCopy(locale);
  let root = document.getElementById(SPLASH_ID);
  if (!root) {
    root = document.createElement("div");
    root.id = SPLASH_ID;
    root.setAttribute("role", "status");
    root.setAttribute("aria-live", "polite");
    (document.body ?? document.documentElement).appendChild(root);
  }
  root.classList.remove("is-leaving");
  root.innerHTML = `
    <div class="locale-reload-spinner" aria-hidden="true"></div>
    <div class="locale-reload-title">${copy.title}</div>
    <div class="locale-reload-detail">${copy.detail}</div>
  `;
}

export function isLocaleReloading(): boolean {
  try {
    return Boolean(sessionStorage.getItem(LOCALE_RELOAD_KEY));
  } catch {
    return false;
  }
}

export function markLocaleReloading(preference: string): void {
  try {
    sessionStorage.setItem(LOCALE_RELOAD_KEY, preference);
  } catch {
    // ignore
  }
}

/** Fade out and remove splash after the new locale UI is ready. */
export async function dismissLocaleReloadSplash(): Promise<void> {
  if (!isLocaleReloading()) return;
  const root = document.getElementById(SPLASH_ID);
  // Keep overlay up briefly so the new locale UI can settle underneath.
  await new Promise((r) => setTimeout(r, 280));
  if (root) {
    root.classList.add("is-leaving");
    await new Promise((r) => setTimeout(r, 240));
    root.remove();
  }
  document.getElementById(`${SPLASH_ID}-style`)?.remove();
  try {
    sessionStorage.removeItem(LOCALE_RELOAD_KEY);
  } catch {
    // ignore
  }
}
