import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createWorkspaceStore } from "../../src/main/workspace-store";

describe("workspace-store", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-desk-ws-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("appends new roots in add order and does not promote on re-open", () => {
    const store = createWorkspaceStore(path.join(dir, "state.json"));
    store.addRecent("/a");
    store.addRecent("/b");
    store.addRecent("/c");
    store.addRecent("/b"); // re-open — must keep position
    expect(store.listRecent()).toEqual(["/a", "/b", "/c"]);
  });

  it("reorderRecent persists drag order", () => {
    const store = createWorkspaceStore(path.join(dir, "state.json"));
    store.addRecent("/a");
    store.addRecent("/b");
    store.addRecent("/c");
    store.reorderRecent(["/c", "/a", "/b"]);
    expect(store.listRecent()).toEqual(["/c", "/a", "/b"]);
    const again = createWorkspaceStore(path.join(dir, "state.json"));
    expect(again.listRecent()).toEqual(["/c", "/a", "/b"]);
  });

  it("removeRecent dismisses to closed; forget drops entirely", () => {
    const a = path.join(dir, "proj-a");
    const b = path.join(dir, "proj-b");
    const store = createWorkspaceStore(path.join(dir, "state.json"));
    store.addRecent(a);
    store.addRecent(b);
    store.setRoot(a);
    store.removeRecent(a);
    expect(store.listRecent()).toEqual([b]);
    expect(store.getRoot()).toBe(b);
    expect(store.listDismissedPi().map((p) => path.resolve(p))).toContain(path.resolve(a));

    store.forget(a);
    expect(store.listDismissedPi().map((p) => path.resolve(p))).not.toContain(path.resolve(a));
    store.forget(b);
    expect(store.listRecent()).toEqual([]);
    expect(store.getRoot()).toBeNull();
  });

  /**
   * A blank path resolved against the process cwd becomes the app's own working
   * directory, which the sidebar painted as an extra nameless workspace.
   */
  it("never stores a blank root", () => {
    const store = createWorkspaceStore(path.join(dir, "state.json"));
    store.addRecent("");
    store.addRecent("   ");
    store.addRecent("\t\n");
    expect(store.listRecent()).toEqual([]);

    store.setRoot("");
    expect(store.getRoot()).toBeNull();

    store.addRecent("   ");
    expect(store.getRoot()).toBeNull();
  });

  it("trims entries and keeps the rest of a mixed list", () => {
    const store = createWorkspaceStore(path.join(dir, "state.json"));
    store.addRecent(" ");
    store.addRecent("  /proj  ");
    expect(store.listRecent()).toEqual(["/proj"]);
  });

  it("drops blanks left in an existing state file", () => {
    const statePath = path.join(dir, "state.json");
    fs.writeFileSync(
      statePath,
      JSON.stringify({
        root: "",
        recent: ["", "   ", "/keep-me"],
        dismissedPi: ["", "/closed"],
      }),
      "utf8",
    );
    const store = createWorkspaceStore(statePath);
    expect(store.listRecent()).toEqual(["/keep-me"]);
    expect(store.listDismissedPi()).toEqual(["/closed"]);
    expect(store.getRoot()).toBeNull();
  });
});
