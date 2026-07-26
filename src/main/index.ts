import { app, BrowserWindow } from "electron";
import { electronApp, optimizer } from "@electron-toolkit/utils";
import { createUtilityProcessSpawnWorker } from "./agent-worker-host";
import { createSessionBroker } from "./session-broker";
import { registerModelsIpc } from "./models-ipc";
import { registerSessionsIpc } from "./sessions-ipc";
import { createMainWindow } from "./window";
import { registerPreviewIpc } from "./preview-ipc";
import { registerTerminalIpc } from "./terminal-host";
import { registerWorkspaceIpc } from "./workspace-ipc";

const broker = createSessionBroker({ spawnWorker: createUtilityProcessSpawnWorker() });

app.whenReady().then(() => {
  registerWorkspaceIpc();
  registerPreviewIpc();
  registerTerminalIpc();
  registerSessionsIpc(broker);
  registerModelsIpc(broker);
  electronApp.setAppUserModelId("com.pi.desktop");

  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
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
