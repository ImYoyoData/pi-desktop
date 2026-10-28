import { describe, expect, it } from "vitest";
import {
  DEFAULT_PERMISSION_PROFILE,
  classifyToolName,
  evaluatePermission,
  isDangerousCommand,
  parsePermissionCheckParams,
  parsePermissionSettings,
  type PermissionCategory,
  type PermissionProfile,
} from "../../src/shared/permissions";

describe("parsePermissionSettings", () => {
  it("defaults when missing", () => {
    expect(parsePermissionSettings(undefined)).toEqual({
      profile: DEFAULT_PERMISSION_PROFILE,
    });
    expect(parsePermissionSettings({})).toEqual({
      profile: DEFAULT_PERMISSION_PROFILE,
    });
  });

  it("reads the desktopSecurity section and ignores legacy fields", () => {
    expect(
      parsePermissionSettings({
        desktopSecurity: { profile: "yolo", bash: "ask", write: "ask" },
      }),
    ).toEqual({ profile: "yolo" });
  });

  it("falls back to ask for unknown values", () => {
    expect(parsePermissionSettings({ desktopSecurity: { profile: "nope" } })).toEqual({
      profile: "ask",
    });
    expect(parsePermissionSettings({ profile: "nope" })).toEqual({ profile: "ask" });
  });
});

describe("isDangerousCommand", () => {
  it("flags destructive system commands", () => {
    expect(isDangerousCommand("rm -rf /")).toBe(true);
    expect(isDangerousCommand("rm -rf ~/")).toBe(true);
    expect(isDangerousCommand("rm -r -f .")).toBe(true);
    expect(isDangerousCommand("mkfs.ext4 /dev/sda1")).toBe(true);
    expect(isDangerousCommand("dd if=/dev/zero of=/dev/sda")).toBe(true);
    expect(isDangerousCommand("shutdown -h now")).toBe(true);
    expect(isDangerousCommand(":(){ :|:& };:")).toBe(true);
  });

  it("uses the last chained segment", () => {
    expect(isDangerousCommand("cd /tmp && shutdown now")).toBe(true);
    expect(isDangerousCommand("shutdown now && echo done")).toBe(false);
  });

  it("leaves ordinary commands alone", () => {
    expect(isDangerousCommand("rm -rf node_modules")).toBe(false);
    expect(isDangerousCommand("rm -rf build/")).toBe(false);
    expect(isDangerousCommand("dd if=/dev/zero of=./disk.img bs=1m count=10")).toBe(false);
    expect(isDangerousCommand("git status")).toBe(false);
  });
});

describe("classifyToolName", () => {
  it("maps shell and write tools only", () => {
    expect(classifyToolName("bash")).toBe("bash");
    expect(classifyToolName("powershell")).toBe("bash");
    expect(classifyToolName("edit")).toBe("write");
    expect(classifyToolName("write")).toBe("write");
    expect(classifyToolName("read")).toBe(null);
    expect(classifyToolName("grep")).toBe(null);
  });
});

function evalPerm(
  category: PermissionCategory,
  profile: PermissionProfile,
  sessionAllows: PermissionCategory[] = [],
  command?: string,
) {
  return evaluatePermission({
    category,
    profile,
    command,
    sessionAllows: new Set(sessionAllows),
  });
}

describe("evaluatePermission", () => {
  it("asks for everything in ask profile", () => {
    expect(evalPerm("bash", "ask", [], "ls")).toEqual({ action: "ask" });
    expect(evalPerm("write", "ask")).toEqual({ action: "ask" });
  });

  it("allows writes but still asks for commands in edits profile", () => {
    expect(evalPerm("write", "edits")).toEqual({ action: "allow", reason: "profile" });
    expect(evalPerm("bash", "edits", [], "ls")).toEqual({ action: "ask" });
  });

  it("allows in auto profile but keeps dangerous commands behind a confirm", () => {
    expect(evalPerm("bash", "auto", [], "npm test")).toEqual({
      action: "allow",
      reason: "profile",
    });
    expect(evalPerm("write", "auto")).toEqual({ action: "allow", reason: "profile" });
    expect(evalPerm("bash", "auto", [], "rm -rf /")).toEqual({
      action: "ask",
      danger: true,
    });
  });

  it("allows everything in yolo profile", () => {
    expect(evalPerm("bash", "yolo", [], "rm -rf /")).toEqual({
      action: "allow",
      reason: "profile",
    });
    expect(evalPerm("write", "yolo")).toEqual({ action: "allow", reason: "profile" });
  });

  it("session allow wins over ask profile", () => {
    expect(evalPerm("bash", "ask", ["bash"], "rm -rf /")).toEqual({
      action: "allow",
      reason: "session",
    });
  });
});

describe("parsePermissionCheckParams", () => {
  it("requires a tool name", () => {
    expect(parsePermissionCheckParams({})).toBe(null);
    expect(parsePermissionCheckParams({ toolName: "  " })).toBe(null);
  });

  it("falls back to the command as summary", () => {
    expect(
      parsePermissionCheckParams({ toolName: "bash", command: "ls -la" }),
    ).toEqual({ toolName: "bash", summary: "ls -la", command: "ls -la" });
  });

  it("keeps an explicit summary", () => {
    expect(
      parsePermissionCheckParams({ toolName: "edit", summary: "src/a.ts" }),
    ).toEqual({ toolName: "edit", summary: "src/a.ts" });
  });
});
