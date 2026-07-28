import { app, BrowserWindow, dialog, nativeImage, session } from "electron";
import { electronApp, is } from "@electron-toolkit/utils";
import { join } from "path";
import { existsSync } from "fs";
import { IpcChannels } from "../shared/protocol";
import { createUtilityProcessSpawnWorker } from "./agent-worker-host";
import { createAgentRunRegistry } from "./agent-run-registry";
import { broadcastRunsEvent, registerAgentRunsIpc } from "./agent-runs-ipc";
import { createSessionBroker } from "./session-broker";
import { registerModelsIpc } from "./models-ipc";
import { registerSessionsIpc } from "./sessions-ipc";
import { createMainWindow } from "./window";
import { bindBrowserTabRegistry, registerBrowserIpc, requestOpenBrowserTab, waitForBrowserTabReady } from "./browser-host";
import { createBrowserTabRegistry } from "./browser-tab-registry";
import { createBrowserAutomationHost } from "./browser-automation-host";
import type { BrowserRpcMethod } from "../shared/browser-automation";
import type { WorkerOutbound } from "../shared/agent-worker-messages";
import { registerPreviewIpc } from "./preview-ipc";
import { registerTerminalIpc } from "./terminal-host";
import { registerWorkspaceIpc } from "./workspace-ipc";
import { registerFilesIpc } from "./files-ipc";
import { registerSkillsIpc } from "./skills-ipc";
import { registerGitIpc } from "./git-ipc";
import { registerFsWatchIpc } from "./fs-watch-host";
import { registerWindowIpc } from "./window-ipc";
import { registerAsrIpc } from "./asr-host";
import { registerUpdateIpc } from "./update-host";
import { registerPiCliIpc } from "./pi-cli-host";
import { registerMarketIpc } from "./market-host";
import { registerCheckpointIpc } from "./checkpoint-ipc";
import { registerNotifyIpc } from "./notify-host";
import { ensurePiAgentEnvironment } from "./pi-env";
import { installApplicationMenu } from "./app-menu";
import { enableHardwareAcceleration } from "./gpu-flags";
import { installLocalFileProtocol, registerLocalFileScheme } from "./local-file-protocol";

/** GPU raster / compositing before ready (no-op if only software GL). */
enableHardwareAcceleration();
registerLocalFileScheme();

/** Packaged / desktop: only one running instance with one primary window. */
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  // ASR stream stdin can emit write EOF/EPIPE after the child exits — never crash the app.
  process.on("uncaughtException", (err) => {
    const msg = err instanceof Error ? err.message : String(err);
    const code = err && typeof err === "object" ? (err as NodeJS.ErrnoException).code : undefined;
    if (code === "EPIPE" || code === "EOF" || /^write EOF$/i.test(msg) || /EPIPE/i.test(msg)) {
      console.warn("[main] swallowed stream write error:", msg);
      return;
    }
    console.error("[main] uncaughtException:", err);
    try {
      dialog.showErrorBox(
        "A JavaScript error occurred in the main process",
        err instanceof Error && err.stack ? err.stack : msg,
      );
    } catch {
      // ignore dialog failures during early boot
    }
  });
  boot();
}

function boot(): void {
  const registryHolder: { current: ReturnType<typeof createAgentRunRegistry> | null } = {
    current: null,
  };
  const browserTabs = createBrowserTabRegistry();
  const browserAutomation = createBrowserAutomationHost({
    tabs: browserTabs,
    openTab: async ({ url }) => {
      const { tabId } = await requestOpenBrowserTab({ url });
      try {
        const ready = await waitForBrowserTabReady(tabId);
        return { tabId: ready.tabId, url: ready.url || url || "about:blank", webContentsId: ready.webContentsId };
      } catch {
        // Tab was created; guest may still be spinning up — return id for follow-up tools.
        return { tabId, url: url || "about:blank" };
      }
    },
  });
  bindBrowserTabRegistry(browserTabs);
  const brokerHolder: { current: ReturnType<typeof createSessionBroker> | null } = {
    current: null,
  };

  const broker = createSessionBroker({
    spawnWorker: createUtilityProcessSpawnWorker(),
    onWorkerMessage: (sessionId, msg: WorkerOutbound) => {
      registryHolder.current?.handleWorkerMessage(sessionId, msg);
      if (msg.kind !== "rpc_request") return;
      void (async () => {
        try {
          const result = await browserAutomation.handle({
            method: msg.method as BrowserRpcMethod,
            params: msg.params ?? {},
          });
          await brokerHolder.current?.sendRawIfAlive(sessionId, {
            kind: "rpc_response",
            id: msg.id,
            result,
          });
        } catch (err) {
          await brokerHolder.current?.sendRawIfAlive(sessionId, {
            kind: "rpc_response",
            id: msg.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      })();
    },
    onSessionWorkerGone: (sessionId) => registryHolder.current?.endSessionRuns(sessionId),
    hasActiveRuns: (sessionId) =>
      Boolean(registryHolder.current?.hasActiveRuns(sessionId)),
  });
  brokerHolder.current = broker;
  registryHolder.current = createAgentRunRegistry({
    onEvent: broadcastRunsEvent,
    sendTerminate: async (sessionId, runId) => {
      const ok = await broker.sendRawIfAlive(sessionId, {
        kind: "terminate_run",
        runId,
      });
      if (!ok) {
        throw new Error("worker unavailable");
      }
    },
  });

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
        input.shift &&
        !input.alt &&
        ((input.control && !input.meta) || (input.meta && !input.control))
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

    installLocalFileProtocol();
    installApplicationMenu();
    registerWindowIpc();
    registerAsrIpc();
    registerUpdateIpc();
    registerPiCliIpc();
    registerMarketIpc();
    registerCheckpointIpc();
    registerNotifyIpc();
    registerWorkspaceIpc();
    registerPreviewIpc();
    registerFilesIpc();
    registerFsWatchIpc();
    registerGitIpc();
    registerSkillsIpc();
    registerBrowserIpc();
    registerTerminalIpc();
    registerSessionsIpc(broker);
    registerAgentRunsIpc(registryHolder.current!);
    registerModelsIpc(broker);
    electronApp.setAppUserModelId("com.pi.desktop");

    // Allow mic/camera for ASR + embedded browser (macOS TCC still gates via askForMediaAccess).
    const allowPermissions = new Set([
      "media",
      "mediaKeySystem",
      "display-capture",
      "notifications",
      "clipboard-sanitized-write",
      "clipboard-read",
      "fullscreen",
      "pointerLock",
      "openExternal",
    ]);
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(allowPermissions.has(permission));
    });
    session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
      return allowPermissions.has(permission);
    });

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
