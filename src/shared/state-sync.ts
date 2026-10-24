/**
 * 共享状态的范围：桌面端与浏览器预览页共享的东西都归到这些范围里。
 * 变更只经由一条通道（state:changed）广播，渲染端按范围重新读取并应用。
 */
export type StateScope =
	/** 偏好文件（~/.pi/agent/desktop-prefs.json）里的任何键。 */
	| "prefs"
	/** 当前工作区。 */
	| "workspace"
	/** 当前打开的会话。 */
	| "session"
	/** 模型目录与选择。 */
	| "models"
	/** 流式渲染设置。 */
	| "streamRender"
	/** 思考语言。 */
	| "thinkingLanguage"
	/** 重试设置。 */
	| "retry"
	/** 运行时设置。 */
	| "runtime"
	/** 代理设置。 */
	| "proxy";

export type StateChange = {
	scope: StateScope;
	/** 偏好变更涉及的键（scope=prefs 时有值）。 */
	keys?: string[];
	/** 范围相关负载：偏好为 {patch, removed}，其余为该范围的新值。 */
	payload?: unknown;
};
