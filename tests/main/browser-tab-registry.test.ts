import { describe, expect, it } from "vitest";
import { createBrowserTabRegistry } from "../../src/main/browser-tab-registry";

describe("browser-tab-registry", () => {
  it("resolves visible tab for workspace", () => {
    const reg = createBrowserTabRegistry();
    reg.upsert({
      tabId: "b1",
      webContentsId: 1,
      url: "https://a.example/",
      title: "A",
      visible: false,
      workspaceRoot: "C:\\ws",
    });
    reg.upsert({
      tabId: "b2",
      webContentsId: 2,
      url: "https://b.example/",
      title: "B",
      visible: true,
      workspaceRoot: "C:\\ws",
    });
    const hit = reg.resolveTarget({ workspaceRoot: "C:/ws" });
    expect(hit?.tabId).toBe("b2");
  });

  it("prefers explicit tabId", () => {
    const reg = createBrowserTabRegistry();
    reg.upsert({
      tabId: "b1",
      webContentsId: 1,
      url: "https://a.example/",
      title: "A",
      visible: true,
      workspaceRoot: "/ws",
    });
    reg.upsert({
      tabId: "b2",
      webContentsId: 2,
      url: "https://b.example/",
      title: "B",
      visible: false,
      workspaceRoot: "/ws",
    });
    expect(reg.resolveTarget({ tabId: "b2", workspaceRoot: "/ws" })?.tabId).toBe("b2");
  });
});
