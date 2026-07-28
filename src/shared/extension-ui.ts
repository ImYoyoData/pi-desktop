/**
 * Pi Extension UI bridge (Desktop ↔ worker).
 * Mirrors the RPC `extension_ui_request` / `extension_ui_response` shape so
 * extensions using `ctx.ui.select|confirm|input|editor|notify|…` work outside TUI.
 */

export const EXTENSION_UI_TIMEOUT_MS = 10 * 60 * 1000;

export type ExtensionUiDialogMethod = "select" | "confirm" | "input" | "editor";

export type ExtensionUiNotifyType = "info" | "warning" | "error";

export type ExtensionUiPending =
  | {
      sessionId: string;
      requestId: string;
      method: "select";
      title: string;
      options: string[];
    }
  | {
      sessionId: string;
      requestId: string;
      method: "confirm";
      title: string;
      message: string;
    }
  | {
      sessionId: string;
      requestId: string;
      method: "input";
      title: string;
      placeholder?: string;
    }
  | {
      sessionId: string;
      requestId: string;
      method: "editor";
      title: string;
      prefill?: string;
    };

/** Main → renderer push (dialog ask, cancel, or fire-and-forget). */
export type ExtensionUiEvent =
  | ExtensionUiPending
  | {
      sessionId: string;
      requestId: string;
      cancelled: true;
    }
  | {
      sessionId: string;
      method: "notify";
      message: string;
      notifyType: ExtensionUiNotifyType;
    }
  | {
      sessionId: string;
      method: "setEditorText";
      text: string;
    }
  | {
      sessionId: string;
      method: "setStatus";
      statusKey: string;
      statusText: string | null;
    }
  | {
      sessionId: string;
      method: "setWidget";
      widgetKey: string;
      widgetLines: string[] | null;
    }
  | {
      sessionId: string;
      method: "setTitle";
      title: string;
    };

export type ExtensionUiReply =
  | { requestId: string; cancelled: true }
  | { requestId: string; value: string }
  | { requestId: string; confirmed: boolean };

export function isExtensionUiDialogMethod(v: unknown): v is ExtensionUiDialogMethod {
  return v === "select" || v === "confirm" || v === "input" || v === "editor";
}

export function isExtensionUiNotifyType(v: unknown): v is ExtensionUiNotifyType {
  return v === "info" || v === "warning" || v === "error";
}

export function isExtensionUiCancelled(
  event: ExtensionUiEvent,
): event is { sessionId: string; requestId: string; cancelled: true } {
  return "cancelled" in event && event.cancelled === true;
}

export function isExtensionUiPending(event: ExtensionUiEvent): event is ExtensionUiPending {
  return (
    !("cancelled" in event) &&
    "requestId" in event &&
    typeof (event as ExtensionUiPending).requestId === "string" &&
    isExtensionUiDialogMethod((event as ExtensionUiPending).method)
  );
}

/** Normalize worker RPC params into a dialog pending payload (without sessionId). */
export function parseExtensionUiDialogParams(
  params: Record<string, unknown>,
  requestId: string,
): Omit<ExtensionUiPending, "sessionId"> | null {
  const method = params.method;
  if (!isExtensionUiDialogMethod(method)) return null;
  const title = typeof params.title === "string" ? params.title : "";

  switch (method) {
    case "select": {
      const options = Array.isArray(params.options)
        ? params.options.filter((o): o is string => typeof o === "string")
        : [];
      if (!title || options.length === 0) return null;
      return { requestId, method, title, options };
    }
    case "confirm": {
      const message = typeof params.message === "string" ? params.message : "";
      if (!title) return null;
      return { requestId, method, title, message };
    }
    case "input": {
      if (!title) return null;
      return {
        requestId,
        method,
        title,
        ...(typeof params.placeholder === "string" ? { placeholder: params.placeholder } : {}),
      };
    }
    case "editor": {
      if (!title) return null;
      return {
        requestId,
        method,
        title,
        ...(typeof params.prefill === "string" ? { prefill: params.prefill } : {}),
      };
    }
    default: {
      const _never: never = method;
      void _never;
      return null;
    }
  }
}

export function parseExtensionUiFireParams(
  params: Record<string, unknown>,
):
  | { method: "notify"; message: string; notifyType: ExtensionUiNotifyType }
  | { method: "setEditorText"; text: string }
  | { method: "setStatus"; statusKey: string; statusText: string | null }
  | { method: "setWidget"; widgetKey: string; widgetLines: string[] | null }
  | { method: "setTitle"; title: string }
  | null {
  const method = params.method;
  switch (method) {
    case "notify": {
      const message = typeof params.message === "string" ? params.message : "";
      if (!message) return null;
      const notifyType = isExtensionUiNotifyType(params.notifyType)
        ? params.notifyType
        : "info";
      return { method, message, notifyType };
    }
    case "setEditorText": {
      const text = typeof params.text === "string" ? params.text : "";
      return { method, text };
    }
    case "setStatus": {
      const statusKey = typeof params.statusKey === "string" ? params.statusKey : "";
      if (!statusKey) return null;
      const statusText =
        typeof params.statusText === "string"
          ? params.statusText
          : params.statusText == null
            ? null
            : String(params.statusText);
      return { method, statusKey, statusText };
    }
    case "setWidget": {
      const widgetKey = typeof params.widgetKey === "string" ? params.widgetKey : "";
      if (!widgetKey) return null;
      const widgetLines = Array.isArray(params.widgetLines)
        ? params.widgetLines.filter((l): l is string => typeof l === "string")
        : null;
      return {
        method,
        widgetKey,
        widgetLines: params.widgetLines === undefined ? null : widgetLines,
      };
    }
    case "setTitle": {
      const title = typeof params.title === "string" ? params.title : "";
      return { method, title };
    }
    default:
      return null;
  }
}

/** Map renderer reply → value returned to ExtensionUIContext. */
export function extensionUiReplyResult(
  method: ExtensionUiDialogMethod,
  reply: ExtensionUiReply,
): string | boolean | undefined {
  if ("cancelled" in reply && reply.cancelled) {
    switch (method) {
      case "confirm":
        return false;
      case "select":
      case "input":
      case "editor":
        return undefined;
      default: {
        const _never: never = method;
        return _never;
      }
    }
  }
  if (method === "confirm" && "confirmed" in reply) {
    return Boolean(reply.confirmed);
  }
  if (
    (method === "select" || method === "input" || method === "editor") &&
    "value" in reply &&
    typeof reply.value === "string"
  ) {
    return reply.value;
  }
  return undefined;
}
