import * as WorkerThreads from "node:worker_threads";
import type { WorkerInbound as JsWorkerInbound, WorkerOutbound as JsWorkerOutbound } from "@oh-my-pi/pi-coding-agent/eval/js/worker-protocol";
import {
	AUTO_UPDATE_WORKER_ARG,
	BLOB_BROKER_WORKER_ARG,
	COMPUTER_WORKER_ARG,
	DAEMON_BROKER_WORKER_ARG,
	IDA_HOST_WORKER_ARG,
	LSP_MUX_WORKER_ARG,
	MNEMOPI_EMBED_SERVER_WORKER_ARG,
	PARENT_WATCHDOG_WORKER_ARG,
	STATS_ACTIVITY_WORKER_ARG,
	SUBAGENT_WORKER_ARG,
	TERMINAL_OUTPUT_WORKER_ARG,
	TEXT_PREDICT_WORKER_ARG,
} from "@oh-my-pi/pi-coding-agent/cli/worker-selectors";
import { startParentWatchdog } from "@oh-my-pi/pi-coding-agent/subprocess/parent-watchdog";
import { installWorkerInbox } from "@oh-my-pi/pi-utils/worker-host";
import { bindProcessInbox } from "./process-inbox";

const TINY_WORKER_ARG = "__omp_worker_tiny_inference";
const STATS_SYNC_WORKER_ARG = "__omp_worker_stats_sync";
const TAB_WORKER_ARG = "__omp_worker_tab";
const JS_EVAL_WORKER_ARG = "__omp_worker_js_eval";
const JS_EVAL_PROCESS_ARG = "__omp_worker_js_eval_process";
const STT_WORKER_ARG = "__omp_worker_stt";
const TTS_WORKER_ARG = "__omp_worker_tts";
const MNEMOPI_EMBED_WORKER_ARG = "__omp_worker_mnemopi_embed";

interface IpcTransport<In, Out> {
	send(message: Out): void;
	sendAndFlush(message: Out): Promise<void>;
	onMessage(handler: (message: In) => void): () => void;
}

function bindThreadInbox(): void {
	if (WorkerThreads.parentPort) installWorkerInbox(WorkerThreads.parentPort);
}

async function runIpcSubprocessWorker<In, Out>(
	start: (transport: IpcTransport<In, Out>) => void,
	rethrowConnectedSendErrors = false,
): Promise<void> {
	const { promise: shuttingDown, resolve: shutdown } = Promise.withResolvers<void>();
	type IpcSend = (this: NodeJS.Process, message: unknown, callback?: (error: Error | null) => void) => boolean;
	const ipcSend = (): IpcSend | undefined => (process as NodeJS.Process & { send?: IpcSend }).send;
	if (!ipcSend()) shutdown();
	const send = (message: Out): void => {
		const sender = ipcSend();
		if (!sender) {
			shutdown();
			return;
		}
		try {
			sender.call(process, message);
		} catch (error) {
			if (rethrowConnectedSendErrors && process.connected) throw error;
			shutdown();
		}
	};
	const sendAndFlush = (message: Out): Promise<void> => {
		const sender = ipcSend();
		if (!sender) {
			shutdown();
			return Promise.resolve();
		}
		const { promise, resolve } = Promise.withResolvers<void>();
		try {
			sender.call(process, message, () => resolve());
		} catch {
			shutdown();
			resolve();
		}
		return promise;
	};
	start({
		send,
		sendAndFlush,
		onMessage(handler) {
			const wrap = (data: unknown): void => handler(data as In);
			return bindProcessInbox(wrap);
		},
	});
	const initialParentPid = process.ppid;
	if (process.platform === "win32" && initialParentPid <= 0) {
		shutdown();
	} else if (initialParentPid > 0) {
		startParentWatchdog(initialParentPid);
	}
	const keepalive = setInterval(() => { }, 2 ** 30);
	process.on("disconnect", () => shutdown());
	try {
		await shuttingDown;
	} finally {
		clearInterval(keepalive);
	}
	process.kill(process.pid, "SIGKILL");
}

export async function runOmpWorkerEntry(selector: string): Promise<void> {
	switch (selector) {
		case TINY_WORKER_ARG: {
			const { startTinyWorkerFromEnvironment } = await import("@oh-my-pi/pi-coding-agent/tiny/worker");
			await startTinyWorkerFromEnvironment();
			return;
		}
		case STATS_SYNC_WORKER_ARG: {
			const scope = globalThis as unknown as { onmessage: ((event: MessageEvent) => void) | null };
			const pending: MessageEvent[] = [];
			const buffer = (event: MessageEvent): void => {
				pending.push(event);
			};
			scope.onmessage = buffer;
			await import("@oh-my-pi/omp-stats/sync-worker");
			const handler = scope.onmessage;
			if (handler && handler !== buffer) {
				for (const event of pending) handler.call(scope, event);
			}
			return;
		}
		case TAB_WORKER_ARG: {
			bindThreadInbox();
			await import("@oh-my-pi/pi-coding-agent/tools/browser/tab-worker-entry");
			return;
		}
		case COMPUTER_WORKER_ARG: {
			bindThreadInbox();
			const { startComputerWorker } = await import("@oh-my-pi/pi-coding-agent/tools/computer/worker-entry");
			startComputerWorker();
			return;
		}
		case JS_EVAL_WORKER_ARG: {
			bindThreadInbox();
			await import("@oh-my-pi/pi-coding-agent/eval/js/worker-entry");
			return;
		}
		case SUBAGENT_WORKER_ARG: {
			bindThreadInbox();
			await import("@oh-my-pi/pi-coding-agent/thread/subagent-worker-entry");
			return;
		}
		case JS_EVAL_PROCESS_ARG: {
			const { startJsEvalProcess } = await import("@oh-my-pi/pi-coding-agent/eval/js/process-entry");
			const { interceptUnhandledRejections } = await import("@oh-my-pi/pi-utils/postmortem");
			await runIpcSubprocessWorker<JsWorkerInbound, JsWorkerOutbound>(
				transport => startJsEvalProcess(transport, interceptUnhandledRejections),
				true,
			);
			return;
		}
		case STT_WORKER_ARG: {
			const { startSttWorker } = await import("@oh-my-pi/pi-coding-agent/stt/asr-worker");
			await runIpcSubprocessWorker(startSttWorker);
			return;
		}
		case TTS_WORKER_ARG: {
			const { startTtsWorker } = await import("@oh-my-pi/pi-coding-agent/tts/tts-worker");
			await runIpcSubprocessWorker(startTtsWorker);
			return;
		}
		case MNEMOPI_EMBED_WORKER_ARG: {
			const { startMnemopiEmbedWorker } = await import("@oh-my-pi/pi-coding-agent/mnemopi/embed-worker");
			await runIpcSubprocessWorker(startMnemopiEmbedWorker);
			return;
		}
		case MNEMOPI_EMBED_SERVER_WORKER_ARG: {
			const { startMnemopiEmbedServerFromEnvironment } = await import("@oh-my-pi/pi-coding-agent/mnemopi/embed-server");
			await startMnemopiEmbedServerFromEnvironment();
			return;
		}
		case STATS_ACTIVITY_WORKER_ARG: {
			const { startStatsActivityWorker } = await import("@oh-my-pi/pi-coding-agent/stats/activity-worker");
			await runIpcSubprocessWorker(startStatsActivityWorker);
			return;
		}
		case TERMINAL_OUTPUT_WORKER_ARG: {
			bindThreadInbox();
			await import("@oh-my-pi/pi-coding-agent/launch/terminal-output-worker");
			return;
		}
		case PARENT_WATCHDOG_WORKER_ARG: {
			bindThreadInbox();
			await import("@oh-my-pi/pi-coding-agent/subprocess/parent-watchdog-worker");
			return;
		}
		case DAEMON_BROKER_WORKER_ARG: {
			const { startDaemonBrokerFromEnvironment } = await import("@oh-my-pi/pi-coding-agent/launch/broker");
			await startDaemonBrokerFromEnvironment();
			return;
		}
		case LSP_MUX_WORKER_ARG: {
			const { startLspMuxFromEnvironment } = await import("@oh-my-pi/pi-coding-agent/lsp/mux/server");
			await startLspMuxFromEnvironment();
			return;
		}
		case IDA_HOST_WORKER_ARG: {
			const { startIdaHostFromEnvironment } = await import("@oh-my-pi/pi-coding-agent/ida/host");
			await startIdaHostFromEnvironment();
			return;
		}
		case BLOB_BROKER_WORKER_ARG: {
			const { startBlobBrokerFromEnvironment } = await import("@oh-my-pi/pi-coding-agent/blob-broker/server");
			await startBlobBrokerFromEnvironment();
			return;
		}
		case TEXT_PREDICT_WORKER_ARG: {
			const { startTextPredictDaemonFromEnvironment } = await import("@oh-my-pi/pi-coding-agent/predict/daemon");
			await startTextPredictDaemonFromEnvironment();
			return;
		}
		case AUTO_UPDATE_WORKER_ARG: {
			const { installGlobalProxyFetch } = await import("@oh-my-pi/pi-ai/utils/proxy");
			installGlobalProxyFetch();
			const { runAutoUpdateWorker } = await import("@oh-my-pi/pi-coding-agent/cli/auto-update");
			await runAutoUpdateWorker();
			return;
		}
		default: {
			process.stderr.write(`Error: unknown worker selector: ${selector}\n`);
			process.exitCode = 1;
		}
	}
}
