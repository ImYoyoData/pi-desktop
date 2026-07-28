import fs from "node:fs";
import path from "node:path";
import {
  getAgentDir,
  hasTrustRequiringProjectResources,
  ProjectTrustStore,
} from "@earendil-works/pi-coding-agent";
import type { TrustPromptKind, TrustState } from "../shared/protocol";

export type { TrustPromptKind, TrustState };

export function resolveTrustState(cwd: string, agentDir = getAgentDir()): TrustState {
  const store = new ProjectTrustStore(agentDir);
  const needsResources = hasTrustRequiringProjectResources(cwd);
  const decision = store.get(cwd);
  // Opening a workspace requires an explicit trust decision.
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

export function setProjectTrust(cwd: string, trusted: boolean, agentDir = getAgentDir()): void {
  new ProjectTrustStore(agentDir).set(cwd, trusted);
}

export function clearProjectTrust(cwd: string, agentDir = getAgentDir()): void {
  new ProjectTrustStore(agentDir).set(cwd, null);
}

/** Paths explicitly marked trusted in `trust.json` (decision === true). */
export function listTrustedWorkspaces(agentDir = getAgentDir()): string[] {
  const trustPath = path.join(path.resolve(agentDir), "trust.json");
  try {
    const raw = fs.readFileSync(trustPath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
    return Object.entries(parsed as Record<string, unknown>)
      .filter(([, v]) => v === true)
      .map(([p]) => p)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}
