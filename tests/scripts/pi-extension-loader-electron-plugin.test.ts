import { describe, expect, it } from "vitest";
import { piExtensionLoaderElectronPlugin } from "../../scripts/pi-extension-loader-electron-plugin";

type Transform = (this: unknown, code: string, id: string) => { code: string } | null;
type RenderChunk = (this: unknown, code: string) => { code: string } | null;

const LOADER_ID =
  "/x/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js";

const RESOLUTION_OPTIONS = `const resolutionOptions = usesEmbeddedModules
  ? { virtualModules: await getVirtualModules(), tryNative: false }
  : isTypeScriptSourceRuntime
    ? { virtualModules: await getVirtualModules(), tsconfigPaths: true }
    : { alias: getAliases() };`;

describe("piExtensionLoaderElectronPlugin", () => {
  it("replaces the getAliases fallback with virtualModules", () => {
    const plugin = piExtensionLoaderElectronPlugin();
    const transform = plugin.transform as Transform;
    const out = transform.call({}, RESOLUTION_OPTIONS, LOADER_ID);
    expect(out).not.toBeNull();
    expect(out!.code).toContain(
      "{ virtualModules: await getVirtualModules(), tryNative: false }",
    );
    expect(out!.code).not.toContain("getAliases()");
  });

  it("rewrites the bundled chunk through renderChunk", () => {
    const plugin = piExtensionLoaderElectronPlugin();
    const renderChunk = plugin.renderChunk as RenderChunk;
    const bundled = RESOLUTION_OPTIONS.replace(/\n\s*/g, " ");
    const out = renderChunk.call({}, bundled);
    expect(out).not.toBeNull();
    expect(out!.code).not.toContain("getAliases()");
  });

  it("leaves unrelated code untouched", () => {
    const plugin = piExtensionLoaderElectronPlugin();
    const transform = plugin.transform as Transform;
    const renderChunk = plugin.renderChunk as RenderChunk;
    expect(transform.call({}, "const x = 1;", LOADER_ID)).toBeNull();
    expect(renderChunk.call({}, "const x = 1;")).toBeNull();
  });
});
