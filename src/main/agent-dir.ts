import { homedir } from "node:os";
import path from "node:path";

/**
 * Resolve the Pi agent config directory (~/.pi/agent by default).
 * Re-implements pi-coding-agent's getAgentDir() so the main process never
 * has to import the multi-MB SDK just to learn a filesystem path — that
 * eager import used to block app startup until the SDK finished parsing.
 */
export function agentDir(): string {
  const envDir = process.env.PI_CODING_AGENT_DIR;
  if (envDir && envDir.trim()) {
    const raw = envDir.trim();
    const expanded = raw.startsWith("~")
      ? path.join(homedir(), raw.slice(1))
      : raw;
    return path.normalize(path.resolve(expanded));
  }
  return path.join(homedir(), ".pi", "agent");
}
