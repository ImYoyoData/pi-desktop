import { BrowserWindow, Menu, nativeImage, shell } from "electron";
import { join } from "path";
import { existsSync } from "fs";
import { is } from "@electron-toolkit/utils";
import { IpcChannels } from "../shared/protocol";
import { editMenuLabels } from "../shared/edit-menu-i18n";
import { getUiLocale, setUiLocale } from "./ui-locale";
import { bindWindowVisibility } from "./window-visibility";

export { getUiLocale, setUiLocale };

/** Standard cut/copy/paste/select-all context menu for editable fields and selections. */
function installEditContextMenu(win: BrowserWindow): void {
  win.webContents.on("context-menu", (_event, params) => {
    const { editFlags, isEditable, selectionText } = params;
    const L = editMenuLabels(getUiLocale());
    const wc = win.webContents;
    const items: Electron.MenuItemConstructorOptions[] = [];

    if (isEditable) {
      items.push(
        {
          label: L.undo,
          accelerator: "CmdOrCtrl+Z",
          enabled: editFlags.canUndo,
          click: () => {
            if (!win.isDestroyed()) wc.undo();
          },
        },
        {
          label: L.redo,
          accelerator:
            process.platform === "darwin" ? "Shift+CmdOrCtrl+Z" : "CmdOrCtrl+Y",
          enabled: editFlags.canRedo,
          click: () => {
            if (!win.isDestroyed()) wc.redo();
          },
        },
        { type: "separator" },
        {
          label: L.cut,
          accelerator: "CmdOrCtrl+X",
          enabled: editFlags.canCut,
          click: () => {
            if (!win.isDestroyed()) wc.cut();
          },
        },
        {
          label: L.copy,
          accelerator: "CmdOrCtrl+C",
          enabled: editFlags.canCopy,
          click: () => {
            if (!win.isDestroyed()) wc.copy();
          },
        },
        {
          label: L.paste,
          accelerator: "CmdOrCtrl+V",
          enabled: editFlags.canPaste,
          click: () => {
            if (!win.isDestroyed()) wc.paste();
          },
        },
        {
          label: L.delete,
          enabled: editFlags.canDelete,
          click: () => {
            if (!win.isDestroyed()) wc.delete();
          },
        },
        { type: "separator" },
        {
          label: L.selectAll,
          accelerator: "CmdOrCtrl+A",
          enabled: editFlags.canSelectAll,
          click: () => {
            if (!win.isDestroyed()) wc.selectAll();
          },
        },
      );
    } else if (selectionText?.trim()) {
      items.push({
        label: L.copy,
        accelerator: "CmdOrCtrl+C",
        enabled: editFlags.canCopy,
        click: () => {
          if (!win.isDestroyed()) wc.copy();
        },
      });
      if (editFlags.canSelectAll) {
        items.push(
          { type: "separator" },
          {
            label: L.selectAll,
            accelerator: "CmdOrCtrl+A",
            enabled: true,
            click: () => {
              if (!win.isDestroyed()) wc.selectAll();
            },
          },
        );
      }
    } else {
      return;
    }

    Menu.buildFromTemplate(items).popup({ window: win });
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

export function allowWindowClose(): void {
  allowClose = true;
}

export function createMainWindow(): BrowserWindow {
  allowClose = false;
  const isMac = process.platform === "darwin";
  const iconPath = resolveWindowIcon();

  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
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
    if (!mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show();
    }
  });

  mainWindow.on("close", (event) => {
    if (allowClose) return;
    event.preventDefault();
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IpcChannels.window.closeRequest);
    }
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url);
    return { action: "deny" };
  });

  installEditContextMenu(mainWindow);
  // Pause high-frequency IPC (terminal / run-output flushing) while hidden.
  bindWindowVisibility(mainWindow);

  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    void mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }

  return mainWindow;
}
