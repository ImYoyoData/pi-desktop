import fs from "node:fs";
import path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

/**
 * Ensure ~/.pi/agent (or PI_CODING_AGENT_DIR) exists with minimal config files
 * so first launch works without a prior `pi` CLI install.
 */
export function ensurePiAgentEnvironment(): { agentDir: string; created: string[] } {
  const agentDir = path.resolve(getAgentDir());
  const created: string[] = [];

  const ensureDir = (dir: string): void => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      created.push(dir);
    }
  };

  ensureDir(agentDir);
  ensureDir(path.join(agentDir, "sessions"));
  ensureDir(path.join(agentDir, "agents"));
  ensureDir(path.join(agentDir, "skills"));
  ensureDir(path.join(agentDir, "extensions"));
  ensureDir(path.join(agentDir, "npm"));
  ensureDir(path.join(agentDir, "git"));
  ensureDir(path.join(agentDir, "bin"));

  const writeIfMissing = (filePath: string, body: string): void => {
    if (fs.existsSync(filePath)) return;
    fs.writeFileSync(filePath, body, { encoding: "utf8", mode: 0o600 });
    created.push(filePath);
  };

  writeIfMissing(
    path.join(agentDir, "models.json"),
    `${JSON.stringify({ providers: {} }, null, 2)}\n`,
  );
  writeIfMissing(path.join(agentDir, "auth.json"), `${JSON.stringify({}, null, 2)}\n`);
  writeIfMissing(
    path.join(agentDir, "settings.json"),
    `${JSON.stringify(
      {
        thinkingLevel: "medium",
      },
      null,
      2,
    )}\n`,
  );

  return { agentDir, created };
}
