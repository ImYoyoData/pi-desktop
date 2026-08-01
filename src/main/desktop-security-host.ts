import fs from "node:fs";
import path from "node:path";
import { agentDir } from "./agent-dir";
import {
  bashAllowlistEntryFromCommand,
  DEFAULT_DESKTOP_SECURITY,
  parseDesktopSecurity,
  type DesktopSecuritySettings,
} from "../shared/desktop-security";

function resolveSettingsPath(agentDirOverride?: string): string {
  return path.join(path.resolve(agentDirOverride ?? agentDir()), "settings.json");
}

function ensureParent(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeJsonAtomic(filePath: string, data: unknown): void {
  ensureParent(filePath);
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const body = `${JSON.stringify(data, null, 2)}\n`;
  fs.writeFileSync(tmp, body, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tmp, filePath);
}

function readSettingsRoot(settingsPath: string): Record<string, unknown> {
  try {
    const raw = fs.readFileSync(settingsPath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // missing or invalid — treat as empty object
  }
  return {};
}

/** v1: serialized read-modify-write; concurrent writers may race (last write wins). */
let writeQueue: Promise<void> = Promise.resolve();

function enqueueWrite(task: () => void | Promise<void>): Promise<void> {
  writeQueue = writeQueue.then(task, task);
  return writeQueue;
}

export async function getDesktopSecuritySettings(
  agentDirOverride?: string,
): Promise<DesktopSecuritySettings> {
  const settingsPath = resolveSettingsPath(agentDirOverride);
  const root = readSettingsRoot(settingsPath);
  return parseDesktopSecurity(root);
}

export async function setDesktopSecuritySettings(
  next: DesktopSecuritySettings,
  agentDirOverride?: string,
): Promise<DesktopSecuritySettings> {
  const sanitized = parseDesktopSecurity({ desktopSecurity: next });
  const settingsPath = resolveSettingsPath(agentDirOverride);
  await enqueueWrite(() => {
    const existing = readSettingsRoot(settingsPath);
    writeJsonAtomic(settingsPath, { ...existing, desktopSecurity: sanitized });
  });
  return sanitized;
}

/** Append a bash allowlist entry (no-op if empty or already present). */
export async function appendBashAllowlistEntry(
  command: string,
  agentDirOverride?: string,
): Promise<DesktopSecuritySettings> {
  // Accept either a stem (`git status`) or a full command line.
  const entry = bashAllowlistEntryFromCommand(command) || command.trim();
  const current = await getDesktopSecuritySettings(agentDirOverride);
  if (!entry) return current;
  if (current.bashAllowlist.includes(entry)) return current;
  return setDesktopSecuritySettings(
    {
      ...current,
      bashAllowlist: [...current.bashAllowlist, entry],
    },
    agentDirOverride,
  );
}

export { DEFAULT_DESKTOP_SECURITY };
