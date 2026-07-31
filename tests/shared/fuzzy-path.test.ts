import { describe, expect, it } from "vitest";
import {
  rankFuzzyPathEntries,
  scoreFuzzyPathQuery,
} from "../../src/shared/fuzzy-path";

describe("scoreFuzzyPathQuery", () => {
  it("matches contiguous substring", () => {
    expect(scoreFuzzyPathQuery("composer", "Composer.vue", "src/Composer.vue")).not.toBeNull();
  });

  it("matches camelCase / acronym queries", () => {
    const score = scoreFuzzyPathQuery(
      "cafm",
      "ComposerAtFileMenu.vue",
      "src/components/ComposerAtFileMenu.vue",
    );
    expect(score).not.toBeNull();
    // Prefer basename acronym over a weak deep path hit
    const weak = scoreFuzzyPathQuery(
      "cafm",
      "other.ts",
      "src/c/a/f/m/other.ts",
    );
    expect(score!).toBeLessThan(weak!);
  });

  it("matches multi-token queries across path segments", () => {
    expect(
      scoreFuzzyPathQuery("comp vue", "Composer.vue", "src/components/Composer.vue"),
    ).not.toBeNull();
    expect(
      scoreFuzzyPathQuery("src/comp", "Composer.vue", "src/components/Composer.vue"),
    ).not.toBeNull();
  });

  it("rejects non-matching queries", () => {
    expect(scoreFuzzyPathQuery("zzzz", "Composer.vue", "src/Composer.vue")).toBeNull();
  });
});

describe("rankFuzzyPathEntries", () => {
  it("ranks basename hits above path-only hits", () => {
    const ranked = rankFuzzyPathEntries("composer", [
      { name: "readme.md", path: "company/readme.md", kind: "file" as const },
      { name: "Composer.vue", path: "src/components/Composer.vue", kind: "file" as const },
      { name: "components", path: "src/components", kind: "dir" as const },
    ]);
    expect(ranked[0]?.path).toBe("src/components/Composer.vue");
  });

  it("matches short fuzzy queries against long camelCase names", () => {
    const ranked = rankFuzzyPathEntries("caf", [
      { name: "cache.ts", path: "src/cache.ts", kind: "file" as const },
      {
        name: "ComposerAtFileMenu.vue",
        path: "src/components/ComposerAtFileMenu.vue",
        kind: "file" as const,
      },
    ]);
    expect(ranked[0]?.name).toBe("ComposerAtFileMenu.vue");
  });
});
