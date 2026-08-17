/**
 * Swap highlight.js stylesheet for light/dark. Both themes use the same
 * `.hljs` selectors, so only one sheet may be active at a time.
 */
const LINK_ID = "pi-hljs-theme";

export type HljsThemeMode = "light" | "dark";

export function hljsThemeId(mode: HljsThemeMode): "github" | "github-dark" {
  return mode === "dark" ? "github-dark" : "github";
}

async function loadThemeCss(mode: HljsThemeMode): Promise<string> {
  if (mode === "dark") {
    const mod = await import("highlight.js/styles/github-dark.css?inline");
    return typeof mod.default === "string" ? mod.default : String(mod.default ?? "");
  }
  const mod = await import("highlight.js/styles/github.css?inline");
  return typeof mod.default === "string" ? mod.default : String(mod.default ?? "");
}

/** Apply (or swap) the highlight.js theme into document head. */
export async function applyHljsTheme(mode: HljsThemeMode): Promise<void> {
  if (typeof document === "undefined") return;
  const css = await loadThemeCss(mode);
  if (!css) return;

  let el = document.getElementById(LINK_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = LINK_ID;
    document.head.appendChild(el);
  }
  const themeId = hljsThemeId(mode);
  if (el.dataset.hljsTheme === themeId && el.textContent === css) return;
  el.dataset.hljsTheme = themeId;
  el.textContent = css;
}
