import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { en } from "../../src/renderer/src/i18n/en";
import { zh } from "../../src/renderer/src/i18n/zh-CN";

const dir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../src/renderer/src/i18n",
);

/**
 * Top-level keys of a locale file, in source order.
 *
 * Scanned from the source text rather than from the imported object: a duplicate
 * key is silently collapsed by JS at runtime, so `Object.keys()` can never reveal
 * it — but esbuild/Vite DOES warn about it, and whichever copy wins is arbitrary.
 * That is exactly how a duplicated `lanPublicCopyUrl` shipped.
 */
function topLevelKeys(file: string): string[] {
  const text = fs.readFileSync(path.join(dir, file), "utf8");
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
    for (const file of ["zh-CN.ts", "en.ts"]) {
      const keys = topLevelKeys(file);
      const seen = new Set<string>();
      const dupes = keys.filter((key) => (seen.has(key) ? true : (seen.add(key), false)));
      expect(dupes, `duplicate keys in ${file}`).toEqual([]);
      expect(keys.length).toBeGreaterThan(500);
    }
  });

  it("keeps every key non-empty in both locales", () => {
    for (const [name, dict] of [
      ["zh", zh],
      ["en", en],
    ] as const) {
      const empty = Object.entries(dict)
        .filter(([, value]) => typeof value === "string" && !value.trim())
        .map(([key]) => key);
      expect(empty, `empty strings in ${name}`).toEqual([]);
    }
  });

  it("keeps the two locales key-for-key aligned", () => {
    const zhKeys = new Set(Object.keys(zh));
    const enKeys = new Set(Object.keys(en));
    const missingInEn = [...zhKeys].filter((k) => !enKeys.has(k));
    const missingInZh = [...enKeys].filter((k) => !zhKeys.has(k));
    expect(missingInEn, "keys present in zh-CN but missing in en").toEqual([]);
    expect(missingInZh, "keys present in en but missing in zh-CN").toEqual([]);
  });

  it("does not resurrect the duplicated copy-URL key", () => {
    // `lanPublicCopyUrl` was defined twice (esbuild warned) and never used — the
    // panel reuses `lanConsoleCopy`. It must not come back in either locale.
    expect(topLevelKeys("zh-CN.ts").filter((k) => k === "lanPublicCopyUrl")).toEqual([]);
    expect(topLevelKeys("en.ts").filter((k) => k === "lanPublicCopyUrl")).toEqual([]);
  });
});
