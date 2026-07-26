import { app, BrowserWindow, nativeImage } from "electron";
import { electronApp, is } from "@electron-toolkit/utils";
import { join } from "path";
import { existsSync } from "fs";
import { IpcChannels } from "../shared/protocol";
import { createUtilityProcessSpawnWorker } from "./agent-worker-host";
import { createSessionBroker } from "./session-broker";
import { registerModelsIpc } from "./models-ipc";
import { registerSessionsIpc } from "./sessions-ipc";
import { createMainWindow } from "./window";
import { registerBrowserIpc } from "./browser-host";
import { registerPreviewIpc } from "./preview-ipc";
import { registerTerminalIpc } from "./terminal-host";
import { registerWorkspaceIpc } from "./workspace-ipc";
import { registerFilesIpc } from "./files-ipc";
import { registerSkillsIpc } from "./skills-ipc";
import { registerGitIpc } from "./git-ipc";
import { registerFsWatchIpc } from "./fs-watch-host";
import { registerWindowIpc } from "./window-ipc";
import { registerAsrIpc } from "./asr-host";
import { ensurePiAgentEnvironment } from "./pi-env";
import { installApplicationMenu } from "./app-menu";

/** Packaged / desktop: only one running instance with one primary window. */
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  boot();
}

function boot(): void {
  const broker = createSessionBroker({ spawnWorker: createUtilityProcessSpawnWorker() });

  app.on("second-instance", () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) {
      createMainWindow();
      return;
    }
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });

  /** F12 → embedded browser DevTools. Ctrl+Shift+I opens app DT in dev only. */
  function installWindowShortcuts(window: BrowserWindow): void {
    window.webContents.on("before-input-event", (event, input) => {
      if (input.type !== "keyDown") return;

      if (input.key === "F12") {
        event.preventDefault();
        window.webContents.send(IpcChannels.browser.toggleEmbeddedDevTools);
        return;
      }

      if (
        is.dev &&
        input.code === "KeyI" &&
        input.control &&
        input.shift &&
        !input.alt &&
        !input.meta
      ) {
        event.preventDefault();
        if (window.webContents.isDevToolsOpened()) window.webContents.closeDevTools();
        else window.webContents.openDevTools({ mode: "detach" });
      }
    });
  }

  function resolveAppIcon(): string | undefined {
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

  app.whenReady().then(() => {
    const init = ensurePiAgentEnvironment();
    if (init.created.length && is.dev) {
      console.info("[pi-env] initialized", init.agentDir, init.created);
    }

    installApplicationMenu();
    registerWindowIpc();
    registerAsrIpc();
    registerWorkspaceIpc();
    registerPreviewIpc();
    registerFilesIpc();
    registerFsWatchIpc();
    registerGitIpc();
    registerSkillsIpc();
    registerBrowserIpc();
    registerTerminalIpc();
    registerSessionsIpc(broker);
    registerModelsIpc(broker);
    electronApp.setAppUserModelId("com.pi.desktop");

    const icon = resolveAppIcon();
    if (icon && process.platform === "darwin" && app.dock) {
      try {
        app.dock.setIcon(nativeImage.createFromPath(icon));
      } catch {
        // optional on some macOS / packaging layouts
      }
    }

    app.on("browser-window-created", (_, window) => {
      installWindowShortcuts(window);
    });

    createMainWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      } else {
        BrowserWindow.getAllWindows()[0]?.show();
      }
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
}
