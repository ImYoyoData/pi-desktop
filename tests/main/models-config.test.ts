import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createModelsConfig, resolveModelsConfigPaths } from "../../src/main/models-config";

describe("models-config", () => {
  let dir: string;
  let modelsPath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-desk-models-"));
    modelsPath = path.join(dir, "models.json");
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("serializes overlapping writes; last write wins with valid JSON", async () => {
    const cfg = createModelsConfig({
      modelsPath,
      authPath: path.join(dir, "auth.json"),
    });

    await Promise.all([
      cfg.writeModelsConfig({ providers: { first: { apiKey: "1" } } }),
      cfg.writeModelsConfig({ providers: { second: { apiKey: "2" } } }),
      cfg.writeModelsConfig({ providers: { third: { apiKey: "3" } } }),
    ]);

    const raw = fs.readFileSync(modelsPath, "utf8");
    expect(() => JSON.parse(raw)).not.toThrow();

    const final = await cfg.readModelsConfig();
    expect(final.providers?.third).toEqual({ apiKey: "3" });
    expect(final.providers?.first).toBeUndefined();
    expect(final.providers?.second).toBeUndefined();
  });

  it("resolveModelsConfigPaths works with and without an explicit agent dir", () => {
    const overridden = resolveModelsConfigPaths(path.join(dir, "custom"));
    expect(overridden.modelsPath).toBe(path.join(dir, "custom", "models.json"));
    // No arg must not crash (regression: the parameter used to shadow the
    // agentDir() function and throw "agentDir is not a function").
    const def = resolveModelsConfigPaths();
    expect(def.modelsPath.endsWith(path.join(".pi", "agent", "models.json"))).toBe(true);
  });
});
