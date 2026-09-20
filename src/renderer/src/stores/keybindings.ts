import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";
import { formatAcceleratorLabel, keyboardEventToAccelerator, normalizeAccelerator } from "../../../shared/hotkey";
import type { Messages } from "@renderer/i18n";

export type KeybindingId =
  | "new-session"
  | "cycle-permission"
  | "new-terminal"
  | "close-terminal"
  | "open-file"
  | "toggle-right-pane"
  | "right-pane-files"
  | "cycle-model"
  | "open-settings"
  | "cycle-thinking"
  | "cycle-mode";

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
  { id: "cycle-permission", labelKey: "hotkeyCyclePermission", defaultAccel: "Control+M" },
  { id: "new-terminal", labelKey: "hotkeyNewTerminal", defaultAccel: "Control+`" },
  { id: "close-terminal", labelKey: "hotkeyCloseTerminal", defaultAccel: "Shift+Escape" },
  { id: "open-file", labelKey: "hotkeyOpenFile", defaultAccel: "Control+E" },
  { id: "toggle-right-pane", labelKey: "hotkeyToggleRightPane", defaultAccel: "Control+Alt+B" },
  { id: "right-pane-files", labelKey: "hotkeyRightPaneFiles", defaultAccel: "Control+P" },
  { id: "cycle-model", labelKey: "hotkeyCycleModel", defaultAccel: "Control+Shift+M" },
  { id: "open-settings", labelKey: "hotkeyOpenSettings", defaultAccel: "Control+," },
  { id: "cycle-thinking", labelKey: "hotkeyCycleThinking", defaultAccel: "Control+I" },
  { id: "cycle-mode", labelKey: "hotkeyCycleMode", defaultAccel: "Control+=" },
];

export const BUILTIN_SHORTCUTS: BuiltinShortcut[] = [
  { group: "app", labelKey: "hotkeyMaximizeEditor", keys: "Ctrl+Alt+E" },
  { group: "app", labelKey: "hotkeyToggleDetails", keys: "Ctrl+Alt+L" },
  { group: "app", labelKey: "hotkeySaveFile", keys: "Ctrl+S" },
  { group: "app", labelKey: "hotkeyAsrWake", keys: "Ctrl+Alt+Y" },
  { group: "app", labelKey: "hotkeyBrowserDevtools", keys: "F12" },
  { group: "app", labelKey: "hotkeyAppDevtools", keys: "Ctrl+Shift+I" },
  { group: "app", labelKey: "hotkeyDialogConfirm", keys: "Enter" },
  { group: "app", labelKey: "hotkeySelectModeDelete", keys: "Del" },
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

function readStored(): StoredState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { master: true, bindings: {} };
    const parsed = JSON.parse(raw) as Partial<StoredState>;
    return {
      master: parsed.master !== false,
      bindings: parsed.bindings && typeof parsed.bindings === "object" ? parsed.bindings : {},
    };
  } catch {
    return { master: true, bindings: {} };
  }
}

export const useKeybindingsStore = defineStore("keybindings", () => {
  const initial = readStored();
  const master = ref(initial.master);
  /** 录制新键时暂停分发，避免组合键触发原本的命令 */
  const capturing = ref(false);
  const stored = ref<Record<string, StoredBinding>>(initial.bindings);
  const handlers = new Map<KeybindingId, () => void>();

  function persist(): void {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ master: master.value, bindings: stored.value }),
      );
    } catch {
      // 存储不可用时仅内存生效
    }
  }

  function accelOf(def: KeybindingDef): string {
    return stored.value[def.id]?.accel ?? def.defaultAccel;
  }

  function enabledOf(id: KeybindingId): boolean {
    return stored.value[id]?.enabled !== false;
  }

  function isDefault(id: KeybindingId): boolean {
    const entry = stored.value[id];
    return !entry || Object.keys(entry).length === 0;
  }

  const accelIndex = computed(() => {
    const map = new Map<string, KeybindingDef>();
    for (const def of KEYBINDINGS) {
      map.set(canonicalAccel(accelOf(def)), def);
    }
    return map;
  });

  const conflicts = computed(() => {
    const seen = new Map<string, number>();
    for (const def of KEYBINDINGS) {
      const key = canonicalAccel(accelOf(def));
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    const dup = new Set<KeybindingId>();
    for (const def of KEYBINDINGS) {
      if ((seen.get(canonicalAccel(accelOf(def))) ?? 0) > 1) dup.add(def.id);
    }
    return dup;
  });

  function labelOf(def: KeybindingDef): string {
    return formatAcceleratorLabel(accelOf(def));
  }

  function setMaster(on: boolean): void {
    master.value = on;
  }

  function setEnabled(id: KeybindingId, on: boolean): void {
    stored.value = { ...stored.value, [id]: { ...stored.value[id], enabled: on } };
  }

  function setAccel(id: KeybindingId, raw: string): boolean {
    const accel = normalizeAccelerator(raw);
    if (!accel) return false;
    stored.value = { ...stored.value, [id]: { ...stored.value[id], accel: canonicalAccel(accel) } };
    return true;
  }

  function resetBinding(id: KeybindingId): void {
    const entry = stored.value[id];
    if (!entry) return;
    const { accel: _accel, ...rest } = entry;
    if (Object.keys(rest).length > 0) {
      stored.value = { ...stored.value, [id]: rest };
      return;
    }
    const { [id]: _removed, ...others } = stored.value;
    stored.value = others;
  }

  function register(id: KeybindingId, handler: () => void): void {
    handlers.set(id, handler);
  }

  function setCapturing(on: boolean): void {
    capturing.value = on;
  }

  function unregister(id: KeybindingId): void {
    handlers.delete(id);
  }

  function swallow(event: KeyboardEvent): void {
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function onKeydown(event: KeyboardEvent): void {
    if (!master.value || capturing.value || event.isComposing) return;
    const accel = keyboardEventToAccelerator(event);
    const def = accel ? accelIndex.value.get(canonicalAccel(accel)) : undefined;
    if (!def || !enabledOf(def.id)) return;
    const handler = handlers.get(def.id);
    if (!handler) return;
    swallow(event);
    handler();
  }

  let installed = false;

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

  watch([master, stored], persist, { deep: true });

  return {
    master,
    capturing,
    conflicts,
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
