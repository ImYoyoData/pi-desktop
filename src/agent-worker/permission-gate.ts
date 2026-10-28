/**
 * 工具审批扩展：命令与写文件类调用交给桌面端按档位判定，必要时等用户点确认。
 * main 侧拒绝（含超时 / 无 UI）一律按拒绝放行，避免审批链路失效时静默执行。
 */

import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { classifyToolName, type PermissionCheckResult } from "../shared/permissions";
import { rpcToMain } from "./main-rpc";

const DENY_REASON =
	"Blocked by Pi Desktop permission settings. Change the permission mode on the Permissions settings page to allow this action.";

function summarizeInput(
	input: Record<string, unknown>,
	command: string | undefined,
): string {
	if (command) return command;
	const path = input.path ?? input.filePath ?? input.file_path;
	if (typeof path === "string" && path.trim()) return path;
	try {
		return JSON.stringify(input).slice(0, 200);
	} catch {
		return "";
	}
}

function toResult(raw: unknown): PermissionCheckResult {
	if (raw && typeof raw === "object") {
		const row = raw as Record<string, unknown>;
		if (row.action === "allow") return { action: "allow" };
		if (typeof row.reason === "string" && row.reason.trim()) {
			return { action: "deny", reason: row.reason };
		}
	}
	return { action: "deny", reason: DENY_REASON };
}

export function createPermissionGateExtension(): ExtensionFactory {
	return (pi) => {
		pi.on("tool_call", async (event, ctx) => {
			const category = classifyToolName(event.toolName);
			if (!category) return undefined;

			const input =
				event.input && typeof event.input === "object"
					? (event.input as Record<string, unknown>)
					: {};
			const command =
				category === "bash" && typeof input.command === "string"
					? input.command
					: undefined;

			let result: PermissionCheckResult;
			try {
				const raw = await rpcToMain(
					"desktop.permissionCheck",
					{
						toolName: event.toolName,
						summary: summarizeInput(input, command),
						...(command ? { command } : {}),
					},
					null,
					ctx.signal,
				);
				result = toResult(raw);
			} catch (err) {
				const reason = err instanceof Error ? err.message : String(err);
				return { block: true, reason: `${DENY_REASON} (${reason})` };
			}

			return result.action === "allow"
				? undefined
				: { block: true, reason: result.reason };
		});
	};
}
