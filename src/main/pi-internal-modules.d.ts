/**
 * pi 内部模块的类型声明。
 *
 * MCP OAuth 登录（signInMcpServer / McpOAuthCredentialStore）与配置值解析没有从
 * pi-coding-agent 的入口导出，也没有允许 import 的子路径，实现里按文件路径别名
 * 引入（见 electron.vite.config.ts 的 pi-internal/*），这里只声明用到的部分。
 */

declare module "pi-internal/mcp-oauth" {
	export interface McpOAuthTokens {
		accessToken: string;
		refreshToken?: string;
		expiresIn?: number;
		scope?: string;
		tokenType?: string;
	}

	export interface McpOAuthState {
		serverUrl: string;
		tokens?: McpOAuthTokens;
		tokensExpireAt?: number;
	}

	export interface McpOAuthStateStore {
		load(): McpOAuthState | undefined | Promise<McpOAuthState | undefined>;
		save(state: McpOAuthState): void | Promise<void>;
	}

	export interface McpOAuthSettings {
		clientId?: string;
		clientSecret?: string;
		callbackPort?: number;
		callbackUrl?: string;
		scope?: string;
		clientName?: string;
	}

	export interface McpSignInPrompt {
		/** 展示授权地址并打开浏览器。 */
		showAuthorizationUrl(url: URL): void;
		/** 让用户粘贴回调地址；返回空值时取消登录。 */
		promptForRedirectUrl(signal: AbortSignal): Promise<string | undefined>;
	}

	export class McpSignInCancelledError extends Error {}

	export class McpOAuthCredentialStore {
		constructor(backend?: unknown, lockDir?: string);
		forServer(serverUrl: string): McpOAuthStateStore;
		/** 已存凭据；未登录过时返回 undefined。 */
		tokens(serverUrl: string): McpOAuthTokens | undefined;
		/** 删除凭据；返回是否存在过。 */
		remove(serverUrl: string): boolean;
	}

	export function signInMcpServer(options: {
		serverUrl: string;
		store: McpOAuthStateStore;
		settings: McpOAuthSettings;
		prompt: McpSignInPrompt;
	}): Promise<void>;
}

declare module "pi-internal/resolve-config-value" {
	export function resolveConfigValueOrThrow(
		config: string,
		description: string,
		env?: Record<string, string>,
	): string;
}
