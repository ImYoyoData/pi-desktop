import { describe, expect, it } from "vitest";
import { resolveTerminalShell } from "../../src/main/terminal-shell";

describe("resolveTerminalShell", () => {
  it("uses powershell on Windows", () => {
    expect(resolveTerminalShell("win32", "/bin/bash")).toEqual({
      file: "powershell.exe",
      args: [],
    });
  });

  it("uses SHELL on macOS when set, as a login shell", () => {
    expect(resolveTerminalShell("darwin", "/bin/fish")).toEqual({
      file: "/bin/fish",
      args: ["-l"],
    });
  });

  it("defaults to zsh login shell on macOS when SHELL unset", () => {
    // Pass "" — explicit `undefined` still triggers the default param (= process.env.SHELL).
    expect(resolveTerminalShell("darwin", "")).toEqual({
      file: "/bin/zsh",
      args: ["-l"],
    });
  });
});
