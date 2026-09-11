import { accessSync, constants } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  findTerminalShells,
  pickTerminalShell,
  resolveTerminalShell,
} from "../../src/main/terminal-shell";

const winEnv: NodeJS.ProcessEnv = {
  PATH: "C:\\Windows\\System32;C:\\Program Files\\PowerShell\\7",
  ProgramFiles: "C:\\Program Files",
  SystemRoot: "C:\\Windows",
  ComSpec: "C:\\Windows\\System32\\cmd.exe",
  LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local",
};

const windowsExists = (file: string): boolean =>
  [
    "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
    "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    "C:\\Windows\\System32\\cmd.exe",
  ].some((real) => real.toLowerCase() === file.toLowerCase());

describe("findTerminalShells", () => {
  it("orders Windows shells as pwsh, Windows PowerShell, then cmd", () => {
    const shells = findTerminalShells("win32", winEnv, windowsExists);
    expect(shells.map((shell) => shell.id)).toEqual(["pwsh", "powershell", "cmd"]);
    expect(shells[0]?.file).toBe("C:\\Program Files\\PowerShell\\7\\pwsh.exe");
  });

  it("skips pwsh when it is not installed", () => {
    const shells = findTerminalShells(
      "win32",
      winEnv,
      (file) => !file.toLowerCase().endsWith("pwsh.exe"),
    );
    expect(shells.map((shell) => shell.id)).toEqual(["powershell", "cmd"]);
  });

  it("prefers SHELL on unix and always passes -l", () => {
    const shells = findTerminalShells(
      "darwin",
      { SHELL: "/bin/fish" },
      (file) => file === "/bin/fish" || file === "/bin/zsh",
    );
    expect(shells.map((shell) => shell.id)).toEqual(["fish", "zsh"]);
    expect(shells[0]).toEqual({ id: "fish", file: "/bin/fish", args: ["-l"] });
  });
});

describe("pickTerminalShell", () => {
  it("picks the requested shell by id", () => {
    const shells = findTerminalShells("win32", winEnv, windowsExists);
    expect(pickTerminalShell(shells, "cmd")?.id).toBe("cmd");
  });

  it("falls back to the first shell for an unknown id", () => {
    const shells = findTerminalShells("win32", winEnv, windowsExists);
    expect(pickTerminalShell(shells, "nope")?.id).toBe("pwsh");
    expect(pickTerminalShell(shells)?.id).toBe("pwsh");
  });
});

describe("resolveTerminalShell", () => {
  const shells = findTerminalShells("win32", winEnv, windowsExists);

  it("resolves the Windows default to PowerShell 7+", () => {
    expect(resolveTerminalShell(null, shells)).toEqual({
      file: "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
      args: [],
    });
  });

  it("resolves an explicitly requested shell", () => {
    expect(resolveTerminalShell("cmd", shells)).toEqual({
      file: "C:\\Windows\\System32\\cmd.exe",
      args: [],
    });
  });

  it("falls back to a platform default when nothing is detected", () => {
    expect(resolveTerminalShell(null, [])).toEqual(
      process.platform === "win32"
        ? { file: "powershell.exe", args: [] }
        : { file: "/bin/zsh", args: ["-l"] },
    );
  });
});

// WindowsApps 下的 pwsh 是 AppExecLink 别名，existsSync/statSync 会 EACCES，
// 只能用 access(X_OK) 判定；这条断言守护该平台差异。
const win32Only = process.platform === "win32" ? it : it.skip;

win32Only("detects pwsh whenever it is executable on PATH", () => {
  const aliasOnPath = (process.env.PATH ?? "")
    .split(";")
    .map((dir) => dir.trim().replace(/^"(.*)"$/, "$1"))
    .filter(Boolean)
    .some((dir) => {
      try {
        accessSync(join(dir, "pwsh.exe"), constants.X_OK);
        return true;
      } catch {
        return false;
      }
    });
  const hasPwsh = findTerminalShells("win32").some((shell) => shell.id === "pwsh");
  expect(hasPwsh).toBe(aliasOnPath);
});
