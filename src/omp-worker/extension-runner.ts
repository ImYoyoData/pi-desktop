import type {
	AgentSession,
	ExtensionUIContext,
} from "@oh-my-pi/pi-coding-agent";
import {
	runExtensionCompact,
	runExtensionSetModel,
} from "@oh-my-pi/pi-coding-agent/extensibility/extensions/compact-handler";
import { getSessionSlashCommands } from "@oh-my-pi/pi-coding-agent/extensibility/extensions/get-commands-handler";

export async function activateExtensionUI(
	session: AgentSession,
	uiContext: ExtensionUIContext,
): Promise<void> {
	const runner = session.extensionRunner;
	if (!runner) return;
	runner.initialize(
		{
			sendMessage: (message, options) => {
				void session.sendCustomMessage(message, options).catch(() => {});
			},
			sendUserMessage: (content, options) => {
				void session.sendUserMessage(content, options).catch(() => {});
			},
			appendEntry: (customType, data) => {
				session.sessionManager.appendCustomEntry(customType, data);
			},
			setLabel: (targetId, label) => {
				session.sessionManager.appendLabelChange(targetId, label);
			},
			getActiveTools: () => session.getEnabledToolNames(),
			getAllTools: () => session.getAllToolInfos(),
			setActiveTools: (names) => session.setActiveToolsByName(names),
			getCommands: () => getSessionSlashCommands(session),
			setModel: (model) => runExtensionSetModel(session, model),
			getThinkingLevel: () => session.thinkingLevel,
			setThinkingLevel: (level) => session.setThinkingLevel(level),
			getServiceTiers: () => session.serviceTierByFamily,
			setServiceTier: (family, tier) => session.setServiceTierFamily(family, tier),
			getSessionName: () => session.sessionManager.getSessionName(),
			setSessionName: async (name) => {
				await session.setSessionName(name, "user");
			},
		},
		{
			getModel: () => session.model,
			isIdle: () => !session.isStreaming,
			abort: () => {
				void session.abort();
			},
			hasPendingMessages: () => session.queuedMessageCount > 0,
			shutdown: () => {},
			getContextUsage: () => session.getContextUsage(),
			getSystemPrompt: () => session.systemPrompt,
			runEphemeralTurn: (options) => session.runEphemeralTurn(options),
			compact: (instructionsOrOptions) =>
				runExtensionCompact(session, instructionsOrOptions),
		},
		{
			getContextUsage: () => session.getContextUsage(),
			waitForIdle: () => session.waitForIdle(),
			newSession: async (options) => {
				const created = await session.newSession({
					parentSession: options?.parentSession,
				});
				if (!created) return { cancelled: true };
				if (options?.setup) await options.setup(session.sessionManager);
				return { cancelled: false };
			},
			branch: async (entryId) => {
				const result = await session.branch(entryId);
				return { cancelled: result.cancelled };
			},
			navigateTree: async (targetId, options) => {
				const result = await session.navigateTree(targetId, {
					summarize: options?.summarize,
				});
				return { cancelled: result.cancelled };
			},
			switchSession: async (sessionPath) => {
				const opened = await session.switchSession(sessionPath);
				return { cancelled: !opened };
			},
			reload: () => session.reload(),
			compact: (instructionsOrOptions) =>
				runExtensionCompact(session, instructionsOrOptions),
		},
		uiContext,
		"rpc",
	);
	await runner.emit({ type: "session_start" });
}
