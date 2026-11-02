import type { AgentCommand } from "./protocol";

/**
 * 桌面主进程 ↔ OMP worker 的私有协议。
 *
 * 与 pi 的 worker 协议刻意分开：两者由不同 SDK 驱动，命令支持与事件补充
 * 都不一样，共用一份会让任何一侧的改动同时压到另一侧。
 */
export type OmpWorkerInbound =
	| { kind: "init"; cwd: string; filePath?: string }
	| { kind: "command"; id: string; command: AgentCommand }
	| { kind: "reload_models" }
	| { kind: "shutdown" }
	| { kind: "ping" };

export type OmpWorkerOutbound =
	| {
			kind: "ready";
			id: string;
			filePath: string;
			cwd: string;
			/** omp SDK 实际使用的配置目录，主进程据此定位会话与模型配置。 */
			agentDir: string;
	  }
	| { kind: "result"; id: string; data?: unknown; error?: string }
	| { kind: "event"; event: Record<string, unknown> }
	| { kind: "pong" }
	| { kind: "fatal"; error: string };
