import { app, BrowserWindow } from "electron";
import { electronApp, is } from "@electron-toolkit/utils";
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

const broker = createSessionBroker({ spawnWorker: createUtilityProcessSpawnWorker() });

/** F12 → embedded browser DevTools (never the shell window). Ctrl+Shift+I still opens app DT in dev. */
function installWindowShortcuts(window: BrowserWindow): void {
  window.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;

    if (input.key === "F12") {
      event.preventDefault();
      window.webContents.send(IpcChannels.browser.toggleEmbeddedDevTools);
      return;
    }

    // Keep a way to debug the shell UI itself in development only
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

app.whenReady().then(() => {
  registerWindowIpc();
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

  app.on("browser-window-created", (_, window) => {
    installWindowShortcuts(window);
  });

  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
