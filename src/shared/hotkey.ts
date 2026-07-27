/** Default ASR wake chord (Electron accelerator). */
export const DEFAULT_ASR_WAKE_HOTKEY = "Control+Alt+Y";

const MODIFIER_CODES = new Set([
  "ControlLeft",
  "ControlRight",
  "AltLeft",
  "AltRight",
  "ShiftLeft",
  "ShiftRight",
  "MetaLeft",
  "MetaRight",
]);

/** Map KeyboardEvent.code → Electron accelerator key token. */
function codeToAccelKey(e: KeyboardEvent): string | null {
  const code = e.code;
  if (MODIFIER_CODES.has(code)) return null;

  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^Numpad[0-9]$/.test(code)) return `num${code.slice(6)}`;
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;

  switch (code) {
    case "Space":
      return "Space";
    case "Tab":
      return "Tab";
    case "Backspace":
      return "Backspace";
    case "Delete":
      return "Delete";
    case "Insert":
      return "Insert";
    case "Enter":
    case "NumpadEnter":
      return "Return";
    case "Escape":
      return "Escape";
    case "ArrowUp":
      return "Up";
    case "ArrowDown":
      return "Down";
    case "ArrowLeft":
      return "Left";
    case "ArrowRight":
      return "Right";
    case "Home":
      return "Home";
    case "End":
      return "End";
    case "PageUp":
      return "PageUp";
    case "PageDown":
      return "PageDown";
    case "Minus":
      return "-";
    case "Equal":
      return "=";
    case "Comma":
      return ",";
    case "Period":
      return ".";
    case "Slash":
      return "/";
    case "Backslash":
      return "\\";
    case "Semicolon":
      return ";";
    case "Quote":
      return "'";
    case "BracketLeft":
      return "[";
    case "BracketRight":
      return "]";
    case "Backquote":
      return "`";
    default:
      return null;
  }
}

/**
 * Build an Electron accelerator from a keydown event.
 * Requires ≥1 modifier. Returns null while only modifiers are held, or for invalid keys.
 */
export function keyboardEventToAccelerator(e: KeyboardEvent): string | null {
  if (MODIFIER_CODES.has(e.code)) return null;
  const key = codeToAccelKey(e);
  if (!key) return null;

  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Control");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (e.metaKey) {
    const isMac =
      (typeof process !== "undefined" && process.platform === "darwin") ||
      (typeof navigator !== "undefined" && /Mac/i.test(navigator.platform || ""));
    parts.push(isMac ? "Command" : "Super");
  }

  // Require a real combo (modifier + key), not a bare key.
  if (parts.length === 0) return null;
  parts.push(key);
  return normalizeAccelerator(parts.join("+"));
}

/** Normalize / validate an accelerator string; returns null if empty/invalid. */
export function normalizeAccelerator(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const tokens = s.split("+").map((t) => t.trim()).filter(Boolean);
  if (tokens.length < 2) return null;

  const mods: string[] = [];
  let key: string | null = null;
  for (const tok of tokens) {
    const lower = tok.toLowerCase();
    if (lower === "control" || lower === "ctrl" || lower === "cmdorctrl" || lower === "commandorcontrol") {
      if (!mods.includes("Control")) mods.push("Control");
      continue;
    }
    if (lower === "command" || lower === "cmd" || lower === "meta" || lower === "super") {
      // Store as Control on Win/Linux display path; Electron accepts CommandOrControl.
      // Prefer CommandOrControl only when user pressed meta — for prefs we keep Control for Ctrl.
      if (!mods.includes("Control") && !mods.includes("Command") && !mods.includes("Super")) {
        if (lower === "super" || lower === "meta") mods.push("Super");
        else mods.push("Command");
      }
      continue;
    }
    if (lower === "alt" || lower === "option") {
      if (!mods.includes("Alt")) mods.push("Alt");
      continue;
    }
    if (lower === "shift") {
      if (!mods.includes("Shift")) mods.push("Shift");
      continue;
    }
    if (key) return null;
    key = tok.length === 1 ? tok.toUpperCase() : tok;
  }
  if (!key || mods.length === 0) return null;
  return [...mods, key].join("+");
}

/** Human-readable label (Windows-oriented Ctrl wording). */
export function formatAcceleratorLabel(accel: string): string {
  return accel
    .split("+")
    .map((t) => {
      const lower = t.toLowerCase();
      if (lower === "control" || lower === "ctrl" || lower === "commandorcontrol") return "Ctrl";
      if (lower === "command" || lower === "cmd") return "⌘";
      if (lower === "super" || lower === "meta") return "Win";
      if (lower === "alt" || lower === "option") return "Alt";
      if (lower === "shift") return "Shift";
      if (lower === "return") return "Enter";
      if (lower === "escape") return "Esc";
      if (lower === "space") return "Space";
      return t;
    })
    .join("+");
}
