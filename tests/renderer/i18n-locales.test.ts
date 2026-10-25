import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { en } from "../../src/renderer/src/i18n/en";
import { ja } from "../../src/renderer/src/i18n/ja";
import { zh } from "../../src/renderer/src/i18n/zh-CN";
import { zhTW } from "../../src/renderer/src/i18n/zh-TW";

const dir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../src/renderer/src/i18n",
);

const LOCALE_FILES = ["zh-CN.ts", "zh-TW.ts", "ja.ts", "en.ts"] as const;

const LOCALES = [
  ["zh", zh],
  ["zhTW", zhTW],
  ["ja", ja],
  ["en", en],
] as const;

/**
 * Top-level keys of a locale file, in source order.
 *
 * Scanned from the source text rather than from the imported object: a duplicate
 * key is silently collapsed by JS at runtime, so `Object.keys()` can never reveal
 * it — but esbuild/Vite DOES warn about it, and whichever copy wins is arbitrary.
 * That is exactly how a duplicated `lanPublicCopyUrl` shipped.
 */
function topLevelKeys(file: string): string[] {
  const source = fs.readFileSync(path.join(dir, file), "utf8");
  // 只扫描导出的 locale 对象；文件顶部的辅助常量（TOOL_DESCRIPTIONS）不是 locale 键。
  const text = source.slice(source.indexOf("export const"));
  const keys: string[] = [];
  let depth = 0;
  for (const line of text.split(/\r?\n/u)) {
    if (depth === 1) {
      const match = /^\s*([A-Za-z_$][\w$]*)\s*:/u.exec(line);
      if (match?.[1]) keys.push(match[1]);
    }
    for (const ch of line) {
      if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
    }
  }
  return keys;
}

describe("i18n locale files", () => {
  it("declares no duplicate top-level keys", () => {
    for (const file of LOCALE_FILES) {
      const keys = topLevelKeys(file);
      const seen = new Set<string>();
      const dupes = keys.filter((key) => (seen.has(key) ? true : (seen.add(key), false)));
      expect(dupes, `duplicate keys in ${file}`).toEqual([]);
      expect(keys.length).toBeGreaterThan(500);
    }
  });

  it("keeps every key non-empty in every locale", () => {
    for (const [name, dict] of LOCALES) {
      const empty = Object.entries(dict)
        .filter(([, value]) => typeof value === "string" && !value.trim())
        .map(([key]) => key);
      expect(empty, `empty strings in ${name}`).toEqual([]);
    }
  });

  it("keeps every locale key-for-key aligned with zh-CN", () => {
    const zhKeys = new Set(Object.keys(zh));
    for (const [name, dict] of LOCALES) {
      const keys = new Set(Object.keys(dict));
      const missing = [...zhKeys].filter((k) => !keys.has(k));
      const extra = [...keys].filter((k) => !zhKeys.has(k));
      expect(missing, `keys present in zh-CN but missing in ${name}`).toEqual([]);
      expect(extra, `keys present in ${name} but missing in zh-CN`).toEqual([]);
    }
  });
});
