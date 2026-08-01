import fs from "node:fs";
import path from "node:path";
import { agentDir } from "./agent-dir";

/**
 * Ensure ~/.pi/agent (or PI_CODING_AGENT_DIR) exists with minimal config files
 * so first launch works without a prior `pi` CLI install.
 */
export function ensurePiAgentEnvironment(): { agentDir: string; created: string[] } {
  const agentDirPath = path.resolve(agentDir());
  const created: string[] = [];

  const ensureDir = (dir: string): void => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      created.push(dir);
    }
  };

  ensureDir(agentDirPath);
  ensureDir(path.join(agentDirPath, "sessions"));
  ensureDir(path.join(agentDirPath, "agents"));
  ensureDir(path.join(agentDirPath, "skills"));
  ensureDir(path.join(agentDirPath, "extensions"));
  ensureDir(path.join(agentDirPath, "npm"));
  ensureDir(path.join(agentDirPath, "git"));
  ensureDir(path.join(agentDirPath, "bin"));

  const writeIfMissing = (filePath: string, body: string): void => {
    if (fs.existsSync(filePath)) return;
    fs.writeFileSync(filePath, body, { encoding: "utf8", mode: 0o600 });
    created.push(filePath);
  };

  writeIfMissing(
    path.join(agentDirPath, "models.json"),
    `${JSON.stringify({ providers: {} }, null, 2)}\n`,
  );
  writeIfMissing(path.join(agentDirPath, "auth.json"), `${JSON.stringify({}, null, 2)}\n`);
  writeIfMissing(
    path.join(agentDirPath, "settings.json"),
    `${JSON.stringify(
      {
        thinkingLevel: "medium",
      },
      null,
      2,
    )}\n`,
  );

  return { agentDir: agentDirPath, created };
}
