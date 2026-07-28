import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProjectTrustStore } from "@earendil-works/pi-coding-agent";
import {
  clearProjectTrust,
  resolveTrustState,
  setProjectTrust,
} from "../../src/main/project-trust";
import {
  getDesktopSecuritySettings,
  setDesktopSecuritySettings,
} from "../../src/main/desktop-security-host";
import { DEFAULT_DESKTOP_SECURITY } from "../../src/shared/desktop-security";

describe("resolveTrustState", () => {
  let agentDir: string;
  let workspace: string;

  beforeEach(() => {
    agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-trust-agent-"));
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), "pi-trust-ws-"));
  });

  afterEach(() => {
    fs.rmSync(agentDir, { recursive: true, force: true });
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  function piSettings(): void {
    const piDir = path.join(workspace, ".pi");
    fs.mkdirSync(piDir, { recursive: true });
    fs.writeFileSync(path.join(piDir, "settings.json"), "{}\n", "utf8");
  }

  it("asks before open when trust is unset (even without .pi resources)", () => {
    const state = resolveTrustState(workspace, agentDir);
    expect(state).toEqual({
      decision: null,
      needsResources: false,
      prompt: "ask",
      projectTrusted: false,
    });
  });

  it("asks when .pi/settings.json exists and trust is unset", () => {
    piSettings();
    const state = resolveTrustState(workspace, agentDir);
    expect(state.needsResources).toBe(true);
    expect(state.decision).toBe(null);
    expect(state.prompt).toBe("ask");
    expect(state.projectTrusted).toBe(false);
  });

  it("respects explicit trust true in trust.json", () => {
    piSettings();
    setProjectTrust(workspace, true, agentDir);
    const state = resolveTrustState(workspace, agentDir);
    expect(state).toMatchObject({
      decision: true,
      needsResources: true,
      prompt: "none",
      projectTrusted: true,
    });
  });

  it("asks again when explicitly distrusted (cannot open until re-trusted)", () => {
    piSettings();
    setProjectTrust(workspace, false, agentDir);
    const state = resolveTrustState(workspace, agentDir);
    expect(state).toMatchObject({
      decision: false,
      needsResources: true,
      prompt: "ask",
      projectTrusted: false,
    });
  });

  it("clearProjectTrust removes entry so prompt returns to ask", () => {
    piSettings();
    setProjectTrust(workspace, true, agentDir);
    clearProjectTrust(workspace, agentDir);
    expect(new ProjectTrustStore(agentDir).get(workspace)).toBe(null);
    const state = resolveTrustState(workspace, agentDir);
    expect(state.prompt).toBe("ask");
    expect(state.projectTrusted).toBe(false);
  });
});

describe("desktop-security-host", () => {
  let agentDir: string;

  beforeEach(() => {
    agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-sec-agent-"));
  });

  afterEach(() => {
    fs.rmSync(agentDir, { recursive: true, force: true });
  });

  it("returns defaults when settings.json is missing", async () => {
    const settings = await getDesktopSecuritySettings(agentDir);
    expect(settings).toEqual(DEFAULT_DESKTOP_SECURITY);
  });

  it("merges desktopSecurity on set without dropping other keys", async () => {
    const settingsPath = path.join(agentDir, "settings.json");
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify({ theme: "dark" }, null, 2) + "\n", "utf8");

    await setDesktopSecuritySettings({ ...DEFAULT_DESKTOP_SECURITY, bash: "allow" }, agentDir);
    const raw = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
    expect(raw.theme).toBe("dark");
    expect(raw.desktopSecurity).toMatchObject({ bash: "allow" });
    expect(raw.desktopSecurity).not.toHaveProperty("network");

    const settings = await getDesktopSecuritySettings(agentDir);
    expect(settings.bash).toBe("allow");
  });

  it("sanitizes malformed desktopSecurity on set", async () => {
    await setDesktopSecuritySettings(
      {
        bash: "nope" as "ask",
        write: "allow",
        bashAllowlist: [" ok ", "", "valid"] as string[],
      },
      agentDir,
    );
    const settings = await getDesktopSecuritySettings(agentDir);
    expect(settings).toEqual({
      bash: "ask",
      write: "allow",
      bashAllowlist: ["ok", "valid"],
      workspacePermissions: {},
    });
  });
});
