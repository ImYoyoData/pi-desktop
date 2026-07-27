export type ResolvedTerminalShell = {
  file: string;
  /** Args passed to pty.spawn (e.g. login shell on macOS/Linux). */
  args: string[];
};

/**
 * Resolve the interactive shell for the embedded terminal.
 * macOS/Linux use a login shell (-l) so PATH includes Homebrew / nvm / etc.
 */
export function resolveTerminalShell(
  platform: NodeJS.Platform = process.platform,
  shellEnv: string | undefined = process.env.SHELL,
): ResolvedTerminalShell {
  if (platform === "win32") {
    return { file: "powershell.exe", args: [] };
  }
  const file = shellEnv && shellEnv.trim() ? shellEnv.trim() : "/bin/zsh";
  return { file, args: ["-l"] };
}
