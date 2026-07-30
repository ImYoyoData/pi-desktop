import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  isBuiltinBrowserToolName,
  resolveBuiltinBrowserSkillDir,
  shouldEnableBuiltinBrowserTools,
} from "../../src/shared/builtin-browser";

describe("shouldEnableBuiltinBrowserTools", () => {
  it("enables when citations are present", () => {
    expect(
      shouldEnableBuiltinBrowserTools("please refactor this", [
        {
          url: "https://example.com",
          selector: "button",
          text: "OK",
          htmlSnippet: "<button>OK</button>",
        },
      ]),
    ).toBe(true);
  });

  it("enables when user mentions 浏览器 or browser", () => {
    expect(shouldEnableBuiltinBrowserTools("用浏览器打开这个页面")).toBe(true);
    expect(shouldEnableBuiltinBrowserTools("Open this in the browser")).toBe(true);
  });

  it("enables for explicit built-in browser", () => {
    expect(shouldEnableBuiltinBrowserTools("请用内置浏览器点一下登录")).toBe(true);
    expect(shouldEnableBuiltinBrowserTools("use the built-in browser")).toBe(true);
  });

  it("enables for selection context / skill body", () => {
    expect(
      shouldEnableBuiltinBrowserTools("Context from browser selection:\n\n### Citation 1"),
    ).toBe(true);
    expect(
      shouldEnableBuiltinBrowserTools("# 内置浏览器 (Built-in browser)\n\nContext from browser selection:"),
    ).toBe(true);
    expect(
      shouldEnableBuiltinBrowserTools("# Built-in browser (Pi Desktop)\n\nUse browser_*"),
    ).toBe(true);
  });

  it("stays off for ordinary network / coding asks", () => {
    expect(shouldEnableBuiltinBrowserTools("抓取 https://example.com 的文档摘要")).toBe(false);
    expect(shouldEnableBuiltinBrowserTools("fix the auth bug in src/main")).toBe(false);
    expect(shouldEnableBuiltinBrowserTools("search npm for lodash")).toBe(false);
  });
});

describe("isBuiltinBrowserToolName", () => {
  it("matches browser_* only", () => {
    expect(isBuiltinBrowserToolName("browser_tabs")).toBe(true);
    expect(isBuiltinBrowserToolName("ask_user")).toBe(false);
    expect(isBuiltinBrowserToolName("bash")).toBe(false);
  });
});

describe("resolveBuiltinBrowserSkillDir", () => {
  it("finds the bundled skill from repo resources", () => {
    const repoWorkerDir = path.resolve(__dirname, "../../out/agent-worker");
    const found = resolveBuiltinBrowserSkillDir(repoWorkerDir);
    expect(found).toBeTruthy();
    expect(fs.existsSync(path.join(found!, "SKILL.md"))).toBe(true);
  });

  it("returns null when missing", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-no-skill-"));
    expect(resolveBuiltinBrowserSkillDir(tmp)).toBeNull();
  });
});
