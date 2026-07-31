import {
  initTheme,
  Theme,
  type ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";
import {
  EXTENSION_UI_TIMEOUT_MS,
  extensionUiReplyResult,
  isExtensionUiDialogMethod,
  type ExtensionUiDialogMethod,
  type ExtensionUiReply,
} from "../shared/extension-ui";
import { rpcToMain } from "./main-rpc";

/** Same global key the package uses for its Theme singleton (not in public exports). */
const THEME_KEY = Symbol.for("@earendil-works/pi-coding-agent:theme");

function ensureTheme(): Theme {
  const existing = (globalThis as Record<PropertyKey, unknown>)[THEME_KEY];
  if (existing instanceof Theme) return existing;
  // Public API — loads dark/light via package exports (deep theme.js path is blocked).
  try {
    initTheme();
  } catch (err) {
    console.error("[pi-desktop] initTheme failed; extensions that need ctx.ui.theme may degrade", err);
  }
  const theme = (globalThis as Record<PropertyKey, unknown>)[THEME_KEY];
  if (!(theme instanceof Theme)) {
    throw new Error("Failed to initialize Pi theme for extension UI");
  }
  return theme;
}

function asReply(raw: unknown): ExtensionUiReply {
  if (!raw || typeof raw !== "object") {
    return { requestId: "", cancelled: true };
  }
  const row = raw as Record<string, unknown>;
  const requestId = typeof row.requestId === "string" ? row.requestId : "";
  if (row.cancelled === true) return { requestId, cancelled: true };
  if (typeof row.confirmed === "boolean") {
    return { requestId, confirmed: row.confirmed };
  }
  if (typeof row.value === "string") {
    return { requestId, value: row.value };
  }
  return { requestId, cancelled: true };
}

async function askDialog(
  method: ExtensionUiDialogMethod,
  params: Record<string, unknown>,
  timeoutMs?: number,
): Promise<string | boolean | undefined> {
  const ms =
    typeof timeoutMs === "number" && timeoutMs > 0 ? timeoutMs : EXTENSION_UI_TIMEOUT_MS;
  try {
    const raw = await rpcToMain(
      "desktop.extensionUi",
      { method, ...params },
      ms,
    );
    return extensionUiReplyResult(method, asReply(raw));
  } catch {
    return extensionUiReplyResult(method, { requestId: "", cancelled: true });
  }
}

function fireAndForget(method: string, params: Record<string, unknown>): void {
  void rpcToMain("desktop.extensionUi", { method, ...params }, 15_000).catch(() => {
    // Fire-and-forget: ignore transport errors.
  });
}

/**
 * Desktop ExtensionUIContext: dialogs + notify bridge to the renderer.
 * TUI-only APIs (`custom`, footer/header factories) stay no-ops.
 */
export function createDesktopExtensionUIContext(): ExtensionUIContext {
  return {
    select: async (title, options, opts) => {
      const result = await askDialog(
        "select",
        { title, options },
        opts?.timeout,
      );
      return typeof result === "string" ? result : undefined;
    },
    confirm: async (title, message, opts) => {
      const result = await askDialog(
        "confirm",
        { title, message },
        opts?.timeout,
      );
      return result === true;
    },
    input: async (title, placeholder, opts) => {
      const result = await askDialog(
        "input",
        { title, ...(placeholder != null ? { placeholder } : {}) },
        opts?.timeout,
      );
      return typeof result === "string" ? result : undefined;
    },
    editor: async (title, prefill) => {
      const result = await askDialog("editor", {
        title,
        ...(prefill != null ? { prefill } : {}),
      });
      return typeof result === "string" ? result : undefined;
    },
    notify: (message, type) => {
      fireAndForget("notify", {
        message,
        notifyType: type ?? "info",
      });
    },
    setStatus: (key, text) => {
      fireAndForget("setStatus", {
        statusKey: key,
        statusText: text ?? null,
      });
    },
    setWidget: (key, content) => {
      const widgetLines = Array.isArray(content) ? content : null;
      fireAndForget("setWidget", {
        widgetKey: key,
        widgetLines,
      });
    },
    setTitle: (title) => {
      fireAndForget("setTitle", { title });
    },
    setEditorText: (text) => {
      fireAndForget("setEditorText", { text });
    },
    pasteToEditor: (text) => {
      fireAndForget("setEditorText", { text });
    },
    getEditorText: () => "",
    onTerminalInput: () => () => {},
    setWorkingMessage: () => {},
    setWorkingVisible: () => {},
    setWorkingIndicator: () => {},
    setHiddenThinkingLabel: () => {},
    setFooter: () => {},
    setHeader: () => {},
    custom: async <T,>() => undefined as T,
    addAutocompleteProvider: () => {},
    setEditorComponent: () => {},
    getEditorComponent: () => undefined,
    get theme() {
      try {
        return ensureTheme();
      } catch (err) {
        console.error("[pi-desktop] extension requested theme but init failed", err);
        // Re-throw would abort session_start / MCP connect — return a last-ditch Theme if present.
        const theme = (globalThis as Record<PropertyKey, unknown>)[THEME_KEY];
        if (theme instanceof Theme) return theme;
        throw err;
      }
    },
    getAllThemes: () => [],
    getTheme: () => undefined,
    setTheme: () => ({ success: false, error: "UI themes unavailable in Pi Desktop" }),
    getToolsExpanded: () => false,
    setToolsExpanded: () => {},
  };
}

export function isDesktopExtensionUiMethod(method: string): boolean {
  return (
    isExtensionUiDialogMethod(method) ||
    method === "notify" ||
    method === "setStatus" ||
    method === "setWidget" ||
    method === "setTitle" ||
    method === "setEditorText"
  );
}
