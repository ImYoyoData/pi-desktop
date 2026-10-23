import { create } from "zustand";
import { formatAcceleratorLabel, keyboardEventToAccelerator, normalizeAccelerator } from "../../../shared/hotkey";
import type { Messages } from "@renderer/i18n";
import * as prefs from "@renderer/utils/prefs";

export type KeybindingId =
  | "new-session"
  | "select-sessions"
  | "new-terminal"
  | "close-terminal"
  | "open-file"
  | "toggle-right-pane"
  | "right-pane-files"
  | "cycle-model"
  | "open-settings"
  | "cycle-thinking"
  | "open-pull-requests";

export interface KeybindingDef {
  id: KeybindingId;
  labelKey: keyof Messages;
  /** 默认加速键 */
  defaultAccel: string;
}

export type BuiltinShortcutGroup = "app" | "composer" | "menu";

/** 项目自带、不可改键的快捷键，仅作参考展示。 */
export interface BuiltinShortcut {
  group: BuiltinShortcutGroup;
  labelKey: keyof Messages;
  keys: string;
}

export const KEYBINDINGS: KeybindingDef[] = [
  { id: "new-session", labelKey: "hotkeyNewSession", defaultAccel: "Control+N" },
  { id: "select-sessions", labelKey: "hotkeySelectSessions", defaultAccel: "Control+P" },
  { id: "new-terminal", labelKey: "hotkeyNewTerminal", defaultAccel: "Control+`" },
  { id: "close-terminal", labelKey: "hotkeyCloseTerminal", defaultAccel: "Shift+Escape" },
  { id: "open-file", labelKey: "hotkeyOpenFile", defaultAccel: "Control+E" },
  { id: "toggle-right-pane", labelKey: "hotkeyToggleRightPane", defaultAccel: "Control+Alt+B" },
  /** 无默认键位：功能保留，用户可在设置页自行绑定 */
  { id: "right-pane-files", labelKey: "hotkeyRightPaneFiles", defaultAccel: "" },
  { id: "cycle-model", labelKey: "hotkeyCycleModel", defaultAccel: "Control+Shift+M" },
  { id: "open-settings", labelKey: "hotkeyOpenSettings", defaultAccel: "Control+," },
  { id: "cycle-thinking", labelKey: "hotkeyCycleThinking", defaultAccel: "Control+I" },
  { id: "open-pull-requests", labelKey: "pullRequests", defaultAccel: "Control+Shift+P" },
];

export const BUILTIN_SHORTCUTS: BuiltinShortcut[] = [
  { group: "app", labelKey: "hotkeyMaximizeEditor", keys: "Ctrl+Alt+E" },
  { group: "app", labelKey: "hotkeyToggleDetails", keys: "Ctrl+Alt+L" },
  { group: "app", labelKey: "hotkeySaveFile", keys: "Ctrl+S" },
  { group: "app", labelKey: "hotkeyBrowserDevtools", keys: "F12" },
  { group: "app", labelKey: "hotkeyAppDevtools", keys: "Ctrl+Shift+I" },
  { group: "app", labelKey: "hotkeyDialogConfirm", keys: "Enter" },
  { group: "app", labelKey: "hotkeySelectModeDelete", keys: "Del" },
  { group: "app", labelKey: "hotkeySelectModeCancel", keys: "Esc" },
  { group: "composer", labelKey: "hotkeySend", keys: "Enter" },
  { group: "composer", labelKey: "hotkeyNewline", keys: "Shift+Enter" },
  { group: "composer", labelKey: "hotkeyMenuNavigate", keys: "↑ / ↓" },
  { group: "composer", labelKey: "hotkeyMenuConfirm", keys: "Tab" },
  { group: "composer", labelKey: "hotkeyDismiss", keys: "Esc" },
  { group: "menu", labelKey: "hotkeyUndo", keys: "Ctrl+Z" },
  { group: "menu", labelKey: "hotkeyRedo", keys: "Ctrl+Y" },
  { group: "menu", labelKey: "hotkeyClipboard", keys: "Ctrl+X / Ctrl+C / Ctrl+V" },
  { group: "menu", labelKey: "hotkeySelectAll", keys: "Ctrl+A" },
  { group: "menu", labelKey: "hotkeyReload", keys: "Ctrl+R / Ctrl+Shift+R" },
  { group: "menu", labelKey: "hotkeyZoom", keys: "Ctrl+0 / Ctrl+-" },
  { group: "menu", labelKey: "hotkeyFullscreen", keys: "F11" },
  { group: "menu", labelKey: "hotkeyCloseWindow", keys: "Ctrl+W" },
];

const STORAGE_KEY = "pi-desktop:keybindings:v1";
const MOD_ORDER = ["Control", "Alt", "Shift", "Super", "Command"];

/** 修饰键顺序统一，保证录制与匹配的比较结果一致。 */
export function canonicalAccel(accel: string): string {
  const parts = accel.split("+");
  const key = parts.pop() ?? "";
  const mods = parts.sort((a, b) => MOD_ORDER.indexOf(a) - MOD_ORDER.indexOf(b));
  return [...mods, key].join("+");
}

interface StoredBinding {
  accel?: string;
  enabled?: boolean;
}

interface StoredState {
  master: boolean;
  bindings: Record<string, StoredBinding>;
}

type Bindings = Record<string, StoredBinding>;

const KNOWN_IDS = new Set<string>(KEYBINDINGS.map((def) => def.id));

function readStored(): StoredState {
  try {
    const raw = prefs.getItem(STORAGE_KEY);
    if (!raw) return { master: true, bindings: {} };
    const parsed = JSON.parse(raw) as Partial<StoredState>;
    const stored = parsed.bindings && typeof parsed.bindings === "object" ? parsed.bindings : {};
    const known: Bindings = {};
    for (const [id, binding] of Object.entries(stored)) {
      if (KNOWN_IDS.has(id)) known[id] = binding;
    }
    return { master: parsed.master !== false, bindings: known };
  } catch {
    return { master: true, bindings: {} };
  }
}

function accelOf(bindings: Bindings, def: KeybindingDef): string {
  return bindings[def.id]?.accel ?? def.defaultAccel;
}

function findByAccel(bindings: Bindings, accel: string): KeybindingDef | undefined {
  const canonical = canonicalAccel(accel);
  if (!canonical) return undefined;
  let found: KeybindingDef | undefined;
  for (const def of KEYBINDINGS) {
    if (canonicalAccel(accelOf(bindings, def)) === canonical) found = def;
  }
  return found;
}

type KeybindingsBase = {
  master: boolean;
  /** 录制新键时暂停分发，避免组合键触发原本的命令 */
  capturing: boolean;
  stored: Bindings;
};

type KeybindingsDerived = {
  conflicts: Set<KeybindingId>;
};

function derive(base: KeybindingsBase): KeybindingsDerived {
  const seen = new Map<string, number>();
  for (const def of KEYBINDINGS) {
    const key = canonicalAccel(accelOf(base.stored, def));
    if (key) seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  const conflicts = new Set<KeybindingId>();
  for (const def of KEYBINDINGS) {
    const key = canonicalAccel(accelOf(base.stored, def));
    if (key && (seen.get(key) ?? 0) > 1) conflicts.add(def.id);
  }
  return { conflicts };
}

export type KeybindingsState = KeybindingsBase &
  KeybindingsDerived & {
    enabledOf: (id: KeybindingId) => boolean;
    isDefault: (id: KeybindingId) => boolean;
    labelOf: (def: KeybindingDef) => string;
    setMaster: (on: boolean) => void;
    setCapturing: (on: boolean) => void;
    setEnabled: (id: KeybindingId, on: boolean) => void;
    setAccel: (id: KeybindingId, raw: string) => boolean;
    resetBinding: (id: KeybindingId) => void;
    register: (id: KeybindingId, handler: () => void) => void;
    unregister: (id: KeybindingId) => void;
    install: () => void;
    uninstall: () => void;
  };

export const useKeybindingsStore = create<KeybindingsState>()((set, get) => {
  const initial = readStored();
  const handlers = new Map<KeybindingId, () => void>();
  let installed = false;

  function commit(patch: Partial<KeybindingsBase>): void {
    set((state) => {
      const next = { ...state, ...patch };
      return { ...next, ...derive(next) };
    });
  }

  function persist(): void {
    const state = get();
    try {
      prefs.setItem(
        STORAGE_KEY,
        JSON.stringify({ master: state.master, bindings: state.stored }),
      );
    } catch {
      // 存储不可用时仅内存生效
    }
  }

  function enabledOf(id: KeybindingId): boolean {
    return get().stored[id]?.enabled !== false;
  }

  function isDefault(id: KeybindingId): boolean {
    const entry = get().stored[id];
    return !entry || Object.keys(entry).length === 0;
  }

  function labelOf(def: KeybindingDef): string {
    return formatAcceleratorLabel(accelOf(get().stored, def));
  }

  function setMaster(on: boolean): void {
    commit({ master: on });
    persist();
  }

  function setEnabled(id: KeybindingId, on: boolean): void {
    const stored = get().stored;
    commit({ stored: { ...stored, [id]: { ...stored[id], enabled: on } } });
    persist();
  }

  function setAccel(id: KeybindingId, raw: string): boolean {
    const accel = normalizeAccelerator(raw);
    if (!accel) return false;
    const stored = get().stored;
    commit({
      stored: { ...stored, [id]: { ...stored[id], accel: canonicalAccel(accel) } },
    });
    persist();
    return true;
  }

  function resetBinding(id: KeybindingId): void {
    const entry = get().stored[id];
    if (!entry) return;
    const { accel: _accel, ...rest } = entry;
    if (Object.keys(rest).length > 0) {
      commit({ stored: { ...get().stored, [id]: rest } });
      persist();
      return;
    }
    const { [id]: _removed, ...others } = get().stored;
    commit({ stored: others });
    persist();
  }

  function register(id: KeybindingId, handler: () => void): void {
    handlers.set(id, handler);
  }

  function setCapturing(on: boolean): void {
    commit({ capturing: on });
  }

  function unregister(id: KeybindingId): void {
    handlers.delete(id);
  }

  function swallow(event: KeyboardEvent): void {
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function onKeydown(event: KeyboardEvent): void {
    const state = get();
    if (!state.master || state.capturing || event.isComposing) return;
    const accel = keyboardEventToAccelerator(event);
    const def = accel ? findByAccel(state.stored, accel) : undefined;
    if (!def || !enabledOf(def.id)) return;
    const handler = handlers.get(def.id);
    if (!handler) return;
    swallow(event);
    handler();
  }

  function install(): void {
    if (installed) return;
    installed = true;
    window.addEventListener("keydown", onKeydown, true);
  }

  function uninstall(): void {
    if (!installed) return;
    installed = false;
    window.removeEventListener("keydown", onKeydown, true);
  }

  const base: KeybindingsBase = {
    master: initial.master,
    capturing: false,
    stored: initial.bindings,
  };

  return {
    ...base,
    ...derive(base),
    enabledOf,
    isDefault,
    labelOf,
    setMaster,
    setCapturing,
    setEnabled,
    setAccel,
    resetBinding,
    register,
    unregister,
    install,
    uninstall,
  };
});
