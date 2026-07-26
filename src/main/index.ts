import { app, BrowserWindow } from "electron";
import { electronApp, optimizer } from "@electron-toolkit/utils";
import { createMainWindow } from "./window";
import { registerWorkspaceIpc } from "./workspace-ipc";

app.whenReady().then(() => {
  registerWorkspaceIpc();
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
