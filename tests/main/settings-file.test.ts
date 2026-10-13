import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readSettingsRoot, settingsPath, updateSettingsRoot } from "../../src/main/settings-file";

const SETTINGS_SCHEMA_URL = "https://pi.dev/schemas/settings.schema.json";

describe("settings-file", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-desk-settings-"));
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("首次写入补上 pi 的配置 schema", async () => {
    await updateSettingsRoot({ hideThinkingBlock: true }, dir);

    const raw = JSON.parse(fs.readFileSync(settingsPath(dir), "utf8"));
    expect(raw.$schema).toBe(SETTINGS_SCHEMA_URL);
    expect(raw.hideThinkingBlock).toBe(true);
  });

  it("保留用户自带的 $schema", async () => {
    fs.writeFileSync(settingsPath(dir), JSON.stringify({ $schema: "https://example.com/x.json" }));

    await updateSettingsRoot({ hideThinkingBlock: true }, dir);

    const raw = JSON.parse(fs.readFileSync(settingsPath(dir), "utf8"));
    expect(raw.$schema).toBe("https://example.com/x.json");
  });

  it("补 schema 时不动其它键", async () => {
    await updateSettingsRoot({ defaultModel: "a/b" }, dir);
    await updateSettingsRoot({ hideThinkingBlock: false }, dir);

    const raw = readSettingsRoot(settingsPath(dir));
    expect(raw.defaultModel).toBe("a/b");
    expect(raw.hideThinkingBlock).toBe(false);
  });

  it("非字符串的旧 $schema 被替换", async () => {
    for (const stale of [123, null, {}]) {
      await updateSettingsRoot({ $schema: stale, defaultModel: "a/b" }, dir);
      expect(readSettingsRoot(settingsPath(dir)).$schema).toBe(SETTINGS_SCHEMA_URL);
    }
  });
});