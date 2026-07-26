import { BrowserWindow, nativeImage, shell } from "electron";
import { join } from "path";
import { existsSync } from "fs";
import { is } from "@electron-toolkit/utils";

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

export function createMainWindow(): BrowserWindow {
  const isMac = process.platform === "darwin";
  const iconPath = resolveWindowIcon();

  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#f5f5f5",
    title: "Pi Desktop",
    ...(iconPath ? { icon: nativeImage.createFromPath(iconPath) } : {}),
    titleBarStyle: isMac ? "hiddenInset" : "hidden",
    ...(isMac
      ? { trafficLightPosition: { x: 16, y: 12 } }
      : {
          titleBarOverlay: {
            color: "#f5f5f5",
            symbolColor: "#6b7280",
            height: 36,
          },
        }),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
      contextIsolation: true,
      webviewTag: true,
      spellcheck: true,
    },
  });

  mainWindow.on("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url);
    return { action: "deny" };
  });

  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    void mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }

  return mainWindow;
}
