/**
 * 应用级事件订阅：进程级 IPC 监听只在应用启动时注册一次，不挂在任何组件生命周期上。
 *
 * 背景：会话事件由主进程单向推送到渲染进程，渲染端没有补发机制。一旦监听随组件
 * 卸载被摘掉，那一段时间的事件就永久丢失——worker 与模型都正常，界面却会永远停在
 * 「等待模型响应」。ChatPanel 会被 `v-if` 反复销毁重建（切到拉取请求视图即卸载），
 * 正是这个坑的触发点。
 *
 * 这里显式持有解绑链，不用 effectScope：解绑顺序与内容一目了然，也不依赖 Vue 的
 * 隐式 scope 行为。
 */
import { useAgentRunsStore } from "./stores/agent-runs";
import { useChatStore } from "./stores/chat";
import { useSessionsStore } from "./stores/sessions";
import { startFsChangedBus } from "./utils/fs-changed-bus";

let teardown: (() => void) | null = null;

/**
 * 注册全部进程级订阅，返回解绑函数。幂等：重复调用返回同一个解绑函数。
 * 必须在 pinia 安装之后调用。
 */
export function bootstrapAppEvents(): () => void {
	if (teardown) return teardown;

	const runs = useAgentRunsStore();
	runs.bind();
	const stops: Array<() => void> = [
		useSessionsStore().bindEvents(),
		useChatStore().bindEvents(),
		startFsChangedBus(),
		runs.unbind,
	];

	teardown = () => {
		teardown = null;
		for (const stop of stops) stop();
	};
	return teardown;
}

/** 订阅是否处于绑定状态（测试与诊断用）。 */
export function isAppEventsBound(): boolean {
	return teardown !== null;
}