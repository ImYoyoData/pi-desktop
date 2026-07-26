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

  it("remembers recent roots newest-first unique", () => {
    const store = createWorkspaceStore(path.join(dir, "state.json"));
    store.addRecent("/a");
    store.addRecent("/b");
    store.addRecent("/a");
    expect(store.listRecent()).toEqual(["/a", "/b"]);
  });
});
