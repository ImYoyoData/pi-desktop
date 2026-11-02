import { agentBackendOf, type AgentBackend } from "../../../shared/agent-backend";
import { useWorkspaceStore } from "@renderer/stores/workspace";

/** 全局智能体后端：所有工作区共用同一个引擎。 */
export function currentBackend(): AgentBackend {
	return agentBackendOf(useWorkspaceStore.getState().backend);
}
