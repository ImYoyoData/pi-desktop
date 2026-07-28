import type { AgentCommand } from "./protocol";

export type WorkerInbound =
  | { kind: "init"; cwd: string; filePath?: string }
  | { kind: "command"; id: string; command: AgentCommand }
  | { kind: "reload_models" }
  | { kind: "shutdown" }
  | { kind: "ping" }
  | { kind: "terminate_run"; runId: string };

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
  | { kind: "run_ended"; runId: string };
