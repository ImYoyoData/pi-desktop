/**
 * MCP OAuth：凭据状态、登录与登出（pi 存于 agentDir/mcp-auth.json）。
 *
 * 登录走 pi 的 signInMcpServer：浏览器授权码 + 本机回调端口，回调不可达时
 * 退回让用户粘贴回调地址。
 */

import {
	McpOAuthCredentialStore,
	signInMcpServer,
	type McpOAuthSettings,
} from "pi-internal/mcp-oauth";
import { resolveConfigValueOrThrow } from "pi-internal/resolve-config-value";
import type { McpAuthState, McpAuthTarget } from "../shared/customizations";
import { readMcpEntry } from "./customizations-host";

const store = new McpOAuthCredentialStore();

/** 与 pi MCP 扩展一致：url 型、无 auth.provider、无 Authorization 头才走 OAuth。 */
export function mcpOAuthUrl(entry: Record<string, unknown>): string | null {
	const url = entry.url;
	if (typeof url !== "string" || !url) return null;
	if (entry.auth && typeof entry.auth === "object") return null;
	const headers = entry.headers;
	if (headers && typeof headers === "object" && !Array.isArray(headers)) {
		const hasAuth = Object.keys(headers).some(
			(header) => header.toLowerCase() === "authorization",
		);
		if (hasAuth) return null;
	}
	return url;
}

function readEntry(target: McpAuthTarget): Record<string, unknown> | null {
	return readMcpEntry(target.name, target.scope, target.workspace);
}

/** 服务器是否使用 OAuth（HTTP url 型）。 */
export function mcpUsesOAuth(target: McpAuthTarget): boolean {
	const entry = readEntry(target);
	return entry ? mcpOAuthUrl(entry) !== null : false;
}

/** 读取已存 OAuth 凭据状态；未登录或非 OAuth 服务器均为未认证。 */
export async function readMcpAuthState(target: McpAuthTarget): Promise<McpAuthState> {
	const entry = readEntry(target);
	const url = entry ? mcpOAuthUrl(entry) : null;
	if (!url) return { oauth: false, authenticated: false };
	const state = await store.forServer(target.name, url).load();
	const tokens = state?.tokens;
	return {
		oauth: true,
		authenticated: Boolean(tokens?.accessToken),
		...(typeof state?.tokensExpireAt === "number"
			? { expiresAt: state.tokensExpireAt }
			: {}),
	};
}

/** 删除已存凭据；返回是否存在过。 */
export function mcpLogout(target: McpAuthTarget): boolean {
	const entry = readEntry(target);
	const url = entry ? mcpOAuthUrl(entry) : null;
	if (!url) return false;
	return store.remove(target.name, url);
}

/** mcp.json 的 oauth 段，clientSecret 按 pi 的规则解析环境变量 / 命令。 */
function oauthSettings(entry: Record<string, unknown>, name: string): McpOAuthSettings {
	const raw = entry.oauth;
	const oauth =
		raw && typeof raw === "object" && !Array.isArray(raw)
			? (raw as Record<string, unknown>)
			: {};
	const text = (value: unknown): string | undefined =>
		typeof value === "string" && value ? value : undefined;
	const metadataText = text(oauth.authServerMetadataUrl);
	let metadataUrl: URL | undefined;
	if (metadataText) {
		try {
			metadataUrl = new URL(metadataText);
		} catch {
			throw new Error(
				`MCP server "${name}" oauth.authServerMetadataUrl is not a valid URL: ${metadataText}`,
			);
		}
	}
	return {
		...(text(oauth.clientId) ? { clientId: text(oauth.clientId) } : {}),
		...(text(oauth.clientSecret)
			? {
					clientSecret: resolveConfigValueOrThrow(
						text(oauth.clientSecret)!,
						`MCP server "${name}" oauth.clientSecret`,
					),
				}
			: {}),
		...(typeof oauth.callbackPort === "number"
			? { callbackPort: oauth.callbackPort }
			: {}),
		...(text(oauth.callbackUrl) ? { callbackUrl: text(oauth.callbackUrl) } : {}),
		...(text(oauth.scope) ? { scope: text(oauth.scope) } : {}),
		...(text(oauth.clientName) ? { clientName: text(oauth.clientName) } : {}),
		...(metadataUrl ? { authServerMetadataUrl: metadataUrl } : {}),
	};
}

export type McpLoginHooks = {
	/** 进展文字（已打开浏览器、等待回调等）。 */
	onInfo: (message: string) => void;
	/** 需要用户在浏览器打开的授权地址。 */
	onAuthorizationUrl: (url: string) => void;
	/** 让用户粘贴回调地址；返回空值取消登录。 */
	promptForRedirectUrl: (signal: AbortSignal) => Promise<string | undefined>;
};

/** 登录一个 OAuth MCP 服务器；用户取消时抛 McpSignInCancelledError。 */
export async function mcpLogin(
	target: McpAuthTarget,
	hooks: McpLoginHooks,
): Promise<void> {
	const entry = readEntry(target);
	if (!entry) throw new Error(`MCP server "${target.name}" not found`);
	const url = mcpOAuthUrl(entry);
	if (!url) throw new Error(`MCP server "${target.name}" does not use OAuth`);
	hooks.onInfo(`正在登录 ${url}`);
	await signInMcpServer({
		serverUrl: url,
		store: store.forServer(target.name, url),
		settings: oauthSettings(entry, target.name),
		prompt: {
			showAuthorizationUrl: (authorizationUrl) => {
				hooks.onAuthorizationUrl(authorizationUrl.toString());
			},
			promptForRedirectUrl: (signal) => hooks.promptForRedirectUrl(signal),
		},
	});
}
