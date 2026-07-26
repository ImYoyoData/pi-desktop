import { ipcMain } from "electron";
import { IpcChannels } from "../shared/protocol";
import {
  checkoutBranch,
  commitPaths,
  createBranch,
  getGitFileDiff,
  getWorkspaceGitStatus,
  listBranches,
  mergeBranch,
  pullRepo,
  pushRepo,
} from "./git-host";
import { getWorkspace } from "./workspace-ipc";

function requireRoot(): string | null {
  return getWorkspace();
}

export function registerGitIpc(): void {
  ipcMain.handle(IpcChannels.git.status, async () => {
    const root = requireRoot();
    if (!root) return { isGitRepository: false, branch: null, files: [] };
    return getWorkspaceGitStatus(root);
  });

  ipcMain.handle(IpcChannels.git.diff, async (_e, relativePath: string) => {
    const root = requireRoot();
    if (!root || typeof relativePath !== "string") return { supported: false };
    return getGitFileDiff(root, relativePath);
  });

  ipcMain.handle(IpcChannels.git.branches, async () => {
    const root = requireRoot();
    if (!root) return { current: null, local: [] };
    return listBranches(root);
  });

  ipcMain.handle(IpcChannels.git.checkout, async (_e, branch: string) => {
    const root = requireRoot();
    if (!root) return { ok: false as const, message: "No workspace" };
    return checkoutBranch(root, String(branch ?? ""));
  });

  ipcMain.handle(IpcChannels.git.createBranch, async (_e, branch: string) => {
    const root = requireRoot();
    if (!root) return { ok: false as const, message: "No workspace" };
    return createBranch(root, String(branch ?? ""));
  });

  ipcMain.handle(IpcChannels.git.merge, async (_e, branch: string) => {
    const root = requireRoot();
    if (!root) return { ok: false as const, message: "No workspace" };
    return mergeBranch(root, String(branch ?? ""));
  });

  ipcMain.handle(
    IpcChannels.git.commit,
    async (_e, payload: { message: string; paths: string[] }) => {
      const root = requireRoot();
      if (!root) return { ok: false as const, message: "No workspace" };
      return commitPaths(root, payload?.message ?? "", Array.isArray(payload?.paths) ? payload.paths : []);
    },
  );

  ipcMain.handle(IpcChannels.git.pull, async () => {
    const root = requireRoot();
    if (!root) return { ok: false as const, message: "No workspace" };
    return pullRepo(root);
  });

  ipcMain.handle(IpcChannels.git.push, async () => {
    const root = requireRoot();
    if (!root) return { ok: false as const, message: "No workspace" };
    return pushRepo(root);
  });
}
