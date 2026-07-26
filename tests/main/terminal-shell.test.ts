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
    expect(resolveTerminalShell("darwin", undefined)).toBe("/bin/zsh");
  });
});
