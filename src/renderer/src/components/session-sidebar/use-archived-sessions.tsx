import {
  useEffect,
  useMemo,
  useState,
  type MutableRefObject,
} from "react";
import type { SessionSummary } from "../../../../shared/protocol";
import { useChatStore } from "@renderer/stores/chat";
import { useSendQueueStore } from "@renderer/stores/send-queue";
import { useSessionsStore } from "@renderer/stores/sessions";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import { useI18n } from "@renderer/i18n/use-i18n";
import { useDialog, useMessage } from "@renderer/services/feedback";
import type { ArchivedRow, SidebarLocal } from "./sidebar-model";

type Params = {
  workspacePaths: string[];
  localRef: MutableRefObject<SidebarLocal>;
  sessionLabel: (session: { name?: string; firstMessage?: string; id: string }) => string;
  workspaceName: (root: string) => string;
  rootOfSession: (id: string) => string | null;
  loadSessions: (root: string) => Promise<SessionSummary[]>;
  ensureActiveSession: (
    root: string,
    autoOpenFirst?: boolean,
    loaded?: SessionSummary[],
  ) => Promise<void>;
};

/**
 * 归档会话的列表/搜索/批量恢复与删除。
 * 会话缓存与选中恢复仍由侧栏控制器提供，这里只处理归档面板自身状态。
 */
export function useArchivedSessions({
  workspacePaths,
  localRef,
  sessionLabel,
  workspaceName,
  rootOfSession,
  loadSessions,
  ensureActiveSession,
}: Params) {
  const t = useI18n();
  const dialog = useDialog();
  const message = useMessage();

  const [archivedOpen, setArchivedOpen] = useState(false);
  const [archivedRows, setArchivedRows] = useState<ArchivedRow[]>([]);
  const [archivedQuery, setArchivedQuery] = useState("");
  const [archivedSelected, setArchivedSelected] = useState<string[]>([]);
  const [archivedAnchorId, setArchivedAnchorId] = useState<string | null>(null);

  async function ensureSessionsLoaded(root: string): Promise<void> {
    if (localRef.current.sessionsByRoot[root]?.length) return;
    await loadSessions(root);
  }

  async function openArchivedList(): Promise<void> {
    setArchivedOpen(true);
    setArchivedRows([]);
    try {
      for (const root of workspacePaths) await ensureSessionsLoaded(root);
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
      return;
    }
    const byId = new Map<string, { root: string; session: SessionSummary }>();
    for (const root of workspacePaths) {
      for (const s of localRef.current.sessionsByRoot[root] ?? []) {
        byId.set(s.id, { root, session: s });
      }
    }
    setArchivedRows(
      useWorkspaceStore
        .getState()
        .archivedSessions.map((id) => {
          const hit = byId.get(id);
          return {
            id,
            label: hit ? sessionLabel(hit.session) : id,
            workspace: hit ? workspaceName(hit.root) : "",
            modified: hit?.session.modified ?? "",
          };
        }),
    );
  }

  const archivedFilteredRows = useMemo(() => {
    const q = archivedQuery.trim().toLowerCase();
    if (!q) return archivedRows;
    return archivedRows.filter(
      (row) =>
        row.label.toLowerCase().includes(q) ||
        row.workspace.toLowerCase().includes(q),
    );
  }, [archivedRows, archivedQuery]);

  function toggleArchivedSelect(id: string): void {
    const next = new Set(archivedSelected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setArchivedSelected([...next]);
    setArchivedAnchorId(id);
  }

  /** Shift 点击：选中锚点到当前项之间的全部归档项。 */
  function onArchivedRowClick(id: string, shiftKey: boolean): void {
    const anchor = archivedAnchorId;
    const ids = archivedFilteredRows.map((row) => row.id);
    const from = anchor ? ids.indexOf(anchor) : -1;
    const to = ids.indexOf(id);
    if (!shiftKey || from < 0 || to < 0) {
      toggleArchivedSelect(id);
      return;
    }
    const [start, end] = from <= to ? [from, to] : [to, from];
    setArchivedSelected(ids.slice(start, end + 1));
  }

  function dropArchivedRows(ids: string[]): void {
    setArchivedRows((prev) => prev.filter((row) => !ids.includes(row.id)));
    setArchivedSelected((prev) => prev.filter((id) => !ids.includes(id)));
  }

  async function restoreSelectedArchived(): Promise<void> {
    const ids = [...archivedSelected];
    if (!ids.length) return;
    try {
      await useWorkspaceStore
        .getState()
        .setArchivedSessions(
          useWorkspaceStore
            .getState()
            .archivedSessions.filter((entry) => !ids.includes(entry)),
        );
      dropArchivedRows(ids);
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    }
  }

  function deleteSelectedArchived(): void {
    const ids = [...archivedSelected];
    if (!ids.length) return;
    let d: import("@renderer/services/feedback").DialogHandle;
    d = dialog.warning({
      title: t.delete,
      content: t.deleteSelectedConfirm(ids.length),
      positiveText: t.delete,
      negativeText: t.cancel,
      onPositiveClick: () => {
        d.loading = true;
        return (async () => {
          try {
            const touched = new Set<string>();
            for (const id of ids) {
              const root = rootOfSession(id);
              if (!root) continue;
              await useSessionsStore.getState().deleteSession(id, root);
              useChatStore.getState().clearSession(id);
              useSendQueueStore.getState().clearSession(id);
              touched.add(root);
            }
            await useWorkspaceStore
              .getState()
              .setArchivedSessions(
                useWorkspaceStore
                  .getState()
                  .archivedSessions.filter((entry) => !ids.includes(entry)),
              );
            dropArchivedRows(ids);
            const loaded = new Map<string, SessionSummary[]>();
            for (const root of touched) {
              loaded.set(root, await loadSessions(root));
            }
            const currentRoot = useWorkspaceStore.getState().root;
            if (currentRoot) {
              await ensureActiveSession(currentRoot, true, loaded.get(currentRoot));
            }
          } catch (err) {
            message.error(err instanceof Error ? err.message : String(err));
            d.loading = false;
            return false;
          }
          return undefined;
        })();
      },
    });
  }

  useEffect(() => {
    if (archivedOpen) return;
    setArchivedQuery((prev) => (prev ? "" : prev));
    setArchivedSelected((prev) => (prev.length ? [] : prev));
    setArchivedAnchorId(null);
  }, [archivedOpen]);

  return {
    archivedOpen,
    setArchivedOpen,
    archivedFilteredRows,
    archivedQuery,
    setArchivedQuery,
    archivedSelected,
    onArchivedRowClick,
    toggleArchivedSelect,
    restoreSelectedArchived,
    deleteSelectedArchived,
    openArchivedList,
  };
}
