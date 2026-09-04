import { app, ipcMain } from "electron";
import { IpcChannels } from "../shared/protocol";

const startMark = performance.now();
const startEpoch = Date.now() - startMark;

type StartupMark = { name: string; ms: number };

const marks: StartupMark[] = [];
let readyFlushed = false;

const lagSamples: string[] = [];
let lagTimer: ReturnType<typeof setInterval> | null = null;
let lastCpu: NodeJS.CpuUsage | null = null;
let lastWall = 0;

export function startLagMonitor(): void {
	if (process.env.PI_DESKTOP_STARTUP_TIMING !== "1") return;
	if (lagTimer) return;
	lastCpu = process.cpuUsage();
	lastWall = performance.now();
	lagTimer = setInterval(() => {
		const now = performance.now();
		const cpu = process.cpuUsage();
		const wallDelta = now - lastWall;
		const cpuDelta = lastCpu
			? (cpu.user + cpu.system - lastCpu.user - lastCpu.system) / 1000
			: 0;
		lastWall = now;
		lastCpu = cpu;
		lagSamples.push(
			`t=${(now - startMark).toFixed(0)} wall=${wallDelta.toFixed(0)} cpu=${cpuDelta.toFixed(0)}`,
		);
	}, 250);
	lagTimer.unref();
}

export function markStartup(name: string): void {
	if (marks.some((m) => m.name === name)) return;
	marks.push({ name, ms: performance.now() - startMark });
	if (name === "renderer:ready") {
		flushStartupTiming();
	}
}

function flushStartupTiming(): void {
	if (readyFlushed) return;
	readyFlushed = true;
	if (lagTimer) {
		clearInterval(lagTimer);
		lagTimer = null;
	}
	// Startup report (marks + renderer resources + loop lag) used to print here
	// and append to userData/startup-timing.log under PI_DESKTOP_STARTUP_TIMING=1.
	// See git history / docs/superpowers/plans for the measurement scripts.
	if (process.env.PI_DESKTOP_QUIT_AFTER_READY === "1") {
		setTimeout(() => app.quit(), 500);
	}
}

type HandleFn = typeof ipcMain.handle;

/** Time every IPC handler + report slow ones in the startup summary. */
export function installIpcTiming(): void {
	if (process.env.PI_DESKTOP_STARTUP_TIMING !== "1") return;
	const original: HandleFn = ipcMain.handle.bind(ipcMain);
	const wrapped: HandleFn = (channel, listener) => {
		return original(channel, async (event, ...args) => {
			const t0 = performance.now();
			try {
				return await listener(event, ...args);
			} finally {
				const dur = performance.now() - t0;
				if (dur > 30) {
					marks.push({
						name: `ipc:${String(channel)} ${dur.toFixed(0)}ms`,
						ms: t0 - startMark,
					});
				}
			}
		});
	};
	ipcMain.handle = wrapped;
}

export function registerStartupTimingIpc(): void {
	ipcMain.handle(
		IpcChannels.startupTiming.mark,
		(_event, payload: { name?: unknown; atEpochMs?: unknown }) => {
			if (!payload || typeof payload.name !== "string") return;
			if (typeof payload.atEpochMs !== "number") return;
			const ms = payload.atEpochMs - startEpoch;
			if (marks.some((m) => m.name === payload.name)) return;
			marks.push({ name: payload.name as string, ms });
			if (payload.name === "renderer:ready") {
				flushStartupTiming();
			}
		},
	);
}
