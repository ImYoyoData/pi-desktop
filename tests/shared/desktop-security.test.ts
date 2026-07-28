import { describe, expect, it } from "vitest";
import {
  bashAllowlistEntryFromCommand,
  bashAllowlistMatches,
  classifyToolName,
  evaluatePermission,
  normalizeSecurityPathKey,
  parseDesktopSecurity,
  primaryShellSegment,
  resolveEffectiveSecurity,
  DEFAULT_DESKTOP_SECURITY,
} from "../../src/shared/desktop-security";
import type { SecurityCategory } from "../../src/shared/desktop-security";

describe("parseDesktopSecurity", () => {
  it("defaults when missing", () => {
    expect(parseDesktopSecurity(undefined)).toEqual(DEFAULT_DESKTOP_SECURITY);
  });
  it("reads nested desktopSecurity object and ignores network", () => {
    expect(
      parseDesktopSecurity({
        desktopSecurity: {
          bash: "allow",
          write: "ask",
          network: "allow",
          bashAllowlist: ["git status"],
          workspacePermissions: {
            "/tmp/ws": { bash: "allow", write: "ask" },
          },
        },
      }),
    ).toEqual({
      bash: "allow",
      write: "ask",
      bashAllowlist: ["git status"],
      workspacePermissions: {
        "/tmp/ws": { bash: "allow", write: "ask" },
      },
    });
  });
  it("ignores invalid modes", () => {
    expect(parseDesktopSecurity({ desktopSecurity: { bash: "nope" } }).bash).toBe("ask");
  });
});

describe("bashAllowlistMatches", () => {
  it("prefix matches after trim", () => {
    expect(bashAllowlistMatches("  git status --short ", ["git status"])).toBe(true);
    expect(bashAllowlistMatches("git push", ["git status"])).toBe(false);
  });
});

describe("bashAllowlistEntryFromCommand", () => {
  it("keeps compound command stems, not full lines", () => {
    expect(bashAllowlistEntryFromCommand("git status --short")).toBe("git status");
    expect(bashAllowlistEntryFromCommand("npm test --coverage")).toBe("npm test");
    expect(
      bashAllowlistEntryFromCommand(
        'cd "C:\\MyCode\\Node\\app" && docker compose -f docker-compose.dev.yml up -d 2>&1',
      ),
    ).toBe("docker compose");
  });

  it("strips executable path and .exe on Windows-style tokens", () => {
    expect(bashAllowlistEntryFromCommand("C:\\\\git\\\\cmd\\\\git.exe status -sb")).toBe(
      "git status",
    );
  });

  it("uses primary (last) shell segment", () => {
    expect(primaryShellSegment("cd /tmp && ls -la")).toBe("ls -la");
    expect(bashAllowlistEntryFromCommand("cd /tmp && ls -la")).toBe("ls");
  });
});

describe("resolveEffectiveSecurity", () => {
  it("prefers workspace override over global", () => {
    const settings = parseDesktopSecurity({
      desktopSecurity: {
        bash: "ask",
        write: "ask",
        workspacePermissions: {
          "C:/Work/App": { bash: "allow", write: "ask" },
        },
      },
    });
    expect(resolveEffectiveSecurity(settings, "C:\\Work\\App").bash).toBe("allow");
    expect(resolveEffectiveSecurity(settings, "C:\\Other").bash).toBe("ask");
  });

  it("normalizes Win path keys case-insensitively", () => {
    expect(normalizeSecurityPathKey("C:\\Work\\App")).toBe(
      normalizeSecurityPathKey("c:/work/app"),
    );
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
  settings: typeof DEFAULT_DESKTOP_SECURITY,
  sessionAllows: SecurityCategory[] = [],
  command?: string,
  cwd?: string,
) {
  return evaluatePermission({
    category,
    settings,
    command,
    sessionAllows: new Set(sessionAllows),
    cwd,
  });
}

describe("evaluatePermission", () => {
  it("allows when category is in sessionAllows (session)", () => {
    expect(evalPerm("write", DEFAULT_DESKTOP_SECURITY, ["write"])).toEqual({
      action: "allow",
      reason: "session",
    });
  });

  it("session wins over ask mode", () => {
    expect(evalPerm("bash", DEFAULT_DESKTOP_SECURITY, ["bash"], "rm -rf /")).toEqual({
      action: "allow",
      reason: "session",
    });
  });

  it("allows when settings category is allow (mode_allow)", () => {
    const settings = { ...DEFAULT_DESKTOP_SECURITY, bash: "allow" as const };
    expect(evalPerm("bash", settings)).toEqual({ action: "allow", reason: "mode_allow" });
  });

  it("allows bash when command matches allowlist", () => {
    const settings = { ...DEFAULT_DESKTOP_SECURITY, bashAllowlist: ["git status"] };
    expect(evalPerm("bash", settings, [], "git status --short")).toEqual({
      action: "allow",
      reason: "allowlist",
    });
  });

  it("uses workspace override modes", () => {
    const settings = parseDesktopSecurity({
      desktopSecurity: {
        bash: "ask",
        write: "ask",
        workspacePermissions: {
          "/tmp/trusted": { bash: "allow", write: "ask" },
        },
      },
    });
    expect(evalPerm("bash", settings, [], "rm -rf /", "/tmp/trusted")).toEqual({
      action: "allow",
      reason: "mode_allow",
    });
    expect(evalPerm("bash", settings, [], "rm -rf /", "/tmp/other")).toEqual({
      action: "ask",
    });
  });

  it("does not use allowlist for non-bash categories", () => {
    const settings = {
      ...DEFAULT_DESKTOP_SECURITY,
      write: "ask" as const,
      bashAllowlist: ["git status"],
    };
    expect(evalPerm("write", settings)).toEqual({ action: "ask" });
  });

  it("asks when no rule matches", () => {
    expect(evalPerm("bash", DEFAULT_DESKTOP_SECURITY, [], "npm install")).toEqual({
      action: "ask",
    });
    expect(evalPerm("write", DEFAULT_DESKTOP_SECURITY)).toEqual({ action: "ask" });
  });

  it("session checked before mode_allow", () => {
    const settings = { ...DEFAULT_DESKTOP_SECURITY, write: "allow" as const };
    expect(evalPerm("write", settings, ["write"])).toEqual({
      action: "allow",
      reason: "session",
    });
  });

  it("mode_allow checked before allowlist", () => {
    const settings = {
      ...DEFAULT_DESKTOP_SECURITY,
      bash: "allow" as const,
      bashAllowlist: ["git status"],
    };
    expect(evalPerm("bash", settings, [], "git push")).toEqual({
      action: "allow",
      reason: "mode_allow",
    });
  });
});
