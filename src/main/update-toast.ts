import { BrowserWindow, ipcMain, screen } from "electron";
import { join } from "node:path";
import { IpcChannels } from "../shared/protocol";
import type { AppUpdateState } from "../shared/update";

/** 卡片宽度（不含投影留白）。 */
const CARD_WIDTH = 340;
/** 透明留白：给卡片投影留出绘制空间，与 update-toast.css 的 #app 内边距一致。 */
const TOAST_GUTTER = 10;
const TOAST_WIDTH = CARD_WIDTH + TOAST_GUTTER * 2;
/** 卡片与屏幕可用区域右下角的间距。 */
const TOAST_MARGIN = 16;
const MIN_CARD_HEIGHT = 60;

/** 只有这些状态才有可交互的卡片；其余状态收起悬浮窗。 */
const VISIBLE_STATUS: Partial<Record<AppUpdateState["status"], true>> = {
	downloading: true,
	ready: true,
	error: true,
};

let toastWindow: BrowserWindow | null = null;
let toastHeight = MIN_CARD_HEIGHT + TOAST_GUTTER * 2;
let lastState: AppUpdateState = {
	status: "idle",
	info: null,
	progress: null,
	error: null,
};
let dismissed = false;
/** 新建窗口时先等渲染层回报卡片高度，避免露出被裁切的卡片。 */
let pendingShow = false;
let showTimer: NodeJS.Timeout | null = null;

/** 贴到主显示器工作区的右下角；任务栏与多显示器缩放在 workArea 里已扣除。 */
function placeToast(win: BrowserWindow): void {
	const area = screen.getPrimaryDisplay().workArea;
	const [width, height] = win.getContentSize();
	win.setPosition(
		area.x + area.width - width - TOAST_MARGIN,
		area.y + area.height - height - TOAST_MARGIN,
	);
}

function createToastWindow(): BrowserWindow {
	const win = new BrowserWindow({
		width: TOAST_WIDTH,
		height: toastHeight,
		show: false,
		frame: false,
		transparent: true,
		backgroundColor: "#00000000",
		hasShadow: false,
		resizable: false,
		movable: false,
		minimizable: false,
		maximizable: false,
		fullscreenable: false,
		skipTaskbar: true,
		alwaysOnTop: true,
		webPreferences: {
			preload: join(__dirname, "../preload/index.js"),
			sandbox: false,
			contextIsolation: true,
		},
	});
	const devUrl = process.env.ELECTRON_RENDERER_URL;
	if (devUrl) void win.loadURL(`${devUrl}/update-toast.html`);
	else void win.loadFile(join(__dirname, "../renderer/update-toast.html"));
	win.on("closed", () => {
		toastWindow = null;
	});
	placeToast(win);
	toastWindow = win;
	return win;
}

function revealToast(win: BrowserWindow): void {
	if (win.isDestroyed() || !VISIBLE_STATUS[lastState.status] || dismissed) return;
	pendingShow = false;
	if (showTimer) {
		clearTimeout(showTimer);
		showTimer = null;
	}
	// 进度每推一次都会走到这里；已可见时不能再 setPosition：
	// 无边框窗口在 125% 缩放下每次定位都会被 Windows 重新取整，窗口会越挪越大。
	if (win.isVisible()) return;
	placeToast(win);
	win.showInactive();
}

function hideToast(): void {
	pendingShow = false;
	if (showTimer) {
		clearTimeout(showTimer);
		showTimer = null;
	}
	if (toastWindow && !toastWindow.isDestroyed()) toastWindow.hide();
}

/** 跟随主进程广播的更新状态显示/收起卡片；用户手动收起后同一状态不再弹出。 */
export function syncUpdateToast(state: AppUpdateState): void {
	if (state.status !== lastState.status) {
		dismissed = false;
		lastState = state;
	}
	if (!VISIBLE_STATUS[state.status] || dismissed) {
		hideToast();
		return;
	}
	const existing = toastWindow && !toastWindow.isDestroyed() ? toastWindow : null;
	const win = existing ?? createToastWindow();
	if (existing) {
		revealToast(win);
		return;
	}
	pendingShow = true;
	if (showTimer) clearTimeout(showTimer);
	showTimer = setTimeout(() => revealToast(win), 800);
}

/** 更新悬浮窗不参与界面状态同步（它只关心更新进度）。 */
export function isUpdateToastWindow(win: BrowserWindow): boolean {
	return toastWindow === win;
}

/** 主窗口关闭时一起销毁，避免只剩悬浮窗把进程留在后台。 */
export function closeUpdateToast(): void {
	pendingShow = false;
	if (showTimer) {
		clearTimeout(showTimer);
		showTimer = null;
	}
	if (toastWindow && !toastWindow.isDestroyed()) toastWindow.destroy();
	toastWindow = null;
}

export function registerUpdateToastIpc(): void {
	ipcMain.on(IpcChannels.update.toastResize, (_event, height: number) => {
		if (!Number.isFinite(height)) return;
		const next = Math.max(MIN_CARD_HEIGHT, Math.ceil(height)) + TOAST_GUTTER * 2;
		if (next !== toastHeight) {
			toastHeight = next;
			if (toastWindow && !toastWindow.isDestroyed()) {
				toastWindow.setContentSize(TOAST_WIDTH, next);
				placeToast(toastWindow);
			}
		}
		// 首次创建要等到这张卡片量出高度再显示，否则会先闪一帧被裁切的卡片。
		if (pendingShow && toastWindow && !toastWindow.isDestroyed()) revealToast(toastWindow);
	});

	ipcMain.on(IpcChannels.update.toastDismiss, () => {
		dismissed = true;
		hideToast();
	});

	ipcMain.on(IpcChannels.update.toastShow, () => {
		dismissed = false;
		syncUpdateToast(lastState);
	});
}
