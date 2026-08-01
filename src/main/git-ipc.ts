import { ipcMain } from "electron";
import { IpcChannels } from "../shared/protocol";
import type { GitOpResult } from "../shared/git-types";
import {
  addRemote,
  checkoutBranch,
  commitPaths,
  createBranch,
  deleteBranch,
  fetchRepo,
  fileDiffAtCommit,
  getGitFileDiff,
  getWorkspaceGitStatus,
  initRepo,
  listBranches,
  listLog,
  listRemotes,
  logFile,
  mergeBranch,
  pullRepo,
  pushRepo,
  removeRemote,
  renameBranch,
  restoreFileToCommit,
  resetToCommit,
  restorePaths,
  showCommitFiles,
  stagePaths,
  unstagePaths,
  setRemoteUrl,
  getConflictContent,
  resolveConflictPath,
  checkoutConflictSide,
  abortMerge,
} from "./git-host";
import { getWorkspace } from "./workspace-ipc";
import { addGitIgnored, listGitIgnored, removeGitIgnored } from "./git-ignore-store";

function requireRoot(): string | null {
  return getWorkspace();
}

function noWorkspace(): GitOpResult {
  return { ok: false, code: "invalid_args", message: "No workspace" };
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
    if (!root) return { current: null, local: [], remote: [] };
    return listBranches(root);
  });

  ipcMain.handle(IpcChannels.git.checkout, async (_e, branch: string) => {
    const root = requireRoot();
    if (!root) return noWorkspace();
    return checkoutBranch(root, String(branch ?? ""));
  });

  ipcMain.handle(IpcChannels.git.createBranch, async (_e, branch: string, base?: string) => {
    const root = requireRoot();
    if (!root) return noWorkspace();
    return createBranch(root, String(branch ?? ""), base ? String(base) : undefined);
  });

  ipcMain.handle(IpcChannels.git.merge, async (_e, branch: string) => {
    const root = requireRoot();
    if (!root) return noWorkspace();
    return mergeBranch(root, String(branch ?? ""));
  });

  ipcMain.handle(IpcChannels.git.deleteBranch, async (_e, branch: string) => {
    const root = requireRoot();
    if (!root) return noWorkspace();
    return deleteBranch(root, String(branch ?? ""));
  });

  ipcMain.handle(
    IpcChannels.git.renameBranch,
    async (_e, payload: { branch: string; nextName: string }) => {
      const root = requireRoot();
      if (!root) return noWorkspace();
      return renameBranch(root, payload?.branch ?? "", payload?.nextName ?? "");
    },
  );

  ipcMain.handle(
    IpcChannels.git.logFile,
    async (_e, relativePath: string, limit?: number) => {
      const root = requireRoot();
      if (!root || typeof relativePath !== "string") return { entries: [] };
      return logFile(root, relativePath, typeof limit === "number" ? limit : 50);
    },
  );

  ipcMain.handle(
    IpcChannels.git.fileDiffAtCommit,
    async (_e, payload: { relativePath: string; commitHash: string }) => {
      const root = requireRoot();
      if (!root) return { supported: false };
      return fileDiffAtCommit(root, payload?.relativePath ?? "", payload?.commitHash ?? "");
    },
  );

  ipcMain.handle(
    IpcChannels.git.restoreFileToCommit,
    async (_e, payload: { relativePath: string; commitHash: string }) => {
      const root = requireRoot();
      if (!root) return noWorkspace();
      return restoreFileToCommit(root, payload?.relativePath ?? "", payload?.commitHash ?? "");
    },
  );

  ipcMain.handle(
    IpcChannels.git.commit,
    async (_e, payload: { message: string; paths: string[] }) => {
      const root = requireRoot();
      if (!root) return noWorkspace();
      return commitPaths(
        root,
        payload?.message ?? "",
        Array.isArray(payload?.paths) ? payload.paths : [],
      );
    },
  );

  ipcMain.handle(IpcChannels.git.pull, async () => {
    const root = requireRoot();
    if (!root) return noWorkspace();
    return pullRepo(root);
  });

  ipcMain.handle(IpcChannels.git.push, async () => {
    const root = requireRoot();
    if (!root) return noWorkspace();
    return pushRepo(root);
  });

  ipcMain.handle(IpcChannels.git.fetch, async (_e, remote?: string) => {
    const root = requireRoot();
    if (!root) return noWorkspace();
    return fetchRepo(root, typeof remote === "string" ? remote : undefined);
  });

  ipcMain.handle(IpcChannels.git.restore, async (_e, paths: string[]) => {
    const root = requireRoot();
    if (!root) return noWorkspace();
    return restorePaths(root, Array.isArray(paths) ? paths : []);
  });

  ipcMain.handle(IpcChannels.git.init, async () => {
    const root = requireRoot();
    if (!root) return noWorkspace();
    return initRepo(root);
  });

  ipcMain.handle(IpcChannels.git.remotes, async () => {
    const root = requireRoot();
    if (!root) return [] as Awaited<ReturnType<typeof listRemotes>>;
    return listRemotes(root);
  });

  ipcMain.handle(
    IpcChannels.git.addRemote,
    async (_e, payload: { name: string; url: string }) => {
      const root = requireRoot();
      if (!root) return noWorkspace();
      return addRemote(root, payload?.name ?? "", payload?.url ?? "");
    },
  );

  ipcMain.handle(
    IpcChannels.git.setRemoteUrl,
    async (_e, payload: { name: string; url: string }) => {
      const root = requireRoot();
      if (!root) return noWorkspace();
      return setRemoteUrl(root, payload?.name ?? "", payload?.url ?? "");
    },
  );

  ipcMain.handle(IpcChannels.git.removeRemote, async (_e, name: string) => {
    const root = requireRoot();
    if (!root) return noWorkspace();
    return removeRemote(root, String(name ?? ""));
  });

  ipcMain.handle(IpcChannels.git.showCommitFiles, async (_e, commitHash: string) => {
    const cwd = getWorkspace();
    if (!cwd) return { files: [] };
    return showCommitFiles(cwd, commitHash);
  });
  ipcMain.handle(
    IpcChannels.git.resetToCommit,
    async (_e, commitHash: string, mode: "soft" | "hard") => {
      const cwd = getWorkspace();
      if (!cwd) return { ok: false, message: "no workspace", code: "invalid_args" };
      return resetToCommit(cwd, commitHash, mode);
    },
  );
  ipcMain.handle(IpcChannels.git.stage, async (_e, paths: string[]) => {
    const cwd = getWorkspace();
    if (!cwd) return { ok: false, message: "no workspace", code: "invalid_args" };
    return stagePaths(cwd, paths);
  });
  ipcMain.handle(IpcChannels.git.unstage, async (_e, paths: string[]) => {
    const cwd = getWorkspace();
    if (!cwd) return { ok: false, message: "no workspace", code: "invalid_args" };
    return unstagePaths(cwd, paths);
  });
  ipcMain.handle(IpcChannels.git.ignore, async (_e, paths: string[]) => {
    const cwd = getWorkspace();
    if (!cwd) return [];
    return addGitIgnored(cwd, paths);
  });
  ipcMain.handle(IpcChannels.git.ignored, async () => {
    const cwd = getWorkspace();
    if (!cwd) return [];
    return listGitIgnored(cwd);
  });

  ipcMain.handle(IpcChannels.git.unignore, async (_e, path: string) => {
    const cwd = getWorkspace();
    if (!cwd) return [];
    return removeGitIgnored(cwd, path);
  });

  ipcMain.handle(IpcChannels.git.log, async (_e, limit?: number) => {
    const root = requireRoot();
    if (!root) return { entries: [] };
    return listLog(root, typeof limit === "number" ? limit : 50);
  });

  ipcMain.handle(IpcChannels.git.conflictContent, async (_e, relativePath: string) => {
    const root = requireRoot();
    if (!root || typeof relativePath !== "string") return { supported: false };
    return getConflictContent(root, relativePath);
  });

  ipcMain.handle(
    IpcChannels.git.resolveConflict,
    async (_e, payload: { relativePath: string; content: string }) => {
      const root = requireRoot();
      if (!root) return noWorkspace();
      const relativePath = payload?.relativePath;
      const content = payload?.content;
      if (typeof relativePath !== "string" || typeof content !== "string") {
        return noWorkspace();
      }
      return resolveConflictPath(root, relativePath, content);
    },
  );

  ipcMain.handle(
    IpcChannels.git.checkoutConflictSide,
    async (_e, payload: { relativePath: string; side: "ours" | "theirs" }) => {
      const root = requireRoot();
      if (!root) return noWorkspace();
      const relativePath = payload?.relativePath;
      const side = payload?.side;
      if (typeof relativePath !== "string" || (side !== "ours" && side !== "theirs")) {
        return noWorkspace();
      }
      return checkoutConflictSide(root, relativePath, side);
    },
  );

  ipcMain.handle(IpcChannels.git.abortMerge, async () => {
    const root = requireRoot();
    if (!root) return noWorkspace();
    return abortMerge(root);
  });
}
