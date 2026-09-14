import { net } from "electron";

/** Chromium 网络栈 —— 走 session 代理规则；绝不回退直连，避免绕过代理。 */
export function netFetch(url: string, init?: RequestInit): Promise<Response> {
	return net.fetch(url, init);
}
