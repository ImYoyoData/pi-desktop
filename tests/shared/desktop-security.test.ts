import { describe, expect, it } from "vitest";
import {
  classifyToolName,
  evaluatePermission,
  isDangerousBashCommand,
  parseDesktopSecurity,
  primaryShellSegment,
  DEFAULT_DESKTOP_SECURITY,
  type PermissionProfile,
  type SecurityCategory,
} from "../../src/shared/desktop-security";

describe("parseDesktopSecurity", () => {
  it("defaults when missing", () => {
    expect(parseDesktopSecurity(undefined)).toEqual(DEFAULT_DESKTOP_SECURITY);
  });

  it("keeps an explicit profile and ignores legacy fields", () => {
    expect(
      parseDesktopSecurity({
        desktopSecurity: { profile: "yolo", bash: "ask", write: "ask" },
      }),
    ).toEqual({ profile: "yolo" });
  });

  it("derives a profile from legacy bash/write modes", () => {
    expect(
      parseDesktopSecurity({ desktopSecurity: { bash: "ask", write: "ask" } }).profile,
    ).toBe("ask");
    expect(
      parseDesktopSecurity({ desktopSecurity: { bash: "ask", write: "allow" } }).profile,
    ).toBe("edits");
    expect(
      parseDesktopSecurity({ desktopSecurity: { bash: "allow", write: "allow" } }).profile,
    ).toBe("auto");
  });

  it("falls back to ask for unknown values", () => {
    expect(parseDesktopSecurity({ desktopSecurity: { profile: "nope" } }).profile).toBe(
      "ask",
    );
  });
});

describe("primaryShellSegment", () => {
  it("uses the last top-level segment", () => {
    expect(primaryShellSegment("cd /tmp && ls -la")).toBe("ls -la");
    expect(
      primaryShellSegment('cd "C:\\MyCode\\Node\\app" && docker compose up'),
    ).toBe("docker compose up");
  });
});

describe("isDangerousBashCommand", () => {
  it("flags destructive system commands", () => {
    expect(isDangerousBashCommand("rm -rf /")).toBe(true);
    expect(isDangerousBashCommand("rm -rf ~/")).toBe(true);
    expect(isDangerousBashCommand("rm -r -f .")).toBe(true);
    expect(isDangerousBashCommand("mkfs.ext4 /dev/sda1")).toBe(true);
    expect(isDangerousBashCommand("dd if=/dev/zero of=/dev/sda")).toBe(true);
    expect(isDangerousBashCommand("shutdown -h now")).toBe(true);
    expect(isDangerousBashCommand(":(){ :|:& };:")).toBe(true);
  });

  it("leaves ordinary commands alone", () => {
    expect(isDangerousBashCommand("rm -rf node_modules")).toBe(false);
    expect(isDangerousBashCommand("rm dist/app.js")).toBe(false);
    expect(isDangerousBashCommand("rm -rf build/")).toBe(false);
    expect(
      isDangerousBashCommand("dd if=/dev/zero of=./disk.img bs=1m count=10"),
    ).toBe(false);
    expect(isDangerousBashCommand("git status")).toBe(false);
  });
});

describe("classifyToolName", () => {
  it("maps bash/edit/write only", () => {
    expect(classifyToolName("bash")).toBe("bash");
    expect(classifyToolName("edit")).toBe("write");
    expect(classifyToolName("write")).toBe("write");
    expect(classifyToolName("read")).toBe(null);
    expect(classifyToolName("web_fetch")).toBe(null);
  });
});

function evalPerm(
  category: SecurityCategory,
  profile: PermissionProfile,
  sessionAllows: SecurityCategory[] = [],
  command?: string,
) {
  return evaluatePermission({
    category,
    settings: { profile },
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
