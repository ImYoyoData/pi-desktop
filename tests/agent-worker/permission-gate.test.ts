import { describe, expect, it, vi } from "vitest";
import type { BeforeToolCallContext } from "@earendil-works/pi-agent-core";
import { createPermissionGate } from "../../src/agent-worker/permission-gate";
import {
  DEFAULT_DESKTOP_SECURITY,
  type DesktopSecuritySettings,
  type PermissionDecision,
  type SecurityCategory,
} from "../../src/shared/desktop-security";

function ctx(
  toolName: string,
  args: Record<string, unknown> = {},
): BeforeToolCallContext {
  return {
    toolCall: { type: "toolCall", id: "tc-1", name: toolName, arguments: args },
    args,
    assistantMessage: {} as BeforeToolCallContext["assistantMessage"],
    context: {} as BeforeToolCallContext["context"],
  };
}

describe("createPermissionGate", () => {
  it("skips unclassified tools", async () => {
    const askUser = vi.fn();
    const gate = createPermissionGate({
      getSettings: () => DEFAULT_DESKTOP_SECURITY,
      sessionAllows: new Set(),
      askUser,
    }).gate;
    await expect(gate(ctx("read", { path: "a.ts" }))).resolves.toBeUndefined();
    expect(askUser).not.toHaveBeenCalled();
  });

  it("allows without ask when mode is allow", async () => {
    const askUser = vi.fn();
    const settings: DesktopSecuritySettings = {
      ...DEFAULT_DESKTOP_SECURITY,
      bash: "allow",
    };
    const { gate, assertBashExecAllowed } = createPermissionGate({
      getSettings: () => settings,
      sessionAllows: new Set(),
      askUser,
    });
    await expect(
      gate(ctx("bash", { command: "ls" })),
    ).resolves.toBeUndefined();
    expect(askUser).not.toHaveBeenCalled();
    expect(() => assertBashExecAllowed("ls")).not.toThrow();
  });

  it("allows bash via allowlist without ask", async () => {
    const askUser = vi.fn();
    const settings: DesktopSecuritySettings = {
      ...DEFAULT_DESKTOP_SECURITY,
      bashAllowlist: ["git status"],
    };
    const gate = createPermissionGate({
      getSettings: () => settings,
      sessionAllows: new Set(),
      askUser,
    }).gate;
    await expect(
      gate(ctx("bash", { command: "git status --short" })),
    ).resolves.toBeUndefined();
    expect(askUser).not.toHaveBeenCalled();
  });

  it("asks and allows once", async () => {
    const askUser = vi.fn(async (): Promise<PermissionDecision> => "allow_once");
    const { gate, assertBashExecAllowed } = createPermissionGate({
      getSettings: () => DEFAULT_DESKTOP_SECURITY,
      sessionAllows: new Set(),
      askUser,
    });
    await expect(
      gate(ctx("bash", { command: "rm -rf /" })),
    ).resolves.toBeUndefined();
    expect(askUser).toHaveBeenCalledWith({
      category: "bash",
      toolName: "bash",
      summary: "rm -rf /",
    });
    expect(() => assertBashExecAllowed("rm -rf /")).not.toThrow();
    expect(() => assertBashExecAllowed("rm -rf /")).toThrow(/security settings/i);
  });

  it("allow_once_background grants once and sets background flag", async () => {
    const askUser = vi.fn(async (): Promise<PermissionDecision> => "allow_once_background");
    const { gate, assertBashExecAllowed, takeBashBackgroundFlag } = createPermissionGate({
      getSettings: () => DEFAULT_DESKTOP_SECURITY,
      sessionAllows: new Set(),
      askUser,
    });
    await expect(
      gate(ctx("bash", { command: "npm run dev" })),
    ).resolves.toBeUndefined();
    expect(takeBashBackgroundFlag("npm run dev")).toBe(true);
    expect(takeBashBackgroundFlag("npm run dev")).toBe(false);
    expect(() => assertBashExecAllowed("npm run dev")).not.toThrow();
  });

  it("allow_whitelist behaves like allow once for the current command", async () => {
    const askUser = vi.fn(async (): Promise<PermissionDecision> => "allow_whitelist");
    const { gate, assertBashExecAllowed } = createPermissionGate({
      getSettings: () => DEFAULT_DESKTOP_SECURITY,
      sessionAllows: new Set(),
      askUser,
    });
    await expect(
      gate(ctx("bash", { command: "git status" })),
    ).resolves.toBeUndefined();
    expect(() => assertBashExecAllowed("git status")).not.toThrow();
    expect(() => assertBashExecAllowed("git status")).toThrow(/security settings/i);
  });

  it("assertBashExecAllowed blocks exec bypass", () => {
    const { assertBashExecAllowed } = createPermissionGate({
      getSettings: () => DEFAULT_DESKTOP_SECURITY,
      sessionAllows: new Set(),
      askUser: vi.fn(),
    });
    expect(() => assertBashExecAllowed("ls")).toThrow(/security settings/i);
  });

  it("allow_session_category persists for later calls", async () => {
    const sessionAllows = new Set<SecurityCategory>();
    const askUser = vi.fn(async (): Promise<PermissionDecision> => "allow_session_category");
    const gate = createPermissionGate({
      getSettings: () => DEFAULT_DESKTOP_SECURITY,
      sessionAllows,
      askUser,
    }).gate;
    await expect(
      gate(ctx("write", { path: "a.ts" })),
    ).resolves.toBeUndefined();
    expect(sessionAllows.has("write")).toBe(true);

    await expect(
      gate(ctx("edit", { path: "b.ts" })),
    ).resolves.toBeUndefined();
    expect(askUser).toHaveBeenCalledTimes(1);
  });

  it("blocks on deny", async () => {
    const askUser = vi.fn(async (): Promise<PermissionDecision> => "deny");
    const gate = createPermissionGate({
      getSettings: () => DEFAULT_DESKTOP_SECURITY,
      sessionAllows: new Set(),
      askUser,
    }).gate;
    const result = await gate(ctx("bash", { command: "ls" }));
    expect(result?.block).toBe(true);
    expect(result?.reason).toMatch(/security settings/i);
  });

  it("blocks on evaluatePermission deny without asking", async () => {
    const askUser = vi.fn();
    const gate = createPermissionGate({
      getSettings: () => DEFAULT_DESKTOP_SECURITY,
      sessionAllows: new Set(),
      askUser,
      evaluate: () => ({ action: "deny", reason: "hard deny for test" }),
    }).gate;
    const result = await gate(ctx("bash", { command: "ls" }));
    expect(result?.block).toBe(true);
    expect(result?.reason).toBe("hard deny for test");
    expect(askUser).not.toHaveBeenCalled();
  });

  it("blocks on askUser failure / timeout", async () => {
    const askUser = vi.fn(async () => {
      throw new Error("rpc timeout");
    });
    const gate = createPermissionGate({
      getSettings: () => DEFAULT_DESKTOP_SECURITY,
      sessionAllows: new Set(),
      askUser,
    }).gate;
    const result = await gate(ctx("bash", { command: "ls" }));
    expect(result?.block).toBe(true);
    expect(result?.reason).toMatch(/timed out/i);
  });
});
