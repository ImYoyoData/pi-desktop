import type { AgentCommand } from "./protocol";

export type WorkerInbound =
  | { kind: "command"; id: string; command: AgentCommand }
  | { kind: "shutdown" }
  | { kind: "ping" };

export type WorkerOutbound =
  | { kind: "result"; id: string; data?: unknown; error?: string }
  | { kind: "event"; event: Record<string, unknown> }
  | { kind: "pong" }
  | { kind: "fatal"; error: string };
