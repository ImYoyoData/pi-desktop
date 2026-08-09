import {
	app,
	BrowserWindow,
	dialog,
	nativeImage,
	session,
	systemPreferences,
} from "electron";
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
import {
	bindBrowserTabRegistry,
	registerBrowserIpc,
	requestOpenBrowserTab,
	waitForBrowserTabReady,
} from "./browser-host";
import { createBrowserTabRegistry } from "./browser-tab-registry";
import { createBrowserAutomationHost } from "./browser-automation-host";
import type { BrowserRpcMethod } from "../shared/browser-automation";
import type { WorkerOutbound } from "../shared/agent-worker-messages";
import type { SecurityCategory } from "../shared/desktop-security";
import { registerPreviewIpc } from "./preview-ipc";
import { registerTerminalIpc } from "./terminal-host";
import { registerWorkspaceIpc } from "./workspace-ipc";
import { registerFilesIpc } from "./files-ipc";
import { registerSkillsIpc } from "./skills-ipc";
import { registerGitIpc } from "./git-ipc";
import { registerFsWatchIpc } from "./fs-watch-host";
import { registerWindowIpc } from "./window-ipc";
import { registerAsrIpc } from "./asr-host";
import { registerTtsIpc } from "./tts-host";
import { registerUpdateIpc } from "./update-host";
import { registerPiCliIpc } from "./pi-cli-host";
import { registerMarketIpc } from "./market-host";
import { registerCheckpointIpc } from "./checkpoint-ipc";
import { registerNotifyIpc } from "./notify-host";
import {
	askRendererPermission,
	registerPermissionAskIpc,
} from "./permission-ask-host";
import {
	askRendererAskUser,
	questionsFromAskUserParams,
	registerAskUserIpc,
} from "./ask-user-host";
import {
	handleExtensionUiRpc,
	registerExtensionUiIpc,
} from "./extension-ui-host";
import { registerSecurityTrustIpc } from "./security-trust-ipc";
import { ensureLanConsoleFromSettings, registerLanConsoleIpc } from "./lan-console";
import { ensurePiAgentEnvironment } from "./pi-env";
import { installApplicationMenu } from "./app-menu";
import { enableHardwareAcceleration } from "./gpu-flags";
import {
	installLocalFileProtocol,
	registerLocalFileScheme,
} from "./local-file-protocol";
import { guardChromiumCacheDirs } from "./cache-guard";

/** GPU raster / compositing before ready (no-op if only software GL). */
enableHardwareAcceleration();
registerLocalFileScheme();

/**
 * Dev builds use their own userData dir, separate from the packaged app.
 * The packaged app and `npm run dev` otherwise share the default userData,
 * so running both at once locks the Chromium cache dirs and the second
 * instance logs "Unable to move the cache: access denied". A dedicated dev
 * dir means the two can run side by side without locking each other.
 * Must run before any getPath("userData") call / BrowserWindow.
 */
if (!app.isPackaged) {
	app.setPath("userData", join(app.getPath("appData"), "pi-desktop-dev"));
}

// Chromium cannot move/create its disk cache when stale dirs from a previous
// run are locked (second instance / crash / AV) — reset unusable ones now,
// before any BrowserWindow exists.
guardChromiumCacheDirs();

/**
 * Packaged builds: only one running instance with one primary window.
 * Dev builds do NOT take the lock — they run from their own userData dir
 * (see above) so parallel dev + packaged instances coexist safely.
 * Opt out on packaged builds with PI_DESKTOP_ALLOW_MULTI_INSTANCE=1.
 */
const allowMultiInstance = process.env.PI_DESKTOP_ALLOW_MULTI_INSTANCE === "1";
const gotSingleInstanceLock =
	app.isPackaged && !allowMultiInstance
		? app.requestSingleInstanceLock()
		: true;
if (!gotSingleInstanceLock) {
	app.quit();
} else {
	// ASR stream stdin can emit write EOF/EPIPE after the child exits — never crash the app.
	process.on("uncaughtException", (err) => {
		const msg = err instanceof Error ? err.message : String(err);
		const code =
			err && typeof err === "object"
				? (err as NodeJS.ErrnoException).code
				: undefined;
		if (
			code === "EPIPE" ||
			code === "EOF" ||
			/^write EOF$/i.test(msg) ||
			/EPIPE/i.test(msg)
		) {
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
	const registryHolder: {
		current: ReturnType<typeof createAgentRunRegistry> | null;
	} = {
		current: null,
	};
	const browserTabs = createBrowserTabRegistry();
	const browserAutomation = createBrowserAutomationHost({
		tabs: browserTabs,
		openTab: async ({ url }) => {
			const { tabId } = await requestOpenBrowserTab({ url });
			try {
				const ready = await waitForBrowserTabReady(tabId);
				return {
					tabId: ready.tabId,
					url: ready.url || url || "about:blank",
					webContentsId: ready.webContentsId,
				};
			} catch {
				// Tab was created; guest may still be spinning up — return id for follow-up tools.
				return { tabId, url: url || "about:blank" };
			}
		},
	});
	bindBrowserTabRegistry(browserTabs);
	const brokerHolder: {
		current: ReturnType<typeof createSessionBroker> | null;
	} = {
		current: null,
	};

	const broker = createSessionBroker({
		spawnWorker: createUtilityProcessSpawnWorker(),
		onWorkerMessage: (sessionId, msg: WorkerOutbound) => {
			registryHolder.current?.handleWorkerMessage(sessionId, msg);
			if (msg.kind !== "rpc_request") return;
			void (async () => {
				try {
					let result: unknown;
					if (msg.method === "desktop.permissionAsk") {
						const params = msg.params ?? {};
						const category = params.category;
						const toolName =
							typeof params.toolName === "string" ? params.toolName : "";
						const summary =
							typeof params.summary === "string" ? params.summary : "";
						if (category !== "bash" && category !== "write") {
							throw new Error("desktop.permissionAsk: invalid category");
						}
						if (!toolName) {
							throw new Error("desktop.permissionAsk: toolName required");
						}
						result = await askRendererPermission({
							sessionId,
							requestId: msg.id,
							category: category as SecurityCategory,
							toolName,
							summary,
						});
					} else if (msg.method === "desktop.askUser") {
						const questions = questionsFromAskUserParams(msg.params ?? {});
						if (!questions.length) {
							throw new Error("desktop.askUser: invalid or empty questions");
						}
						result = await askRendererAskUser({
							sessionId,
							requestId: msg.id,
							questions,
						});
					} else if (msg.method === "desktop.extensionUi") {
						result = await handleExtensionUiRpc(
							sessionId,
							msg.id,
							msg.params ?? {},
						);
					} else {
						result = await browserAutomation.handle({
							method: msg.method as BrowserRpcMethod,
							params: msg.params ?? {},
						});
					}
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
		onSessionWorkerGone: (sessionId) =>
			registryHolder.current?.endSessionRuns(sessionId),
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
		sendBackground: async (sessionId, runId) => {
			const ok = await broker.sendRawIfAlive(sessionId, {
				kind: "background_run",
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
				if (window.webContents.isDevToolsOpened())
					window.webContents.closeDevTools();
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
		installLocalFileProtocol();
		installApplicationMenu();

		// Critical IPC first — needed for shell, workspace, sessions.
		registerWindowIpc();
		registerWorkspaceIpc({
			purgeWorkspaceSessions: (cwd) => broker.purgeWorkspace(cwd),
		});
		registerSessionsIpc(broker);
		registerAgentRunsIpc(registryHolder.current!);
		registerModelsIpc(broker);
		registerPermissionAskIpc(broker);
		registerAskUserIpc();
		registerExtensionUiIpc();
		registerSecurityTrustIpc(broker);
		registerLanConsoleIpc(broker);
		registerPreviewIpc();
		registerFilesIpc();
		registerFsWatchIpc();
		registerGitIpc();
		registerSkillsIpc(broker);
		registerBrowserIpc();
		registerTerminalIpc();
		registerNotifyIpc();
		registerCheckpointIpc();
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

		async function ensureDarwinMediaAccess(
			mediaTypes: Array<"audio" | "video"> | undefined,
		): Promise<boolean> {
			if (process.platform !== "darwin") return true;
			const types = mediaTypes?.length
				? mediaTypes
				: (["audio", "video"] as const);
			for (const kind of types) {
				const tccKind = kind === "video" ? "camera" : "microphone";
				try {
					const status = systemPreferences.getMediaAccessStatus(tccKind);
					if (status === "granted") continue;
					if (status === "denied" || status === "restricted") return false;
					const ok = await systemPreferences.askForMediaAccess(tccKind);
					if (!ok) return false;
				} catch {
					return false;
				}
			}
			return true;
		}

		session.defaultSession.setPermissionRequestHandler(
			(_wc, permission, callback, details) => {
				void (async () => {
					if (!allowPermissions.has(permission)) {
						callback(false);
						return;
					}
					if (permission === "media") {
						const mediaTypes = (
							details as { mediaTypes?: Array<"audio" | "video"> }
						).mediaTypes;
						const ok = await ensureDarwinMediaAccess(mediaTypes);
						callback(ok);
						return;
					}
					callback(true);
				})();
			},
		);
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

		// Show UI as soon as possible — defer agent env setup and non-critical
		// hosts (ASR / update / market / CLI) so the window paints first.
		createMainWindow();

		setImmediate(() => {
			const init = ensurePiAgentEnvironment();
			if (init.created.length && is.dev) {
				console.info("[pi-env] initialized", init.agentDir, init.created);
			}
			registerAsrIpc();
			registerTtsIpc();
			registerUpdateIpc();
			registerPiCliIpc();
			registerMarketIpc(broker);
			// LAN cert generation can briefly block the event loop — wait until
			// the window has had a chance to paint and hydrate.
			setTimeout(() => {
				ensureLanConsoleFromSettings();
			}, 900);
		});

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
