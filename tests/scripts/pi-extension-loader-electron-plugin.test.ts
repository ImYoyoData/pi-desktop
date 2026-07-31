import { describe, expect, it } from "vitest";
import { piExtensionLoaderElectronPlugin } from "../../scripts/pi-extension-loader-electron-plugin";

describe("piExtensionLoaderElectronPlugin", () => {
  it("forces virtualModules instead of getAliases for Electron CJS", () => {
    const plugin = piExtensionLoaderElectronPlugin();
    const input = `
const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  ...(isBunBinary ? { virtualModules: VIRTUAL_MODULES, tryNative: false } : { alias: getAliases() }),
});
`;
    const transform = plugin.transform as (
      this: unknown,
      code: string,
      id: string,
    ) => { code: string } | null;
    const out = transform.call(
      {},
      input,
      "/x/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js",
    );
    expect(out).not.toBeNull();
    expect(out!.code).toContain("virtualModules: VIRTUAL_MODULES, tryNative: false");
    expect(out!.code).not.toContain("getAliases()");
    expect(out!.code).not.toMatch(/\{\s*virtualModules:\s*VIRTUAL_MODULES/);
  });

  it("rewrites import.meta.resolve to require.resolve", () => {
    const plugin = piExtensionLoaderElectronPlugin();
    const input = `
function getAliases() {
  return fileURLToPath(import.meta.resolve(specifier));
}
const jiti = createJiti(import.meta.url, {
  ...(isBunBinary ? { virtualModules: VIRTUAL_MODULES, tryNative: false } : { alias: getAliases() }),
});
`;
    const transform = plugin.transform as (
      this: unknown,
      code: string,
      id: string,
    ) => { code: string } | null;
    const out = transform.call(
      {},
      input,
      "C:/proj/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js",
    );
    expect(out).not.toBeNull();
    expect(out!.code).toContain("require.resolve(specifier)");
    expect(out!.code).not.toContain("import.meta.resolve");
  });
});
