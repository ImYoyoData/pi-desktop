import { BrowserWindow, nativeImage, shell } from "electron";
import { join } from "path";
import { existsSync } from "fs";
import { is } from "@electron-toolkit/utils";
import { IpcChannels } from "../shared/protocol";
import type { EditContextMenuPayload } from "../shared/context-menu";
import { editMenuLabels } from "../shared/edit-menu-i18n";
import { getUiLocale, setUiLocale } from "./ui-locale";
import { bindWindowVisibility } from "./window-visibility";
import { closeUpdateToast } from "./update-toast";
import { resolveWindowSize, trackWindowSize } from "./window-size";

export { getUiLocale, setUiLocale };

/** 可编辑字段与文本选区的右键菜单：转发给渲染进程自绘，命令仍由主进程执行。 */
function installEditContextMenu(win: BrowserWindow): void {
  win.webContents.on("context-menu", (_event, params) => {
    const { editFlags, isEditable, selectionText } = params;
    if (!isEditable && !selectionText?.trim()) return;
    if (win.isDestroyed()) return;
    const payload: EditContextMenuPayload = {
      x: params.x,
      y: params.y,
      isEditable,
      labels: editMenuLabels(getUiLocale()),
      canUndo: editFlags.canUndo,
      canRedo: editFlags.canRedo,
      canCut: editFlags.canCut,
      canCopy: editFlags.canCopy,
      canPaste: editFlags.canPaste,
      canDelete: editFlags.canDelete,
      canSelectAll: editFlags.canSelectAll,
    };
    win.webContents.send(IpcChannels.window.contextMenu, payload);
  });
}

function resolveWindowIcon(): string | undefined {
  const candidates = [
    join(process.resourcesPath, "resources", "icon.png"),
    join(process.resourcesPath, "icon.png"),
    join(__dirname, "../../build/icon.png"),
    join(__dirname, "../../resources/icon.png"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return undefined;
}

/** When true, the next close/quit proceeds without asking the renderer. */
let allowClose = false;

/** 程序化退出（更新安装）时不再向渲染层询问，直接放行关闭。 */
let forceClosing = false;

export function allowWindowClose(): void {
  allowClose = true;
}

export function allowForceClose(): void {
  forceClosing = true;
}

export function createMainWindow(): BrowserWindow {
  allowClose = false;
  forceClosing = false;
  const isMac = process.platform === "darwin";
  const iconPath = resolveWindowIcon();
  // 记住窗口大小开着就用上次的大小，否则按屏幕像素 1550×960 换算成 DIP。
  const { width: initialWidth, height: initialHeight } = resolveWindowSize();

  const mainWindow = new BrowserWindow({
    width: initialWidth,
    height: initialHeight,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#f7f7f8",
    title: "Pi Desktop",
    ...(iconPath ? { icon: nativeImage.createFromPath(iconPath) } : {}),
    titleBarStyle: isMac ? "hiddenInset" : "hidden",
    ...(isMac ? { trafficLightPosition: { x: 14, y: 11 } } : {}),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
      contextIsolation: true,
      webviewTag: true,
      spellcheck: process.env.PI_DESKTOP_NO_SPELLCHECK !== "1",
    },
  });

  mainWindow.on("maximize", () => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IpcChannels.window.onMaximized);
    }
  });
  mainWindow.on("unmaximize", () => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IpcChannels.window.onUnmaximized);
    }
  });

  mainWindow.on("ready-to-show", () => {
    if (!mainWindow.isDestroyed()) mainWindow.show();
  });

  // Failsafe: if ready-to-show is late/missed, still surface the window.
  mainWindow.webContents.once("did-finish-load", () => {
    // 旧版本用窗口缩放调字号，这里清掉残留的缩放，字号改由根元素字体控制。
    mainWindow.webContents.setZoomFactor(1);
    if (!mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show();
    }
  });

  mainWindow.on("close", (event) => {
    if (allowClose || forceClosing) return;
    event.preventDefault();
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IpcChannels.window.closeRequest);
    }
  });

  mainWindow.on("closed", () => closeUpdateToast());

  mainWindow.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url);
    return { action: "deny" };
  });

  installEditContextMenu(mainWindow);
  // Pause high-frequency IPC (terminal / run-output flushing) while hidden.
  bindWindowVisibility(mainWindow);
  trackWindowSize(mainWindow);

  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    void mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }

  return mainWindow;
}
