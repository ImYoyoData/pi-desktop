import { accessSync, constants, readFileSync } from "node:fs";
import { posix, win32 } from "node:path";
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

function firstExecutable(
  candidates: string[],
  exists: (file: string) => boolean,
): string | null {
  return candidates.find((file) => file !== "" && exists(file)) ?? null;
}

/** /etc/shells 是 macOS/Linux 上可用登录 shell 的标准清单；注释与空行在此剔除。 */
function readEtcShells(): string[] {
  try {
    return readFileSync("/etc/shells", "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("/"));
  } catch {
    return [];
  }
}

/**
 * Git for Windows 自带 bash。System32/SysWOW64 下的 bash.exe 是 WSL 启动器，
 * 不是 Git Bash，按目录整段排除以免误报。
 */
function gitBashCandidates(env: NodeJS.ProcessEnv): string[] {
  const installs = [
    env.ProgramFiles ? win32.join(env.ProgramFiles, "Git", "bin", "bash.exe") : "",
    env["ProgramFiles(x86)"] ? win32.join(env["ProgramFiles(x86)"], "Git", "bin", "bash.exe") : "",
    env.LOCALAPPDATA
      ? win32.join(env.LOCALAPPDATA, "Programs", "Git", "bin", "bash.exe")
      : "",
    env.USERPROFILE
      ? win32.join(env.USERPROFILE, "scoop", "apps", "git", "current", "bin", "bash.exe")
      : "",
    env.USERPROFILE ? win32.join(env.USERPROFILE, "scoop", "shims", "bash.exe") : "",
  ];

  const wslDirs = [
    env.SystemRoot ? win32.join(env.SystemRoot, "System32") : "",
    env.SystemRoot ? win32.join(env.SystemRoot, "SysWOW64") : "",
  ]
    .filter(Boolean)
    .map((dir) => dir.toLowerCase());
  const onPath = pathDirs(env.PATH, ";")
    .filter((dir) => !wslDirs.includes(dir.toLowerCase()))
    .map((dir) => win32.join(dir, "bash.exe"));

  return [...installs, ...onPath].filter(Boolean);
}

function windowsShells(
  env: NodeJS.ProcessEnv,
  exists: (file: string) => boolean,
): TerminalShellOption[] {
  const onPath = (name: string): string[] =>
    pathDirs(env.PATH, ";").map((dir) => win32.join(dir, name));

  const shells: TerminalShellOption[] = [];

  const pwsh = firstExecutable(
    [
      ...onPath("pwsh.exe"),
      env.ProgramFiles ? win32.join(env.ProgramFiles, "PowerShell", "7", "pwsh.exe") : "",
      env.ProgramFiles ? win32.join(env.ProgramFiles, "PowerShell", "7-preview", "pwsh.exe") : "",
      env.LOCALAPPDATA
        ? win32.join(env.LOCALAPPDATA, "Microsoft", "WindowsApps", "pwsh.exe")
        : "",
    ],
    exists,
  );
  if (pwsh) shells.push({ id: "pwsh", file: pwsh, args: [] });

  const powershell = firstExecutable(
    [
      ...onPath("powershell.exe"),
      env.SystemRoot
        ? win32.join(env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
        : "",
      env.SystemRoot
        ? win32.join(env.SystemRoot, "SysWOW64", "WindowsPowerShell", "v1.0", "powershell.exe")
        : "",
    ],
    exists,
  );
  if (powershell) shells.push({ id: "powershell", file: powershell, args: [] });

  // --login 才会加载 Git Bash 的 /etc/profile，PATH 里才有 mingw64 工具链。
  const gitBash = firstExecutable(gitBashCandidates(env), exists);
  if (gitBash) shells.push({ id: "git-bash", file: gitBash, args: ["--login", "-i"] });

  const cmd = firstExecutable(
    [
      env.ComSpec?.trim() ?? "",
      ...onPath("cmd.exe"),
      env.SystemRoot ? win32.join(env.SystemRoot, "System32", "cmd.exe") : "",
    ],
    exists,
  );
  if (cmd) shells.push({ id: "cmd", file: cmd, args: [] });

  return shells;
}

function unixShells(
  env: NodeJS.ProcessEnv,
  exists: (file: string) => boolean,
  systemShells: string[],
): TerminalShellOption[] {
  // Homebrew / 手动安装的 pwsh 不在 Finder 启动时的精简 PATH 上，需显式兜底。
  const pwsh = firstExecutable(
    [
      ...pathDirs(env.PATH, ":").map((dir) => posix.join(dir, "pwsh")),
      "/opt/homebrew/bin/pwsh",
      "/usr/local/bin/pwsh",
      "/usr/bin/pwsh",
      "/snap/bin/pwsh",
      "/opt/microsoft/powershell/7/pwsh",
    ],
    exists,
  );

  // 登录 shell 必须用绝对路径，顺带过滤掉未设置的 $SHELL。
  const candidates = [
    env.SHELL?.trim() ?? "",
    ...systemShells,
    "/bin/zsh",
    "/bin/bash",
    "/bin/sh",
    ...(pwsh ? [pwsh] : []),
  ].filter((file) => file.startsWith("/"));

  const shells: TerminalShellOption[] = [];
  const seenIds = new Set<string>();
  for (const file of candidates) {
    // id 即下拉菜单的 key，同名 shell 只保留先出现的一个。
    const id = posix.basename(file);
    if (seenIds.has(id) || !exists(file)) continue;
    seenIds.add(id);
    shells.push({ id, file, args: ["-l"] });
  }
  return shells;
}

/**
 * 本机可用的 shell 列表。
 * Windows：PowerShell 7+、Windows PowerShell、cmd。
 * macOS/Linux：$SHELL 优先，其后为 /etc/shells 与常见安装位置（含 pwsh）。
 */
export function findTerminalShells(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  exists: (file: string) => boolean = isExecutable,
  systemShells?: string[],
): TerminalShellOption[] {
  if (platform === "win32") return windowsShells(env, exists);
  return unixShells(env, exists, systemShells ?? readEtcShells());
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

/**
 * Absolute path of a real bash (Git Bash / MSYS2 / Cygwin), or null.
 *
 * Exported for the agent worker: its bash tool needs a genuine interpreter, and
 * this module already knows how to find one — including installs on a non-system
 * drive, which a `%ProgramFiles%`-only probe misses (Git is commonly installed on
 * D: when the system drive is small).
 */
export function findRealBashPath(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  exists: (file: string) => boolean = isExecutable,
): string | null {
  if (platform !== "win32") return null;
  return firstExecutable(gitBashCandidates(env), exists);
}

export function resolveTerminalShell(
  shellId?: string | null,
  shells: TerminalShellOption[] = findTerminalShells(),
): ResolvedTerminalShell {
  const picked = pickTerminalShell(shells, shellId);
  if (picked) return { file: picked.file, args: picked.args };
  return process.platform === "win32"
    ? { file: "powershell.exe", args: [] }
    : { file: "/bin/sh", args: ["-l"] };
}
