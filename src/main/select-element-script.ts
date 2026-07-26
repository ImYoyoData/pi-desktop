import type { WebContents } from "electron";

export const SELECT_ELEMENT_CONSOLE_PREFIX = "__PI_ELEMENT__:";

/**
 * Injected into guest pages. Stores a compact selection on window and only
 * console.logs a tiny trigger — full outerHTML via console was truncating JSON
 * and dropping screenshots.
 */
export function buildSelectElementScript(): string {
  const prefix = SELECT_ELEMENT_CONSOLE_PREFIX;
  return `(function () {
    if (typeof window.__piSelectCleanup === "function") {
      window.__piSelectCleanup();
    }
    var STYLE_ID = "pi-select-highlight-style";
    var style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent =
        ".pi-select-hover-outline { outline: 2px solid #2563eb !important; outline-offset: 2px !important; cursor: crosshair !important; }";
      document.documentElement.appendChild(style);
    }
    var hovered = null;
    function cssPath(el) {
      if (!el || el.nodeType !== 1) return "";
      if (el.id) return "#" + CSS.escape(el.id);
      var parts = [];
      while (el && el.nodeType === 1 && el !== document.documentElement) {
        var part = el.tagName.toLowerCase();
        if (el.className && typeof el.className === "string") {
          var cls = el.className.trim().split(/\\s+/).filter(Boolean).slice(0, 2);
          for (var i = 0; i < cls.length; i++) {
            part += "." + CSS.escape(cls[i]);
          }
        }
        var parent = el.parentElement;
        if (parent) {
          var siblings = Array.from(parent.children).filter(function (c) {
            return c.tagName === el.tagName;
          });
          if (siblings.length > 1) {
            part += ":nth-of-type(" + (siblings.indexOf(el) + 1) + ")";
          }
        }
        parts.unshift(part);
        el = parent;
      }
      return parts.join(" > ");
    }
    function visibleText(el) {
      var t = (el.innerText || el.textContent || "").trim();
      return t.length > 500 ? t.slice(0, 500) + "…" : t;
    }
    function onOver(e) {
      var t = e.target;
      if (!(t instanceof Element)) return;
      if (hovered && hovered !== t) hovered.classList.remove("pi-select-hover-outline");
      hovered = t;
      hovered.classList.add("pi-select-hover-outline");
    }
    function onClick(e) {
      e.preventDefault();
      e.stopPropagation();
      var t = e.target;
      if (!(t instanceof Element)) return;
      t.classList.remove("pi-select-hover-outline");
      if (hovered === t) hovered = null;
      var rect = t.getBoundingClientRect();
      var html = t.outerHTML || "";
      if (html.length > 4000) html = html.slice(0, 4000) + "<!-- truncated -->";
      window.__piPendingSelection = {
        url: location.href,
        selector: cssPath(t),
        text: visibleText(t),
        html: html,
        bounds: {
          x: Math.max(0, Math.floor(rect.left)),
          y: Math.max(0, Math.floor(rect.top)),
          width: Math.max(1, Math.ceil(rect.width)),
          height: Math.max(1, Math.ceil(rect.height)),
        },
        dpr: window.devicePixelRatio || 1,
        vw: window.innerWidth || 0,
        vh: window.innerHeight || 0,
      };
      console.log(${JSON.stringify(prefix)} + "ready");
    }
    document.addEventListener("mouseover", onOver, true);
    document.addEventListener("click", onClick, true);
    window.__piSelectCleanup = function () {
      document.removeEventListener("mouseover", onOver, true);
      document.removeEventListener("click", onClick, true);
      if (hovered) hovered.classList.remove("pi-select-hover-outline");
      hovered = null;
      var s = document.getElementById(STYLE_ID);
      if (s) s.remove();
      delete window.__piSelectCleanup;
    };
  })();`;
}

export function buildRemoveSelectScript(): string {
  return `(function () {
    if (typeof window.__piSelectCleanup === "function") {
      window.__piSelectCleanup();
    }
  })();`;
}

export function buildReadPendingSelectionScript(): string {
  return `(function () {
    var p = window.__piPendingSelection;
    window.__piPendingSelection = null;
    return p || null;
  })();`;
}

export async function injectSelectMode(webContents: WebContents): Promise<void> {
  await webContents.executeJavaScript(buildSelectElementScript(), true);
}

export async function removeSelectMode(webContents: WebContents): Promise<void> {
  try {
    await webContents.executeJavaScript(buildRemoveSelectScript(), true);
  } catch {
    // Page may have navigated away.
  }
}

export async function readPendingSelection(webContents: WebContents): Promise<{
  url: string;
  selector: string;
  text: string;
  html: string;
  bounds?: { x: number; y: number; width: number; height: number };
  dpr?: number;
  vw?: number;
  vh?: number;
} | null> {
  try {
    const result = await webContents.executeJavaScript(buildReadPendingSelectionScript(), true);
    if (!result || typeof result !== "object") return null;
    return result as {
      url: string;
      selector: string;
      text: string;
      html: string;
      bounds?: { x: number; y: number; width: number; height: number };
      dpr?: number;
      vw?: number;
      vh?: number;
    };
  } catch {
    return null;
  }
}
