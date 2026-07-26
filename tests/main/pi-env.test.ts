import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  delete process.env.PI_CODING_AGENT_DIR;
});

describe("ensurePiAgentEnvironment", () => {
  it("creates agent dir and default config files when missing", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-desktop-agent-"));
    tempRoots.push(root);
    process.env.PI_CODING_AGENT_DIR = root;

    const { ensurePiAgentEnvironment } = await import("../../src/main/pi-env");
    const result = ensurePiAgentEnvironment();

    expect(result.agentDir).toBe(path.resolve(root));
    expect(fs.existsSync(path.join(root, "models.json"))).toBe(true);
    expect(fs.existsSync(path.join(root, "auth.json"))).toBe(true);
    expect(fs.existsSync(path.join(root, "settings.json"))).toBe(true);
    expect(fs.existsSync(path.join(root, "sessions"))).toBe(true);

    const again = ensurePiAgentEnvironment();
    expect(again.created).toEqual([]);
  });
});
