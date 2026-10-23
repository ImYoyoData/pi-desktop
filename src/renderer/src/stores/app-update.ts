import { create } from "zustand";
import type { AppUpdateState } from "../../../shared/update";

type AppUpdateStore = {
	/** 主进程广播的更新状态。 */
	state: AppUpdateState;
	/** 当前这次更新是否由「测试自动更新」发起（重试时保持同样的行为）。 */
	forced: boolean;
	check: () => Promise<AppUpdateState>;
	download: () => Promise<void>;
	/** 真实更新测试：忽略版本比较，下载并安装最新发布版。 */
	forceUpdate: () => Promise<void>;
	/** 失败后重试：按当前这次更新的来源重跑。 */
	retry: () => Promise<void>;
	cancel: () => Promise<void>;
	install: () => Promise<void>;
};

const INITIAL_STATE: AppUpdateState = {
	status: "idle",
	info: null,
	progress: null,
	error: null,
};

/** 应用更新状态：脱离标题栏与进度框组件存活，切换界面不丢进度。 */
export const useAppUpdateStore = create<AppUpdateStore>()((set, get) => {
	window.api.update.onState((state) => {
		set({ state });
	});

	// 组件挂载前可能已完成检查，先取一次主进程状态兜底。
	void window.api.update.getState().then((state) => {
		if (get().state.status !== "idle") return;
		set({ state });
	});

	return {
		state: INITIAL_STATE,
		forced: false,
		check: async () => {
			set({ state: { ...get().state, status: "checking" } });
			const state = await window.api.update.check();
			set({ state });
			return state;
		},
		download: async () => {
			await window.api.update.download();
		},
		forceUpdate: async () => {
			set({ forced: true });
			await window.api.update.forceUpdate();
		},
		retry: async () => {
			if (get().forced) {
				await window.api.update.forceUpdate();
				return;
			}
			if (get().state.info) {
				await window.api.update.download();
				return;
			}
			const state = await window.api.update.check();
			set({ state });
			if (state.status === "available") {
				await window.api.update.download();
			}
		},
		cancel: async () => {
			await window.api.update.cancel();
		},
		install: async () => {
			// 安装器启动后主进程立即退出，IPC 可能来不及回包，这里忽略失败。
			try {
				await window.api.update.install();
			} catch {
				// 主进程已退出
			}
		},
	};
});
