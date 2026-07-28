import type { WebContents } from "electron";
import type { EditMenuLocale } from "../shared/edit-menu-i18n";

export const SELECT_ELEMENT_CONSOLE_PREFIX = "__PI_ELEMENT__:";

const SELECT_ELEMENT_COPY: Record<
  EditMenuLocale,
  { tipAction: string; regionPrefix: string }
> = {
  "zh-CN": {
    tipAction: "点击选择，拖拽框选",
    regionPrefix: "区域",
  },
  en: {
    tipAction: "Click to select, drag to draw",
    regionPrefix: "Region",
  },
};

/**
 * Injected into guest pages. Stores a compact selection on window and only
 * console.logs a tiny trigger — full outerHTML via console was truncating JSON
 * and dropping screenshots.
 *
 * Interaction (Cursor-like):
 * - Hover = HTML element highlight box + tip (tag / class)
 * - Click = pick DOM element + bounds screenshot
 * - Click-drag past threshold = region marquee → bounds screenshot
 * - Escape = cancel
 */
export function buildSelectElementScript(locale: EditMenuLocale = "en"): string {
  const copy = SELECT_ELEMENT_COPY[locale] ?? SELECT_ELEMENT_COPY.en;
  const tipActionJson = JSON.stringify(copy.tipAction);
  const regionPrefixJson = JSON.stringify(copy.regionPrefix);
  const prefix = SELECT_ELEMENT_CONSOLE_PREFIX;
  return `(function () {
    if (typeof window.__piSelectCleanup === "function") {
      window.__piSelectCleanup();
    }
    var STYLE_ID = "pi-select-highlight-style";
    var HOVER_ID = "pi-select-hover-box";
    var TIP_ID = "pi-select-hover-tip";
    var BOX_ID = "pi-select-region-box";
    var MASK_ID = "pi-select-region-mask";
    var DRAG_THRESHOLD = 6;
    var TIP_ACTION = ${tipActionJson};
    var REGION_PREFIX = ${regionPrefixJson};
    var style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent =
        "html.pi-select-mode, html.pi-select-mode * { cursor: crosshair !important; }" +
        "#" + HOVER_ID + " {" +
        " position: fixed; z-index: 2147483645; pointer-events: none; display: none;" +
        " box-sizing: border-box; border: 2px solid #3b82f6;" +
        " background: rgba(59,130,246,0.08);" +
        " border-radius: 2px;" +
        " box-shadow: 0 0 0 1px rgba(255,255,255,0.35) inset;" +
        "}" +
        "#" + TIP_ID + " {" +
        " position: fixed; z-index: 2147483647; pointer-events: none; display: none;" +
        " max-width: min(320px, calc(100vw - 16px));" +
        " padding: 6px 10px; border-radius: 10px;" +
        " background: #2563eb; color: #fff;" +
        " font: 600 12px/1.35 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;" +
        " box-shadow: 0 6px 20px rgba(37,99,235,0.35);" +
        " white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" +
        "}" +
        "#" + TIP_ID + " .pi-tip-line2 {" +
        " display: block; margin-top: 2px; font-weight: 500; opacity: 0.92; font-size: 11px;" +
        "}" +
        "#" + BOX_ID + " {" +
        " position: fixed; z-index: 2147483646; pointer-events: none;" +
        " border: 2px solid #2563eb; background: rgba(37,99,235,0.18);" +
        " box-shadow: 0 0 0 1px rgba(255,255,255,0.55) inset; display: none;" +
        "}" +
        "#" + MASK_ID + " {" +
        " position: fixed; inset: 0; z-index: 2147483644; pointer-events: none;" +
        " display: none; background: rgba(15,23,42,0.06);" +
        "}";
      document.documentElement.appendChild(style);
    }
    document.documentElement.classList.add("pi-select-mode");

    var hovered = null;
    var dragging = false;
    var regionMode = false;
    var startX = 0;
    var startY = 0;
    var startTarget = null;

    function ensure(id) {
      var el = document.getElementById(id);
      if (!el) {
        el = document.createElement("div");
        el.id = id;
        document.documentElement.appendChild(el);
      }
      return el;
    }
    var hoverBox = ensure(HOVER_ID);
    var tip = ensure(TIP_ID);
    tip.innerHTML = '<span class="pi-tip-main"></span><span class="pi-tip-line2"></span>';
    var tipMain = tip.querySelector(".pi-tip-main");
    var tipSub = tip.querySelector(".pi-tip-line2");
    var box = ensure(BOX_ID);
    var mask = ensure(MASK_ID);

    function isChrome(el) {
      return (
        !el ||
        el === hoverBox ||
        el === tip ||
        el === box ||
        el === mask ||
        el.id === STYLE_ID ||
        el === document.documentElement ||
        el === document.body
      );
    }
    function pickTarget(raw) {
      var t = raw;
      if (!(t instanceof Element)) return null;
      while (t && t !== document.documentElement) {
        if (isChrome(t)) return null;
        // Prefer the element under the cursor (not always the deepest text node parent only).
        if (t.nodeType === 1) return t;
        t = t.parentElement;
      }
      return null;
    }
    function describeEl(el) {
      var tag = (el.tagName || "").toLowerCase() || "element";
      var cls = "";
      if (el.className && typeof el.className === "string") {
        cls = el.className.trim().split(/\\s+/).filter(Boolean)[0] || "";
      } else if (el.classList && el.classList.length) {
        cls = el.classList.item(0) || "";
      }
      if (cls) return cls + " · " + tag;
      if (el.id) return "#" + el.id + " · " + tag;
      return tag;
    }
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
    function hideHover() {
      hovered = null;
      hoverBox.style.display = "none";
      tip.style.display = "none";
    }
    function showHover(el) {
      if (!el || isChrome(el)) {
        hideHover();
        return;
      }
      hovered = el;
      var r = el.getBoundingClientRect();
      if (r.width < 1 && r.height < 1) {
        hideHover();
        return;
      }
      hoverBox.style.display = "block";
      hoverBox.style.left = Math.max(0, r.left) + "px";
      hoverBox.style.top = Math.max(0, r.top) + "px";
      hoverBox.style.width = Math.max(1, r.width) + "px";
      hoverBox.style.height = Math.max(1, r.height) + "px";

      tipMain.textContent = describeEl(el);
      tipSub.textContent = TIP_ACTION;
      tip.style.display = "block";
      // Anchor to bottom-left of the hover box (Cursor-style overlap).
      var tw = tip.offsetWidth || 160;
      var th = tip.offsetHeight || 40;
      var left = Math.max(0, r.left);
      var top = Math.max(0, r.top) + Math.max(1, r.height) - Math.min(th * 0.35, 14);
      if (top + th > window.innerHeight - 4) {
        top = Math.max(4, Math.max(0, r.top) - th + 8);
      }
      if (left + tw > window.innerWidth - 4) {
        left = Math.max(4, window.innerWidth - tw - 4);
      }
      if (left < 4) left = 4;
      tip.style.left = left + "px";
      tip.style.top = top + "px";
    }
    function hideChrome() {
      hideHover();
      if (box) box.style.display = "none";
      if (mask) mask.style.display = "none";
    }
    function normRect(x0, y0, x1, y1) {
      var left = Math.min(x0, x1);
      var top = Math.min(y0, y1);
      var right = Math.max(x0, x1);
      var bottom = Math.max(y0, y1);
      var vw = window.innerWidth || 0;
      var vh = window.innerHeight || 0;
      left = Math.max(0, Math.min(left, vw));
      top = Math.max(0, Math.min(top, vh));
      right = Math.max(0, Math.min(right, vw));
      bottom = Math.max(0, Math.min(bottom, vh));
      return {
        x: Math.floor(left),
        y: Math.floor(top),
        width: Math.max(1, Math.ceil(right - left)),
        height: Math.max(1, Math.ceil(bottom - top)),
      };
    }
    function updateBox(x0, y0, x1, y1) {
      var r = normRect(x0, y0, x1, y1);
      box.style.display = "block";
      mask.style.display = "block";
      box.style.left = r.x + "px";
      box.style.top = r.y + "px";
      box.style.width = r.width + "px";
      box.style.height = r.height + "px";
      return r;
    }
    function emitPending(payload) {
      hideChrome();
      window.__piPendingSelection = payload;
      console.log(${JSON.stringify(prefix)} + "ready");
    }
    function emitElement(el) {
      el = pickTarget(el);
      if (!el) return;
      var rect = el.getBoundingClientRect();
      var html = el.outerHTML || "";
      if (html.length > 4000) html = html.slice(0, 4000) + "<!-- truncated -->";
      emitPending({
        kind: "element",
        url: location.href,
        selector: cssPath(el),
        text: visibleText(el),
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
      });
    }
    function emitRegion(r) {
      if (!r || r.width < 2 || r.height < 2) return;
      emitPending({
        kind: "region",
        url: location.href,
        selector: "[region]",
        text: REGION_PREFIX + " " + r.width + "×" + r.height,
        html: "",
        bounds: r,
        dpr: window.devicePixelRatio || 1,
        vw: window.innerWidth || 0,
        vh: window.innerHeight || 0,
      });
    }
    function onMoveHover(e) {
      if (dragging || regionMode) return;
      var t = document.elementFromPoint(e.clientX, e.clientY);
      var el = pickTarget(t);
      if (el === hovered) {
        if (el) showHover(el);
        return;
      }
      showHover(el);
    }
    function onDown(e) {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      dragging = true;
      regionMode = false;
      startX = e.clientX;
      startY = e.clientY;
      startTarget = pickTarget(e.target) || pickTarget(document.elementFromPoint(e.clientX, e.clientY));
    }
    function onMove(e) {
      if (!dragging) {
        onMoveHover(e);
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      var dx = e.clientX - startX;
      var dy = e.clientY - startY;
      if (!regionMode && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
        regionMode = true;
        hideHover();
      }
      if (regionMode) updateBox(startX, startY, e.clientX, e.clientY);
    }
    function onUp(e) {
      if (!dragging) return;
      e.preventDefault();
      e.stopPropagation();
      dragging = false;
      if (regionMode) {
        var r = updateBox(startX, startY, e.clientX, e.clientY);
        regionMode = false;
        emitRegion(r);
        return;
      }
      regionMode = false;
      hideChrome();
      var el = startTarget;
      if (!el) el = pickTarget(document.elementFromPoint(e.clientX, e.clientY));
      startTarget = null;
      emitElement(el);
    }
    function onClick(e) {
      e.preventDefault();
      e.stopPropagation();
    }
    function onScroll() {
      if (hovered && !dragging && !regionMode) showHover(hovered);
    }
    function onKey(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        dragging = false;
        regionMode = false;
        hideChrome();
        console.log(${JSON.stringify(prefix)} + "cancel");
      }
    }
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("mouseup", onUp, true);
    document.addEventListener("click", onClick, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll, true);
    window.addEventListener("keydown", onKey, true);
    window.__piSelectCleanup = function () {
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("mouseup", onUp, true);
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll, true);
      window.removeEventListener("keydown", onKey, true);
      hideChrome();
      document.documentElement.classList.remove("pi-select-mode");
      var s = document.getElementById(STYLE_ID);
      if (s) s.remove();
      var ids = [HOVER_ID, TIP_ID, BOX_ID, MASK_ID];
      for (var i = 0; i < ids.length; i++) {
        var n = document.getElementById(ids[i]);
        if (n) n.remove();
      }
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

export async function injectSelectMode(
  webContents: WebContents,
  locale: EditMenuLocale = "en",
): Promise<void> {
  await webContents.executeJavaScript(buildSelectElementScript(locale), true);
}

export async function removeSelectMode(webContents: WebContents): Promise<void> {
  try {
    await webContents.executeJavaScript(buildRemoveSelectScript(), true);
  } catch {
    // Page may have navigated away.
  }
}

export type PendingSelection = {
  kind?: "element" | "region";
  url: string;
  selector: string;
  text: string;
  html: string;
  bounds?: { x: number; y: number; width: number; height: number };
  dpr?: number;
  vw?: number;
  vh?: number;
};

export async function readPendingSelection(webContents: WebContents): Promise<PendingSelection | null> {
  try {
    const result = await webContents.executeJavaScript(buildReadPendingSelectionScript(), true);
    if (!result || typeof result !== "object") return null;
    return result as PendingSelection;
  } catch {
    return null;
  }
}
