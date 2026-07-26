export function resolveTerminalShell(
  platform: NodeJS.Platform = process.platform,
  shellEnv: string | undefined = process.env.SHELL,
): string {
  if (platform === "win32") {
    return "powershell.exe";
  }
  return shellEnv || "/bin/zsh";
}
