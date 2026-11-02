/**
 * 桌面端支持的两套智能体后端：pi 与 omp（oh-my-pi）。
 *
 * 两者配置目录、模型配置格式、worker 协议都各自独立，只在桌面 UI 协议层面交汇。
 */
export type AgentBackend = "pi" | "omp";

export const AGENT_BACKENDS: readonly AgentBackend[] = ["pi", "omp"];

export const AGENT_BACKEND_LABELS: Record<AgentBackend, string> = {
	pi: "Pi",
	omp: "OMP",
};

export function isAgentBackend(value: unknown): value is AgentBackend {
	return value === "pi" || value === "omp";
}

/** 旧调用点没有引擎字段，一律按 pi 处理。 */
export function agentBackendOf(value: unknown): AgentBackend {
	return isAgentBackend(value) ? value : "pi";
}
