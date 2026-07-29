import { describe, expect, it } from "vitest";
import { languageFromPath } from "../../src/renderer/src/utils/editor-lang";
import {
  pathBasename,
  uniquePreviewTabLabel,
} from "../../src/renderer/src/utils/preview-tab-label";

describe("uniquePreviewTabLabel", () => {
  it("uses basename when unique", () => {
    expect(uniquePreviewTabLabel("src/a.ts", ["lib/b.ts"])).toBe("a.ts");
  });

  it("adds parent when basename collides", () => {
    expect(uniquePreviewTabLabel("src/index.ts", ["lib/index.ts"])).toBe("src/index.ts");
    expect(uniquePreviewTabLabel("lib/index.ts", ["src/index.ts"])).toBe("lib/index.ts");
  });

  it("deepens path until unique", () => {
    expect(
      uniquePreviewTabLabel("a/src/index.ts", ["b/src/index.ts", "c/other.ts"]),
    ).toBe("a/src/index.ts");
  });

  it("normalizes backslashes", () => {
    expect(pathBasename("foo\\bar\\baz.env")).toBe("baz.env");
    expect(uniquePreviewTabLabel("foo\\index.ts", ["bar/index.ts"])).toBe("foo/index.ts");
  });
});

describe("languageFromPath env/json", () => {
  it("maps dotenv variants", () => {
    expect(languageFromPath(".env")).toBe("dotenv");
    expect(languageFromPath(".env.local")).toBe("dotenv");
    expect(languageFromPath("config.env")).toBe("dotenv");
  });

  it("maps json and json5", () => {
    expect(languageFromPath("a.json")).toBe("json");
    expect(languageFromPath("a.json5")).toBe("json5");
    expect(languageFromPath("tsconfig.jsonc")).toBe("json5");
  });
});
