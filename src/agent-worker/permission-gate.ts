import type {
  BeforeToolCallContext,
  BeforeToolCallResult,
} from "@earendil-works/pi-agent-core";
import {
  classifyToolName,
  evaluatePermission,
  type DesktopSecuritySettings,
  type PermissionDecision,
  type SecurityCategory,
} from "../shared/desktop-security";

export type PermissionAskPayload = {
  category: SecurityCategory;
  toolName: string;
  summary: string;
};

export type PermissionGateOptions = {
  getSettings: () => DesktopSecuritySettings;
  /** Workspace cwd — used for per-workspace tool permission overrides. */
  getCwd?: () => string | null | undefined;
  sessionAllows: Set<SecurityCategory>;
  askUser: (req: PermissionAskPayload) => Promise<PermissionDecision>;
  /** Test hook — defaults to shared `evaluatePermission`. */
  evaluate?: typeof evaluatePermission;
};

const DENY_REASON =
  "Blocked by Pi Desktop security settings. Open Settings → Security to allow, add a bash allowlist entry, or trust the workspace.";

const TIMEOUT_REASON =
  "Permission prompt timed out or UI unavailable — denied.";

export { DENY_REASON, TIMEOUT_REASON };

export type PermissionGateHandle = {
  gate: (
    ctx: BeforeToolCallContext,
    signal?: AbortSignal,
  ) => Promise<BeforeToolCallResult | undefined>;
  /** Second line for bash exec — blocks if settings/session do not allow and gate did not grant once. */
  assertBashExecAllowed: (command: string) => void;
  /** Consume one-shot "start as background" flag from allow_once_background. */
  takeBashBackgroundFlag: (command: string) => boolean;
};

function bashCommandKey(command: string): string {
  return command.trim();
}

export function createPermissionGate(opts: PermissionGateOptions): PermissionGateHandle {
  const bashAllowOnce = new Set<string>();
  const bashBackgroundOnce = new Set<string>();
  const evaluate = opts.evaluate ?? evaluatePermission;

  const assertBashExecAllowed = (command: string): void => {
    const key = bashCommandKey(command);
    const ev = evaluate({
      category: "bash",
      settings: opts.getSettings(),
      command: key,
      sessionAllows: opts.sessionAllows,
      cwd: opts.getCwd?.(),
    });
    if (ev.action === "allow") return;
    if (bashAllowOnce.delete(key)) return;
    throw new Error(DENY_REASON);
  };

  const takeBashBackgroundFlag = (command: string): boolean => {
    return bashBackgroundOnce.delete(bashCommandKey(command));
  };

  const gate = async (
    ctx: BeforeToolCallContext,
  ): Promise<BeforeToolCallResult | undefined> => {
    const toolName = ctx.toolCall.name;
    const category = classifyToolName(toolName);
    if (!category) return undefined;

    const args =
      ctx.args && typeof ctx.args === "object"
        ? (ctx.args as Record<string, unknown>)
        : {};
    const command = typeof args.command === "string" ? args.command : undefined;
    const summary =
      category === "bash"
        ? String(command ?? "")
        : String(args.path ?? args.filePath ?? JSON.stringify(args).slice(0, 200));

    const ev = evaluate({
      category,
      settings: opts.getSettings(),
      command,
      sessionAllows: opts.sessionAllows,
      cwd: opts.getCwd?.(),
    });

    switch (ev.action) {
      case "allow":
        return undefined;
      case "deny":
        return { block: true, reason: ev.reason };
      case "ask":
        break;
      default: {
        const _exhaustive: never = ev;
        return _exhaustive;
      }
    }

    let decision: PermissionDecision;
    try {
      decision = await opts.askUser({ category, toolName, summary });
    } catch {
      return { block: true, reason: TIMEOUT_REASON };
    }

    if (decision === "allow_session_category") {
      opts.sessionAllows.add(category);
      return undefined;
    }
    if (
      decision === "allow_once" ||
      decision === "allow_once_background" ||
      decision === "allow_whitelist"
    ) {
      if (category === "bash" && command) {
        const key = bashCommandKey(command);
        bashAllowOnce.add(key);
        if (decision === "allow_once_background") {
          bashBackgroundOnce.add(key);
        }
      }
      return undefined;
    }

    return { block: true, reason: DENY_REASON };
  };

  return { gate, assertBashExecAllowed, takeBashBackgroundFlag };
}
