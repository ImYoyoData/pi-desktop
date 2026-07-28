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
});
