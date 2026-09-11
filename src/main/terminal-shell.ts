import { accessSync, constants } from "node:fs";
import { basename, join } from "node:path";
import type { TerminalShellOption } from "../shared/protocol";

export type ResolvedTerminalShell = {
  file: string;
  /** Args passed to pty.spawn (e.g. login shell on macOS/Linux). */
  args: string[];
};

function isExecutable(file: string): boolean {
  // WindowsApps 下的 pwsh 是 AppExecLink 别名，existsSync/statSync 会 EACCES。
  try {
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function pathDirs(pathEnv: string | undefined, separator: string): string[] {
  return (pathEnv ?? "")
    .split(separator)
    .map((dir) => dir.trim().replace(/^"(.*)"$/, "$1"))
    .filter(Boolean);
}

function windowsShells(
  env: NodeJS.ProcessEnv,
  exists: (file: string) => boolean,
): TerminalShellOption[] {
  const dirs = pathDirs(env.PATH, ";");
  const find = (name: string, fallbacks: string[]): string | null => {
    for (const dir of dirs) {
      const candidate = join(dir, name);
      if (exists(candidate)) return candidate;
    }
    return fallbacks.find((file) => file && exists(file)) ?? null;
  };

  const shells: TerminalShellOption[] = [];
  const pwsh = find("pwsh.exe", [
    env.ProgramFiles ? join(env.ProgramFiles, "PowerShell", "7", "pwsh.exe") : "",
    env.ProgramFiles ? join(env.ProgramFiles, "PowerShell", "7-preview", "pwsh.exe") : "",
    env.LOCALAPPDATA ? join(env.LOCALAPPDATA, "Microsoft", "WindowsApps", "pwsh.exe") : "",
  ]);
  if (pwsh) shells.push({ id: "pwsh", file: pwsh, args: [] });

  const powershell = find("powershell.exe", [
    env.SystemRoot ? join(env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe") : "",
    env.SystemRoot ? join(env.SystemRoot, "SysWOW64", "WindowsPowerShell", "v1.0", "powershell.exe") : "",
  ]);
  if (powershell) {
    shells.push({ id: "powershell", file: powershell, args: [] });
  }

  const cmd = env.ComSpec?.trim() || (env.SystemRoot ? join(env.SystemRoot, "System32", "cmd.exe") : "");
  if (cmd && exists(cmd)) shells.push({ id: "cmd", file: cmd, args: [] });

  return shells;
}

function unixShells(
  env: NodeJS.ProcessEnv,
  exists: (file: string) => boolean,
): TerminalShellOption[] {
  const candidates = [env.SHELL?.trim(), "/bin/zsh", "/bin/bash", "/bin/sh"].filter(
    (file): file is string => Boolean(file),
  );
  const seen = new Set<string>();
  const shells: TerminalShellOption[] = [];
  for (const file of candidates) {
    if (seen.has(file) || !exists(file)) continue;
    seen.add(file);
    shells.push({ id: basename(file), file, args: ["-l"] });
  }
  if (!shells.length) {
    const file = candidates[0] ?? "/bin/sh";
    shells.push({ id: basename(file), file, args: ["-l"] });
  }
  return shells;
}

/** 本机可用的 shell 列表；Windows 顺序为 PowerShell 7+、Windows PowerShell、cmd。 */
export function findTerminalShells(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  exists: (file: string) => boolean = isExecutable,
): TerminalShellOption[] {
  return platform === "win32" ? windowsShells(env, exists) : unixShells(env, exists);
}

/** 按 id 选择 shell，未指定或未检测到时取首个（Windows 即 PowerShell 7+）。 */
export function pickTerminalShell(
  shells: TerminalShellOption[],
  shellId?: string | null,
): TerminalShellOption | null {
  if (shellId) {
    const picked = shells.find((shell) => shell.id === shellId);
    if (picked) return picked;
  }
  return shells[0] ?? null;
}

export function resolveTerminalShell(
  shellId?: string | null,
  shells: TerminalShellOption[] = findTerminalShells(),
): ResolvedTerminalShell {
  const picked = pickTerminalShell(shells, shellId);
  if (picked) return { file: picked.file, args: picked.args };
  return process.platform === "win32"
    ? { file: "powershell.exe", args: [] }
    : { file: "/bin/zsh", args: ["-l"] };
}
