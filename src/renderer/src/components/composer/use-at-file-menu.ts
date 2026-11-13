import { useEffect, useRef } from "react";
import { useI18n } from "@renderer/i18n/use-i18n";
import { useComposerStore } from "@renderer/stores/composer";
import { useRightTabsStore } from "@renderer/stores/right-tabs";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import {
  parseAtFileContext,
  replaceAtFileMention,
  type AtFileItem,
} from "../../../../shared/at-file-mention";
import { nextFrame } from "@renderer/components/next-frame";
import { useLatest } from "./use-latest";

type Params = {
  draft: string;
  workspaceRoot: string;
  /** 斜杠菜单打开时互斥，不再显示 @ 菜单。 */
  disabled: boolean;
  focusDraft: () => void;
};

/** `@` 文件提及菜单：搜索、最近预览优先、选中后替换草稿。 */
export function useAtFileMenu({ draft, workspaceRoot, disabled, focusDraft }: Params) {
  const t = useI18n();

  const atFileItems = useLatest<AtFileItem[]>([]);
  const atFileLoading = useLatest(false);
  const atFileSearchGenRef = useRef(0);
  const atFileRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Recently opened preview tabs (workspace-relative) for the empty-@ list. */
  function recentPreviewAtFiles(): AtFileItem[] {
    const out: AtFileItem[] = [];
    const seen = new Set<string>();
    for (const tab of useRightTabsStore.getState().tabs) {
      if (tab.kind !== "preview" || !tab.filePath) continue;
      const rel = tab.filePath.replace(/\\/g, "/").replace(/^\.\//, "");
      if (!rel || seen.has(rel)) continue;
      // Skip obvious absolute paths that aren't workspace-relative.
      if (/^[a-zA-Z]:/.test(rel) || rel.startsWith("/")) continue;
      seen.add(rel);
      out.push({
        name: rel.split("/").pop() || rel,
        path: rel,
        kind: "file",
      });
    }
    return out;
  }

  async function refreshAtFileItems(query: string): Promise<void> {
    const gen = ++atFileSearchGenRef.current;
    const root = useWorkspaceStore.getState().root;
    if (!root) {
      atFileItems.set([]);
      return;
    }
    atFileLoading.set(true);
    try {
      const q = query.trim();
      if (!q) {
        const recent = recentPreviewAtFiles();
        const rootEntries = await window.api.files.list();
        if (gen !== atFileSearchGenRef.current) return;
        const seen = new Set(recent.map((r) => r.path));
        const merged: AtFileItem[] = [...recent];
        for (const e of rootEntries) {
          if (seen.has(e.path)) continue;
          merged.push({ name: e.name, path: e.path, kind: e.kind });
        }
        atFileItems.set(merged);
        return;
      }
      const entries = await window.api.files.search(q, 80);
      if (gen !== atFileSearchGenRef.current) return;
      // Boost recently opened files that still match the query to the top.
      const recent = recentPreviewAtFiles();
      const recentHit = new Set(
        recent.filter((r) => entries.some((e) => e.path === r.path)).map((r) => r.path),
      );
      const mapped = entries.map((e) => ({
        name: e.name,
        path: e.path,
        kind: e.kind,
      }));
      atFileItems.set([
        ...mapped.filter((e) => recentHit.has(e.path)),
        ...mapped.filter((e) => !recentHit.has(e.path)),
      ]);
    } catch {
      if (gen !== atFileSearchGenRef.current) return;
      atFileItems.set([]);
    } finally {
      if (gen === atFileSearchGenRef.current) atFileLoading.set(false);
    }
  }

  const atFileContext = disabled ? null : parseAtFileContext(draft);
  const atFileMenuOpen = Boolean(atFileContext);

  const atFileEmptyHint = !workspaceRoot
    ? t.atFileNeedWorkspace
    : atFileLoading.value
      ? t.atFileSearching
      : t.atFileEmpty;

  async function onAtFileSelect(item: AtFileItem): Promise<void> {
    const ctx = atFileContext;
    if (!ctx) return;
    const nextDraft = replaceAtFileMention(useComposerStore.getState().draft, ctx);
    useComposerStore.getState().addFileTag(item.path);
    // Chip sync may re-read DOM still containing `@query`; strip after that flush.
    await nextFrame();
    useComposerStore.getState().setDraft(nextDraft);
    await nextFrame();
    focusDraft();
  }

  useEffect(() => {
    const ctx = atFileContext;
    if (atFileRefreshTimerRef.current) {
      clearTimeout(atFileRefreshTimerRef.current);
      atFileRefreshTimerRef.current = null;
    }
    if (!ctx) {
      atFileItems.set([]);
      return;
    }
    // Bare `@` loads immediately; typed queries debounce slightly.
    const delay = ctx.query.trim() ? 80 : 0;
    atFileRefreshTimerRef.current = setTimeout(() => {
      atFileRefreshTimerRef.current = null;
      void refreshAtFileItems(ctx.query);
    }, delay);
    return () => {
      if (atFileRefreshTimerRef.current) {
        clearTimeout(atFileRefreshTimerRef.current);
        atFileRefreshTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在上下文变化时刷新，与原实现一致
  }, [atFileContext?.atIndex, atFileContext?.query]);

  return {
    atFileContext,
    atFileMenuOpen,
    atFileItems,
    atFileEmptyHint,
    onAtFileSelect,
  };
}
