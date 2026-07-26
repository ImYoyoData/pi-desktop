import { describe, expect, it } from "vitest";
import { resolveTerminalShell } from "../../src/main/terminal-shell";

describe("resolveTerminalShell", () => {
  it("uses powershell on Windows", () => {
    expect(resolveTerminalShell("win32", "/bin/bash")).toBe("powershell.exe");
  });

  it("uses SHELL on macOS when set", () => {
    expect(resolveTerminalShell("darwin", "/bin/fish")).toBe("/bin/fish");
  });

  it("defaults to zsh on macOS when SHELL unset", () => {
    // Pass "" — explicit `undefined` still triggers the default param (= process.env.SHELL).
    expect(resolveTerminalShell("darwin", "")).toBe("/bin/zsh");
  });
});
