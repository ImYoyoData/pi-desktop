import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addAgentNpmExtension,
  listAgentNpmExtensions,
  npmNameFromSource,
  removeAgentNpmExtension,
} from "../../src/main/agent-npm-extensions";

describe("agent-npm-extensions", () => {
  let tmp: string;
  let prevAgentDir: string | undefined;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-desk-npm-ext-"));
    prevAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = tmp;
    fs.mkdirSync(path.join(tmp, "npm", "node_modules"), { recursive: true });
  });

  afterEach(() => {
    if (prevAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = prevAgentDir;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("lists deps of the pi-extensions package", () => {
    fs.writeFileSync(
      path.join(tmp, "npm", "package.json"),
      JSON.stringify({ name: "pi-extensions", dependencies: { "pi-subagents": "^0.37.0", "@remnic/plugin-pi": "^9.45.5" } }),
      "utf8",
    );
    const exts = listAgentNpmExtensions();
    expect(exts.map((e) => e.name)).toEqual(["pi-subagents", "@remnic/plugin-pi"]);
  });

  it("addAgentNpmExtension records a dependency", () => {
    addAgentNpmExtension("pi-web-access");
    const pkg = JSON.parse(fs.readFileSync(path.join(tmp, "npm", "package.json"), "utf8"));
    expect(pkg.dependencies["pi-web-access"]).toBe("*");
  });

  it("removeAgentNpmExtension drops the dep and its node_modules folder", () => {
    addAgentNpmExtension("@remnic/plugin-pi");
    fs.mkdirSync(path.join(tmp, "npm", "node_modules", "@remnic", "plugin-pi"), {
      recursive: true,
    });
    expect(removeAgentNpmExtension("@remnic/plugin-pi")).toBe(true);
    const pkg = JSON.parse(fs.readFileSync(path.join(tmp, "npm", "package.json"), "utf8"));
    expect(pkg.dependencies["@remnic/plugin-pi"]).toBeUndefined();
    expect(fs.existsSync(path.join(tmp, "npm", "node_modules", "@remnic"))).toBe(false);
    expect(removeAgentNpmExtension("missing-pkg")).toBe(false);
  });

  it("npmNameFromSource extracts safe package names", () => {
    expect(npmNameFromSource("npm:pi-subagents")).toBe("pi-subagents");
    expect(npmNameFromSource("@remnic/plugin-pi")).toBe("@remnic/plugin-pi");
    expect(npmNameFromSource("npm:@scope/pkg")).toBe("@scope/pkg");
    expect(npmNameFromSource("git:https://x")).toBeNull();
    expect(npmNameFromSource("a b")).toBeNull();
  });
});
