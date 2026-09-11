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

/** 只认这些路径存在的假文件系统，保持用例与宿主平台无关。 */
const onlyFiles =
  (...files: string[]) =>
  (file: string): boolean =>
    files.includes(file);

const darwinEtcShells = ["/bin/sh", "/bin/bash", "/bin/zsh", "/opt/homebrew/bin/fish"];
const linuxEtcShells = ["/bin/sh", "/bin/bash", "/usr/bin/zsh", "/usr/bin/fish"];

describe("findTerminalShells (Windows)", () => {
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

  it("always builds backslash paths, whatever the host platform", () => {
    const shells = findTerminalShells("win32", winEnv, windowsExists);
    for (const shell of shells) {
      expect(shell.file).not.toContain("/");
    }
  });
});

describe("findTerminalShells (macOS)", () => {
  it("puts $SHELL first, then /etc/shells entries, with login args", () => {
    const shells = findTerminalShells(
      "darwin",
      { SHELL: "/bin/zsh", PATH: "/usr/bin:/bin" },
      onlyFiles(...darwinEtcShells),
      darwinEtcShells,
    );
    expect(shells.map((shell) => shell.id)).toEqual(["zsh", "sh", "bash", "fish"]);
    expect(shells[0]).toEqual({ id: "zsh", file: "/bin/zsh", args: ["-l"] });
  });

  it("offers Homebrew pwsh alongside the default zsh", () => {
    const homebrew = "/opt/homebrew/bin/pwsh";
    const shells = findTerminalShells(
      "darwin",
      { SHELL: "/bin/zsh", PATH: "/opt/homebrew/bin:/usr/bin:/bin" },
      onlyFiles("/bin/zsh", homebrew, ...darwinEtcShells),
      darwinEtcShells,
    );
    expect(pickTerminalShell(shells)?.id).toBe("zsh");
    expect(shells.find((shell) => shell.id === "pwsh")?.file).toBe(homebrew);
  });

  it("finds pwsh even when the GUI PATH omits Homebrew", () => {
    const homebrew = "/opt/homebrew/bin/pwsh";
    const shells = findTerminalShells(
      "darwin",
      // Finder 启动的应用 PATH 常缺 /opt/homebrew/bin，兜底清单必须覆盖。
      { SHELL: "/bin/zsh", PATH: "/usr/bin:/bin:/usr/sbin:/sbin" },
      onlyFiles("/bin/zsh", homebrew, ...darwinEtcShells),
      darwinEtcShells,
    );
    expect(shells.find((shell) => shell.id === "pwsh")?.file).toBe(homebrew);
  });

  it("drops duplicates between $SHELL and /etc/shells", () => {
    const shells = findTerminalShells(
      "darwin",
      { SHELL: "/bin/bash" },
      onlyFiles("/bin/bash"),
      ["/bin/bash", "/bin/bash"],
    );
    expect(shells.map((shell) => shell.id)).toEqual(["bash"]);
  });
});

describe("findTerminalShells (Linux)", () => {
  it("uses $SHELL, then /etc/shells, and offers pwsh when installed", () => {
    const shells = findTerminalShells(
      "linux",
      { SHELL: "/bin/bash", PATH: "/usr/bin:/bin" },
      onlyFiles("/bin/bash", "/bin/sh", "/usr/bin/zsh", "/usr/bin/fish", "/usr/bin/pwsh"),
      linuxEtcShells,
    );
    expect(shells.map((shell) => shell.id)).toEqual(["bash", "sh", "zsh", "fish", "pwsh"]);
    expect(shells[0]).toEqual({ id: "bash", file: "/bin/bash", args: ["-l"] });
  });

  it("finds a snap-installed pwsh", () => {
    const snap = "/snap/bin/pwsh";
    const shells = findTerminalShells(
      "linux",
      { SHELL: "/bin/bash", PATH: "/usr/bin:/bin" },
      onlyFiles("/bin/bash", snap),
      ["/bin/bash"],
    );
    expect(shells.find((shell) => shell.id === "pwsh")?.file).toBe(snap);
  });

  it("ignores relative $SHELL values", () => {
    const shells = findTerminalShells(
      "linux",
      { SHELL: "bash" },
      onlyFiles("/bin/sh"),
      ["/bin/sh"],
    );
    expect(shells.map((shell) => shell.id)).toEqual(["sh"]);
  });
});

describe("pickTerminalShell", () => {
  const shells = findTerminalShells("win32", winEnv, windowsExists);

  it("picks the requested shell by id", () => {
    expect(pickTerminalShell(shells, "cmd")?.id).toBe("cmd");
  });

  it("falls back to the first shell for an unknown id", () => {
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

  it("falls back to a POSIX shell when nothing is detected", () => {
    expect(resolveTerminalShell(null, [])).toEqual(
      process.platform === "win32"
        ? { file: "powershell.exe", args: [] }
        : { file: "/bin/sh", args: ["-l"] },
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

// /etc/shells 解析在真实系统上跑，守护注释/空行过滤。
const unixOnly = process.platform === "win32" ? it.skip : it;

unixOnly("reads /etc/shells on this machine", () => {
  const shells = findTerminalShells();
  expect(shells.length).toBeGreaterThan(0);
  for (const shell of shells) {
    expect(shell.file.startsWith("/")).toBe(true);
    expect(shell.args).toEqual(["-l"]);
  }
});
