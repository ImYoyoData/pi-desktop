/**
 * Which shell the agent's command tool should use.
 *
 * The Pi SDK's bash tool resolves a shell itself when nobody tells it otherwise,
 * and on Windows its fallback is `where bash.exe` — which finds
 * `C:\Windows\System32\bash.exe`, the **WSL launcher**, not a real bash. Running a
 * command through it then fails with:
 *
 *     execvpe(/bin/bash) failed: No such file or directory
 *
 * which is what happens when no WSL distribution is installed (or WSL itself is
 * broken). Plenty of Windows machines have Git-for-Windows installed but not on
 * PATH, and some have no bash at all — in that case the honest answer is to use
 * PowerShell, which the SDK also ships and which needs no extra install.
 *
 * Pure and injectable so the decision is unit-testable.
 */

import { existsSync } from "node:fs";
import { win32 } from "node:path";

const defaultExists = (file: string): boolean => {
  try {
    return existsSync(file);
  } catch {
    return false;
  }
};

export type CommandShell =  | {
      /** A real bash (Git Bash / MSYS2 / Cygwin): pass through as `shellPath`. */
      kind: "bash";
      shellPath: string;
      /** Short id for logging. */
      id: string;
    }
  | {
      /** No usable bash: the agent uses the PowerShell tool instead. */
      kind: "powershell";
      shellPath: string;
      id: "pwsh" | "powershell";
    }
  | {
      /** Nothing usable was found; the caller keeps the SDK's own behaviour. */
      kind: "unresolved";
      id: "";
    };

/** Does this bash path look like a WSL launcher rather than a real interpreter? */
export function isWslBashPath(file: string): boolean {
  return /[\\/]windowsapps[\\/]|system32[\\/]bash\.exe|syswow64[\\/]bash\.exe/iu.test(file);
}

/** `kind` of a terminal-shell entry that is a genuine bash. */
const REAL_BASH_IDS = new Set(["git-bash", "bash", "msys2", "cygwin"]);

export type ShellCandidate = { id: string; file: string };

/**
 * Pick the shell for the agent's command tool.
 *
 * @param platform  `process.platform`
 * @param shells    result of `findTerminalShells()` — already ordered by
 *                  preference (pwsh, powershell, git-bash, cmd on Windows).
 * @param exists    existence probe (injectable for tests)
 */
export function resolveCommandShell(
  platform: NodeJS.Platform,
  shells: readonly ShellCandidate[],
  exists: (file: string) => boolean = () => true,
): CommandShell {
  if (platform !== "win32") {
    // macOS/Linux always have a POSIX shell to hand to the bash tool.
    return { kind: "unresolved", id: "" };
  }

  // 1. A real bash wins: the bash tool's command syntax is POSIX.
  const bash = shells.find(
    (s) => REAL_BASH_IDS.has(s.id.toLowerCase()) && !isWslBashPath(s.file) && exists(s.file),
  );
  if (bash) return { kind: "bash", shellPath: bash.file, id: bash.id };

  // 2. No bash: use PowerShell, which needs no extra install on Windows.
  const powerShell = shells.find(
    (s) => (s.id === "pwsh" || s.id === "powershell") && exists(s.file),
  );
  if (powerShell) {
    return {
      kind: "powershell",
      shellPath: powerShell.file,
      id: powerShell.id === "pwsh" ? "pwsh" : "powershell",
    };
  }

  // 3. Nothing found: leave the SDK's own resolution alone.
  return { kind: "unresolved", id: "" };
}

/**
 * System-prompt note explaining which command tool to use.
 *
 * The SDK's bash description promises bash syntax; when no bash exists the agent
 * must be told to reach for `powershell` instead of repeatedly failing.
 */
export function commandShellPrompt(shell: CommandShell): string {
  if (shell.kind !== "powershell") return "";
  return `## Shell (Pi Desktop)

This machine has **no usable bash** (the only \`bash.exe\` is the WSL launcher, and
no WSL distribution is installed). Use the \`powershell\` tool for every command
instead of \`bash\`:

- PowerShell syntax, not POSIX: \`Get-ChildItem\` (\`ls\`), \`Get-Content\` (\`cat\`),
  \`Select-String\` (\`grep\`), \`Remove-Item\` (\`rm\`), \`Copy-Item\` (\`cp\`).
- Chain with \`;\` or \`if ($?)\`; use \`$env:NAME\` for environment variables.
- Prefer the dedicated \`read\` / \`write\` / \`edit\` / \`grep\` / \`find\` / \`ls\` tools
  over shell equivalents — they are faster and safer.
- If a tool genuinely requires bash (a \`.sh\` script), say so instead of forcing it
  through PowerShell.
`;
}

/** One-line description for startup logs. */
export function describeCommandShell(shell: CommandShell): string {
  if (shell.kind === "bash") return `bash (${shell.id}) at ${shell.shellPath}`;
  if (shell.kind === "powershell") return `powershell (${shell.id}) at ${shell.shellPath}`;
  return "unresolved (SDK default)";
}

/**
 * A real bash for `shellPath`, or null.
 *
 * Checked in order:
 * 1. `PI_DESKTOP_BASH_SHELL` — set by the main process, which already knows the
 *    machine's shells (see main/terminal-shell.ts).
 * 2. Common Git-for-Windows install locations, which are usually NOT on PATH.
 *
 * The WSL launcher is rejected on purpose: it exists on most Windows boxes but
 * only works when a WSL distribution is actually installed.
 */
export function detectRealBashShell(
  env: NodeJS.ProcessEnv = process.env,
  exists: (file: string) => boolean = defaultExists,
  platform: NodeJS.Platform = process.platform,
): string | null {
  if (platform !== "win32") return null;

  const fromEnv = String(env.PI_DESKTOP_BASH_SHELL ?? "").trim();
  if (fromEnv && !isWslBashPath(fromEnv) && exists(fromEnv)) return fromEnv;

  const candidates = [
    env.ProgramFiles ? win32.join(env.ProgramFiles, "Git", "bin", "bash.exe") : "",
    env["ProgramFiles(x86)"] ? win32.join(env["ProgramFiles(x86)"], "Git", "bin", "bash.exe") : "",
    env.LOCALAPPDATA ? win32.join(env.LOCALAPPDATA, "Programs", "Git", "bin", "bash.exe") : "",
    env.USERPROFILE ? win32.join(env.USERPROFILE, "scoop", "apps", "git", "current", "bin", "bash.exe") : "",
    env.ProgramFiles ? win32.join(env.ProgramFiles, "Git", "usr", "bin", "bash.exe") : "",
  ].filter(Boolean);

  for (const file of candidates) {
    if (!isWslBashPath(file) && exists(file)) return file;
  }
  return null;
}

/**
 * Resolve the shell in a worker process.
 *
 * Order: `PI_DESKTOP_SHELL_ID` (the main process already picks a shell for the
 * terminal with the same precedence) → a real bash found on disk → PowerShell.
 */
export function detectCommandShell(
  env: NodeJS.ProcessEnv = process.env,
  exists: (file: string) => boolean = defaultExists,
  platform: NodeJS.Platform = process.platform,
): CommandShell {
  if (platform !== "win32") return { kind: "unresolved", id: "" };

  const bash = detectRealBashShell(env, exists, platform);
  if (bash) return { kind: "bash", shellPath: bash, id: "git-bash" };

  const powerShell = detectPowerShell(env, exists);
  if (powerShell) return { kind: "powershell", shellPath: powerShell.file, id: powerShell.id };

  return { kind: "unresolved", id: "" };
}

/** PowerShell 7 first, then Windows PowerShell. */
export function detectPowerShell(
  env: NodeJS.ProcessEnv = process.env,
  exists: (file: string) => boolean = defaultExists,
): { id: "pwsh" | "powershell"; file: string } | null {
  const dirs = String(env.PATH ?? "")
    .split(";")
    .map((d) => d.trim().replace(/^"(.*)"$/u, "$1"))
    .filter(Boolean);

  const pwsh = [
    ...dirs.map((dir) => win32.join(dir, "pwsh.exe")),
    env.ProgramFiles ? win32.join(env.ProgramFiles, "PowerShell", "7", "pwsh.exe") : "",
    env.LOCALAPPDATA ? win32.join(env.LOCALAPPDATA, "Microsoft", "WindowsApps", "pwsh.exe") : "",
  ].filter(Boolean);
  for (const file of pwsh) {
    if (exists(file)) return { id: "pwsh", file };
  }

  const powershell = [
    ...dirs.map((dir) => win32.join(dir, "powershell.exe")),
    env.SystemRoot
      ? win32.join(env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
      : "",
  ].filter(Boolean);
  for (const file of powershell) {
    if (exists(file)) return { id: "powershell", file };
  }
  return null;
}
