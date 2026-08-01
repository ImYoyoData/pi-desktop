import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { agentDir } from "./agent-dir";
import type { TrustPromptKind, TrustState } from "../shared/protocol";

export type { TrustPromptKind, TrustState };

/**
 * Re-implementation of the Pi SDK trust store (trust.json) with pure fs so the
 * main process never has to import the multi-MB SDK just for project trust.
 */

const TRUST_REQUIRING_RESOURCES = [
  "settings.json",
  "extensions",
  "skills",
  "prompts",
  "themes",
  "SYSTEM.md",
  "APPEND_SYSTEM.md",
];

function trustFilePath(agentDirPath: string): string {
  return path.join(path.resolve(agentDirPath), "trust.json");
}

function canonicalize(p: string): string {
  const resolved = path.resolve(p);
  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function readTrustStore(agentDirPath: string): Record<string, boolean | null> {
  try {
    const parsed = JSON.parse(fs.readFileSync(trustFilePath(agentDirPath), "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, boolean | null> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (value === true || value === false || value === null) out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function writeTrustStore(agentDirPath: string, data: Record<string, boolean | null>): void {
  const sorted: Record<string, boolean | null> = {};
  for (const key of Object.keys(data).sort()) {
    const value = data[key];
    if (value === true || value === false || value === null) sorted[key] = value;
  }
  const file = trustFilePath(agentDirPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(sorted, null, 2)}\n`, "utf8");
}

function nearestTrustEntry(
  data: Record<string, boolean | null>,
  cwd: string,
): { decision: boolean | null } | null {
  let current = canonicalize(cwd);
  while (true) {
    const value = data[current];
    if (value === true || value === false) return { decision: value };
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function hasTrustRequiringProjectResources(cwd: string): boolean {
  const userAgentsSkills = path.join(canonicalize(homedir()), ".agents", "skills");
  let current = canonicalize(cwd);
  const configDir = path.join(current, ".pi");
  if (TRUST_REQUIRING_RESOURCES.some((entry) => fs.existsSync(path.join(configDir, entry)))) {
    return true;
  }
  while (true) {
    const agentsSkills = path.join(current, ".agents", "skills");
    if (agentsSkills !== userAgentsSkills && fs.existsSync(agentsSkills)) return true;
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

export function resolveTrustState(
  cwd: string,
  agentDirPath = agentDir(),
): TrustState {
  const store = readTrustStore(agentDirPath);
  const needsResources = hasTrustRequiringProjectResources(cwd);
  const decision = nearestTrustEntry(store, cwd)?.decision ?? null;
  if (decision === true) {
    return { decision, needsResources, prompt: "none", projectTrusted: true };
  }
  return {
    decision,
    needsResources,
    prompt: "ask",
    projectTrusted: false,
  };
}

export function setProjectTrust(
  cwd: string,
  trusted: boolean,
  agentDirPath = agentDir(),
): void {
  const store = readTrustStore(agentDirPath);
  store[canonicalize(cwd)] = trusted;
  writeTrustStore(agentDirPath, store);
}

export function clearProjectTrust(
  cwd: string,
  agentDirPath = agentDir(),
): void {
  const store = readTrustStore(agentDirPath);
  delete store[canonicalize(cwd)];
  writeTrustStore(agentDirPath, store);
}

/** Paths explicitly marked trusted in `trust.json` (decision === true). */
export function listTrustedWorkspaces(agentDirPath = agentDir()): string[] {
  const store = readTrustStore(agentDirPath);
  return Object.entries(store)
    .filter(([, v]) => v === true)
    .map(([p]) => p)
    .sort((a, b) => a.localeCompare(b));
}
