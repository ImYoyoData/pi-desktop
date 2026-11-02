import { agentBackendOf, type AgentBackend } from "../../../shared/agent-backend";
import { useWorkspaceStore } from "@renderer/stores/workspace";

/** 工作区选定的智能体后端；未选定或大小写不同时回落到 pi。 */
export function workspaceBackend(root: string): AgentBackend {
	const backends = useWorkspaceStore.getState().backends;
	const exact = backends[root];
	if (exact) return agentBackendOf(exact);
	const folded = root.toLowerCase();
	for (const [key, value] of Object.entries(backends)) {
		if (key.toLowerCase() === folded) return agentBackendOf(value);
	}
	return "pi";
}
