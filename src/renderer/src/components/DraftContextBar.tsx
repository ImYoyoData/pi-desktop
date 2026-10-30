import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Input, Popover } from "antd";
import { FolderOpenOutline, GitBranchOutline } from "@renderer/components/icons/ionicons";
import { useSessionsStore } from "@renderer/stores/sessions";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import { useI18n } from "@renderer/i18n/use-i18n";
import { useMessage } from "@renderer/services/feedback";
import styles from "./DraftContextBar.module.css";

const RAW_POPOVER_STYLES = {
  root: { background: "transparent", boxShadow: "none", padding: 0 },
  container: { background: "transparent", boxShadow: "none", padding: 0 },
};

export function DraftContextBar(): ReactNode {
  const t = useI18n();
  const sessions = useSessionsStore();
  const workspace = useWorkspaceStore();
  const message = useMessage();

  const [workspacePanelOpen, setWorkspacePanelOpen] = useState(false);
  const [branchPanelOpen, setBranchPanelOpen] = useState(false);
  const [isRepo, setIsRepo] = useState(false);
  const [currentBranch, setCurrentBranch] = useState<string | null>(null);
  const [localBranches, setLocalBranches] = useState<string[]>([]);
  const [newBranchName, setNewBranchName] = useState("");
  const [busy, setBusy] = useState(false);
  const didMountRef = useRef(false);

  function baseName(path: string): string {
    const parts = path.replace(/\\/g, "/").split("/");
    return parts.filter(Boolean).pop() ?? path;
  }

  function samePath(a: string, b: string): boolean {
    return (
      a.replace(/\\/g, "/").toLowerCase() === b.replace(/\\/g, "/").toLowerCase()
    );
  }

  const workspaceLabel = workspace.root ? baseName(workspace.root) : t.noFolder;

  /** 当前工作区置顶，其后是最近工作区（去重）。 */
  const workspaceList: string[] = [];
  if (workspace.root) workspaceList.push(workspace.root);
  for (const path of workspace.recent) {
    if (workspace.root && samePath(path, workspace.root)) continue;
    workspaceList.push(path);
  }

  /** 切换草稿归属的工作区；先落草稿再切，避免 root watcher 放弃草稿。 */
  async function moveDraft(root: string): Promise<void> {
    if (!root || (workspace.root && samePath(root, workspace.root))) return;
    const previous = sessions.draftRoot;
    sessions.setDraftRoot(root);
    const opened = await workspace.openWorkspacePath(root);
    if (opened && samePath(opened, root)) {
      sessions.setDraftRoot(opened);
      return;
    }
    if (previous) sessions.setDraftRoot(previous);
  }

  async function onPickWorkspace(path: string): Promise<void> {
    if (busy) return;
    setWorkspacePanelOpen(false);
    setBusy(true);
    try {
      await moveDraft(path);
    } finally {
      setBusy(false);
    }
  }

  async function onOpenFolder(): Promise<void> {
    const picked = await window.api.workspace.pick();
    if (picked) await onPickWorkspace(picked);
    else setWorkspacePanelOpen(false);
  }

  async function refreshGit(): Promise<void> {
    if (!workspace.root) {
      setIsRepo(false);
      setCurrentBranch(null);
      setLocalBranches([]);
      return;
    }
    try {
      const status = await window.api.git.status();
      setIsRepo(status.isGitRepository);
      setCurrentBranch(status.branch);
      if (!status.isGitRepository) {
        setLocalBranches([]);
        setBranchPanelOpen(false);
        return;
      }
      const branches = await window.api.git.branches();
      setCurrentBranch(branches.current ?? status.branch);
      setLocalBranches(branches.local);
    } catch {
      setIsRepo(false);
    }
  }

  function formatGitError(result: { code?: string }): string {
    const key = `gitErr_${result.code || "unknown"}` as keyof typeof t;
    const text = t[key];
    return typeof text === "string" ? text : t.gitErr_unknown;
  }

  async function onCheckout(branch: string): Promise<void> {
    if (busy || branch === currentBranch) return;
    setBusy(true);
    try {
      const result = await window.api.git.checkout(branch);
      if (!result.ok) {
        message.error(formatGitError(result));
        return;
      }
      message.success(t.branchSwitched);
      await refreshGit();
      setBranchPanelOpen(false);
    } finally {
      setBusy(false);
    }
  }

  async function onCreateBranch(): Promise<void> {
    const name = newBranchName.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      const result = await window.api.git.createBranch(name);
      if (!result.ok) {
        message.error(formatGitError(result));
        return;
      }
      setNewBranchName("");
      message.success(t.branchCreated);
      await refreshGit();
      setBranchPanelOpen(false);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void refreshGit();
  }, []);

  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    setBranchPanelOpen(false);
    setNewBranchName("");
    void refreshGit();
  }, [workspace.root]);

  useEffect(() => {
    if (!workspacePanelOpen) return;
    void workspace.listRecent();
  }, [workspacePanelOpen]);

  useEffect(() => {
    if (branchPanelOpen) void refreshGit();
  }, [branchPanelOpen]);

  const workspacePanel = (
    <div className={styles.ctxPanel}>
      <div className={styles.ctxScroll}>
        {workspaceList.map((path) => (
          <button
            key={path}
            type="button"
            className={`${styles.ctxItem} ${
              workspace.root && samePath(path, workspace.root) ? styles.current : ""
            }`}
            title={path}
            disabled={busy}
            onClick={() => void onPickWorkspace(path)}
          >
            <span className={styles.ctxItemMain}>
              <span className={styles.ctxItemName}>{baseName(path)}</span>
              <span className={styles.ctxItemPath}>{path}</span>
            </span>
          </button>
        ))}
        <button
          type="button"
          className={`${styles.ctxItem} ${styles.open}`}
          disabled={busy}
          onClick={() => void onOpenFolder()}
        >
          <FolderOpenOutline size={12} />
          <span className={styles.ctxItemMain}>
            <span className={styles.ctxItemName}>{t.openFolder}</span>
          </span>
        </button>
      </div>
    </div>
  );

  const branchPanel = (
    <div className={styles.ctxPanel}>
      <div className={styles.ctxScroll}>
        {localBranches.map((name) => (
          <button
            key={`l:${name}`}
            type="button"
            className={`${styles.ctxItem} ${name === currentBranch ? styles.current : ""}`}
            disabled={busy}
            onClick={() => void onCheckout(name)}
          >
            <span className={styles.ctxItemMain}>
              <span className={styles.ctxItemName}>{name}</span>
            </span>
          </button>
        ))}
      </div>
      <div className={styles.branchCreate}>
        <Input
          size="small"
          value={newBranchName}
          placeholder={t.draftBranchName}
          disabled={busy}
          onChange={(e) => setNewBranchName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            void onCreateBranch();
          }}
        />
        <Button
          size="small"
          disabled={busy || !newBranchName.trim()}
          onClick={() => void onCreateBranch()}
        >
          {t.draftNewBranch}
        </Button>
      </div>
    </div>
  );

  return (
    <div className={styles.root}>
      <Popover
        open={workspacePanelOpen}
        onOpenChange={(next) => {
          if (busy) return;
          setWorkspacePanelOpen(next);
        }}
        trigger="click"
        placement="bottomLeft"
        styles={RAW_POPOVER_STYLES}
        content={workspacePanel}
      >
        <button
          type="button"
          className={styles.ctxTrigger}
          title={t.draftWorkspace}
          disabled={busy}
        >
          <FolderOpenOutline size={13} />
          <span className={styles.ctxLabel}>{workspaceLabel}</span>
        </button>
      </Popover>

      {isRepo ? (
        <Popover
          open={branchPanelOpen}
          onOpenChange={(next) => {
            if (busy) return;
            setBranchPanelOpen(next);
          }}
          trigger="click"
          placement="bottomLeft"
          styles={RAW_POPOVER_STYLES}
          content={branchPanel}
        >
          <button
            type="button"
            className={styles.ctxTrigger}
            title={t.changesSwitchBranch}
            disabled={busy}
          >
            <GitBranchOutline size={13} />
            <span className={styles.ctxLabel}>{currentBranch || t.draftBranch}</span>
          </button>
        </Popover>
      ) : null}
    </div>
  );
}

export default DraftContextBar;
