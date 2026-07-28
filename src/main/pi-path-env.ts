import { homedir } from "node:os";
import path from "node:path";

/** Ensure Electron workers can resolve npm/pnpm/bun like an interactive shell. */
export function augmentPathForPiCli(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const home = env.HOME || env.USERPROFILE || homedir();
  const sep = process.platform === "win32" ? ";" : ":";
  // Prefer PATH; on Windows Electron may expose Path
  const current =
    env.PATH || env.Path || process.env.PATH || process.env.Path || "";
  const extras: string[] = [];
  if (process.platform === "win32") {
    const appData = env.APPDATA || path.join(home, "AppData", "Roaming");
    const local = env.LOCALAPPDATA || path.join(home, "AppData", "Local");
    extras.push(
      path.join(appData, "npm"),
      path.join(local, "bun", "bin"),
      path.join(home, "AppData", "Roaming", "npm"),
    );
  } else {
    extras.push(
      path.join(home, ".bun", "bin"),
      path.join(home, ".local", "share", "pnpm"),
      "/usr/local/bin",
      "/opt/homebrew/bin",
    );
  }
  const parts = current.split(sep).filter(Boolean);
  for (const e of extras) {
    if (e && !parts.includes(e)) parts.push(e);
  }
  const next = { ...env, PATH: parts.join(sep) };
  if (process.platform === "win32") next.Path = next.PATH;
  return next;
}
