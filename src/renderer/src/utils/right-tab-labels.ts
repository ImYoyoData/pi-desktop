import { t } from "@renderer/i18n";
import type { RightTab, RightTabKind } from "@renderer/stores/right-tabs";

/** Fixed singleton tabs always use the active locale string. */
export function fixedKindLabel(kind: RightTabKind): string | null {
  switch (kind) {
    case "running":
      return t.runningTab;
    case "changes":
      return t.changesTab;
    case "files":
      return t.filesTab;
    case "browser":
    case "terminal":
    case "preview":
      return null;
    default: {
      const _never: never = kind;
      return _never;
    }
  }
}

function isDefaultBrowserLabel(label: string): boolean {
  const s = label.trim();
  if (s === "Browser" || s === "浏览器") return true;
  return /^(Browser|浏览器)\s+\d+$/u.test(s);
}

function isDefaultTerminalLabel(label: string): boolean {
  const s = label.trim();
  if (s === "Terminal" || s === "终端") return true;
  return /^(Terminal|终端)\s+\d+$/u.test(s);
}

function numberedDefaultLabel(
  kind: "browser" | "terminal",
  label: string,
): string {
  const m = label.trim().match(/(\d+)\s*$/u);
  const n = m ? Number(m[1]) : 1;
  if (kind === "browser") {
    return n <= 1 ? t.browser : t.browserLabel(n);
  }
  return n <= 1 ? t.terminal : t.terminalLabel(n);
}

/**
 * Display / persist label for the current UI locale.
 * User-renamed (labelLocked) and auto-titled tabs keep their stored text.
 */
export function localizedTabLabel(tab: RightTab): string {
  const fixed = fixedKindLabel(tab.kind);
  if (fixed) return fixed;
  if (tab.labelLocked) return tab.label;
  if (tab.kind === "browser" && isDefaultBrowserLabel(tab.label)) {
    return numberedDefaultLabel("browser", tab.label);
  }
  if (tab.kind === "terminal" && isDefaultTerminalLabel(tab.label)) {
    return numberedDefaultLabel("terminal", tab.label);
  }
  return tab.label;
}
