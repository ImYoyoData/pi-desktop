import { describe, expect, it } from "vitest";
import {
  commandShellPrompt,
  describeCommandShell,
  detectCommandShell,
  detectRealBashShell,
  isWslBashPath,
  resolveCommandShell,
  type ShellCandidate,
} from "../../src/agent-worker/command-shell";

/**
 * Windows has no bash by default, and the only `bash.exe` most machines have is
 * the WSL launcher. Trusting it produced:
 *
 *     execvpe(/bin/bash) failed: No such file or directory
 *
 * so the tool must be pointed at a real bash, or fall back to PowerShell.
 */
describe("isWslBashPath", () => {
  it("flags the WSL launcher and the WindowsApps stub", () => {
    expect(isWslBashPath("C:\\Windows\\System32\\bash.exe")).toBe(true);
    expect(isWslBashPath("C:\\Windows\\SysWOW64\\bash.exe")).toBe(true);
    expect(isWslBashPath("C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps\\bash.exe")).toBe(true);
  });

  it("does not flag a real Git Bash", () => {
    expect(isWslBashPath("C:\\Program Files\\Git\\bin\\bash.exe")).toBe(false);
    expect(isWslBashPath("C:\\Program Files\\Git\\usr\\bin\\bash.exe")).toBe(false);
  });
});

describe("resolveCommandShell (win32)", () => {
  const wslOnly: ShellCandidate[] = [
    { id: "bash", file: "C:\\Windows\\System32\\bash.exe" },
  ];

  it("prefers PowerShell when the only bash is the WSL launcher", () => {
    const shell = resolveCommandShell("win32", [
      { id: "pwsh", file: "C:\\Program Files\\PowerShell\\7\\pwsh.exe" },
      ...wslOnly,
    ]);
    expect(shell.kind).toBe("powershell");
    expect(shell.id).toBe("pwsh");
  });

  it("uses a real bash when one exists (POSIX syntax expected by the tool)", () => {
    const shell = resolveCommandShell("win32", [
      { id: "pwsh", file: "C:\\Program Files\\PowerShell\\7\\pwsh.exe" },
      { id: "git-bash", file: "C:\\Program Files\\Git\\bin\\bash.exe" },
    ]);
    expect(shell.kind).toBe("bash");
    expect(shell.shellPath).toBe("C:\\Program Files\\Git\\bin\\bash.exe");
  });

  it("never returns the WSL launcher as a bash", () => {
    const shell = resolveCommandShell("win32", wslOnly);
    // No PowerShell on this box either, so the SDK default stays in place — the
    // important part is that the launcher is never handed over as a bash.
    expect(shell.kind).toBe("unresolved");
    expect("shellPath" in shell ? shell.shellPath : "").not.toContain("System32");
  });

  it("falls back to Windows PowerShell when pwsh is absent", () => {
    const shell = resolveCommandShell("win32", [
      { id: "powershell", file: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" },
      ...wslOnly,
    ]);
    expect(shell).toMatchObject({ kind: "powershell", id: "powershell" });
  });

  it("stays unresolved when nothing usable is found (SDK default wins)", () => {
    expect(resolveCommandShell("win32", []).kind).toBe("unresolved");
  });

  it("checks existence, so a stale PATH entry is skipped", () => {
    const shells: ShellCandidate[] = [
      { id: "git-bash", file: "C:\\Gone\\bash.exe" },
      { id: "pwsh", file: "C:\\pwsh.exe" },
    ];
    const shell = resolveCommandShell("win32", shells, (f) => f === "C:\\pwsh.exe");
    expect(shell.kind).toBe("powershell");
  });
});

describe("resolveCommandShell (non-Windows)", () => {
  it("leaves the SDK's POSIX behaviour alone", () => {
    expect(resolveCommandShell("darwin", []).kind).toBe("unresolved");
    expect(resolveCommandShell("linux", [{ id: "bash", file: "/bin/bash" }]).kind).toBe("unresolved");
  });
});

describe("detectRealBashShell", () => {
  it("honours the main process hint when it points at a real bash", () => {
    const env = { PI_DESKTOP_BASH_SHELL: "D:\\tools\\git\\bin\\bash.exe" } as NodeJS.ProcessEnv;
    expect(detectRealBashShell(env, () => true, "win32")).toBe("D:\\tools\\git\\bin\\bash.exe");
  });

  it("rejects a WSL hint", () => {
    const env = { PI_DESKTOP_BASH_SHELL: "C:\\Windows\\System32\\bash.exe" } as NodeJS.ProcessEnv;
    expect(detectRealBashShell(env, () => true, "win32")).toBeNull();
  });

  it("finds Git for Windows in its default install locations", () => {
    const env = { ProgramFiles: "C:\\Program Files" } as NodeJS.ProcessEnv;
    const file = detectRealBashShell(env, (p) => p === "C:\\Program Files\\Git\\bin\\bash.exe", "win32");
    expect(file).toBe("C:\\Program Files\\Git\\bin\\bash.exe");
  });

  it("returns null off Windows and when nothing exists", () => {
    expect(detectRealBashShell({} as NodeJS.ProcessEnv, () => true, "linux")).toBeNull();
    expect(detectRealBashShell({} as NodeJS.ProcessEnv, () => false, "win32")).toBeNull();
  });
});

describe("detectCommandShell", () => {
  it("off Windows does nothing", () => {
    expect(detectCommandShell({}, () => true, "darwin").kind).toBe("unresolved");
  });

  it("uses PowerShell on a Windows box with no real bash", () => {
    const env = {
      SystemRoot: "C:\\Windows",
      PATH: "C:\\Windows\\System32",
    } as NodeJS.ProcessEnv;
    const shell = detectCommandShell(env, (p) => p.endsWith("powershell.exe"), "win32");
    expect(shell).toMatchObject({ kind: "powershell", id: "powershell" });
  });
});

describe("prompt + logging helpers", () => {
  it("tells the agent to use PowerShell when bash is unavailable", () => {
    const prompt = commandShellPrompt({ kind: "powershell", shellPath: "C:\\pwsh.exe", id: "pwsh" });
    expect(prompt).toContain("powershell");
    expect(prompt).toContain("Get-ChildItem");
    // Must warn about POSIX syntax so the model does not emit bash-isms.
    expect(prompt).toContain("not POSIX");
  });

  it("adds nothing when a real bash is in use", () => {
    expect(commandShellPrompt({ kind: "bash", shellPath: "C:\\bash.exe", id: "git-bash" })).toBe("");
    expect(commandShellPrompt({ kind: "unresolved", id: "" })).toBe("");
  });

  it("describes the choice for logs", () => {
    expect(describeCommandShell({ kind: "bash", shellPath: "C:\\bash.exe", id: "git-bash" })).toContain("bash");
    expect(describeCommandShell({ kind: "powershell", shellPath: "C:\\pwsh.exe", id: "pwsh" })).toContain(
      "powershell",
    );
    expect(describeCommandShell({ kind: "unresolved", id: "" })).toContain("unresolved");
  });
});
