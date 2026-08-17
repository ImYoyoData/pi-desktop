import { describe, expect, it } from "vitest";
import {
  __test,
  piOAuthElectronPlugin,
} from "../../scripts/pi-oauth-electron-plugin";

const SAMPLE = `
const importOAuthModule = (specifier) => {
    const runtimeSpecifier = import.meta.url.endsWith(".js") ? specifier.replace(/\\.ts$/, ".js") : specifier;
    return import(__rewriteRelativeImportExtension(runtimeSpecifier));
};
export const loadOpenAICodexOAuth = async () => {
    return (await importOAuthModule("./openai-codex.ts")).openaiCodexOAuth;
};
`;

describe("piOAuthElectronPlugin", () => {
  it("rewrites variable dynamic import to static import() strings", () => {
    const next = __test.rewriteImportOAuthModule(SAMPLE);
    expect(next).not.toBeNull();
    expect(next!).toContain('return import("./openai-codex.js")');
    expect(next!).toContain('case "./anthropic.ts":');
    expect(next!).not.toContain("import(__rewriteRelativeImportExtension");
  });

  it("transforms pi-ai oauth load.js ids", () => {
    const plugin = piOAuthElectronPlugin();
    const transform = plugin.transform as (
      this: unknown,
      code: string,
      id: string,
    ) => { code: string } | null;
    const out = transform.call(
      {},
      SAMPLE,
      "/x/node_modules/@earendil-works/pi-ai/dist/auth/oauth/load.js",
    );
    expect(out).not.toBeNull();
    expect(out!.code).toContain('import("./openai-codex.js")');
  });

  it("ignores unrelated modules", () => {
    const plugin = piOAuthElectronPlugin();
    const transform = plugin.transform as (
      this: unknown,
      code: string,
      id: string,
    ) => { code: string } | null;
    expect(transform.call({}, SAMPLE, "/x/other/load.js")).toBeNull();
  });
});
