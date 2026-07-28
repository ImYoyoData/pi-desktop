import type { AgentCommand } from "./protocol";
import type { BrowserRpcMethod } from "./browser-automation";
import type { DesktopSecuritySettings } from "./desktop-security";

export type WorkerInbound =
  | {
      kind: "init";
      cwd: string;
      filePath?: string;
      projectTrusted: boolean;
      desktopSecurity?: DesktopSecuritySettings;
    }
  | { kind: "command"; id: string; command: AgentCommand }
  | { kind: "reload_models" }
  | { kind: "reload_security"; desktopSecurity: DesktopSecuritySettings }
  | { kind: "shutdown" }
  | { kind: "ping" }
  | { kind: "terminate_run"; runId: string }
  | { kind: "background_run"; runId: string }
  | {
      kind: "rpc_response";
      id: string;
      result?: unknown;
      error?: string;
    };

export type WorkerOutbound =
  | { kind: "ready"; id: string; filePath: string; cwd: string }
  | { kind: "result"; id: string; data?: unknown; error?: string }
  | { kind: "event"; event: Record<string, unknown> }
  | { kind: "pong" }
  | { kind: "fatal"; error: string }
  | {
      kind: "run_started";
      run: {
        id: string;
        sessionId: string;
        workspaceRoot: string;
        command: string;
        cwd: string;
        pid?: number;
        startedAt: number;
      };
    }
  | { kind: "run_output"; runId: string; chunk: string }
  | { kind: "run_ended"; runId: string }
  | { kind: "run_backgrounded"; runId: string }
  | {
      kind: "rpc_request";
      id: string;
      method: BrowserRpcMethod | string;
      params: Record<string, unknown>;
    };
