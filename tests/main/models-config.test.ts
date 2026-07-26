import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createModelsConfig } from "../../src/main/models-config";

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
});
