import { BrowserWindow, app, ipcMain } from "electron";
import { IpcChannels } from "../shared/protocol";
import {
	beginCheckpoint,
	finishActiveCheckpoint,
	finishCheckpoint,
	getCheckpointSummary,
	initCheckpointPersistence,
	listSessionCheckpointSummaries,
	revertCheckpoint,
	type CheckpointSummary,
} from "./checkpoint-host";
import { getWorkspace } from "./workspace-ipc";
import { flushPendingFsWatch } from "./fs-watch-host";

function broadcastUpdated(summary: CheckpointSummary): void {
	for (const win of BrowserWindow.getAllWindows()) {
		win.webContents.send(IpcChannels.checkpoint.updated, summary);
	}
}

export function registerCheckpointIpc(): void {
	// Persist summary metadata under userData so history keeps its revert
	// button across session switches / app restarts.
	initCheckpointPersistence(app.getPath("userData"));

	ipcMain.handle(
		IpcChannels.checkpoint.begin,
		(_event, sessionId: string, userMessageId: string): CheckpointSummary => {
			return beginCheckpoint(sessionId, userMessageId, getWorkspace());
		},
	);

	ipcMain.handle(
		IpcChannels.checkpoint.finish,
		(_event, sessionId: string, userMessageId: string): CheckpointSummary => {
			flushPendingFsWatch();
			const summary = finishCheckpoint(sessionId, userMessageId);
			if (
				summary.status === "ready" ||
				summary.status === "empty" ||
				summary.status === "reverted"
			) {
				broadcastUpdated(summary);
			}
			return summary;
		},
	);

	ipcMain.handle(
		IpcChannels.checkpoint.finishActive,
		(_event, sessionId: string): CheckpointSummary | null => {
			flushPendingFsWatch();
			const summary = finishActiveCheckpoint(sessionId);
			if (summary) broadcastUpdated(summary);
			return summary;
		},
	);

	ipcMain.handle(
		IpcChannels.checkpoint.get,
		(
			_event,
			sessionId: string,
			userMessageId: string,
		): CheckpointSummary | null => {
			return getCheckpointSummary(sessionId, userMessageId);
		},
	);

	ipcMain.handle(
		IpcChannels.checkpoint.list,
		(_event, sessionId: string): CheckpointSummary[] => {
			return listSessionCheckpointSummaries(sessionId);
		},
	);

	ipcMain.handle(
		IpcChannels.checkpoint.revert,
		(_event, sessionId: string, userMessageId: string) => {
			const result = revertCheckpoint(sessionId, userMessageId, getWorkspace());
			const summary = getCheckpointSummary(sessionId, userMessageId);
			if (summary) broadcastUpdated(summary);
			return result;
		},
	);
}
