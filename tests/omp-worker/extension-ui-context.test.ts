import { describe, expect, it, vi } from "vitest";
import { createOmpDesktopExtensionUIContext } from "../../src/omp-worker/extension-ui-context";

describe("OMP 扩展 UI 上下文", () => {
  it("把 setStatus/setWidget/setTitle/setEditorText 转发到主进程", async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const ui = createOmpDesktopExtensionUIContext({
      rpc: async (method, params) => {
        calls.push({ method, params });
        return { requestId: "", cancelled: true };
      },
    });

    ui.setStatus?.("build", "running");
    ui.setWidget?.("panel", ["one", "two"]);
    ui.setTitle?.("session title");
    ui.setEditorText?.("draft");

    await vi.waitFor(() => expect(calls).toHaveLength(4));
    expect(calls).toEqual([
      { method: "desktop.extensionUi", params: { method: "setStatus", statusKey: "build", statusText: "running" } },
      { method: "desktop.extensionUi", params: { method: "setWidget", widgetKey: "panel", widgetLines: ["one", "two"] } },
      { method: "desktop.extensionUi", params: { method: "setTitle", title: "session title" } },
      { method: "desktop.extensionUi", params: { method: "setEditorText", text: "draft" } },
    ]);
  });
});
