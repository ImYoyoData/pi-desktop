import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button, Input, Spin } from "antd";
import { ChatbubbleOutline, ChevronDownOutline, SearchOutline } from "@renderer/components/icons/ionicons";
import { DiffModeEnum, DiffView, SplitSide } from "@git-diff-view/react";
import "@git-diff-view/react/styles/diff-view-pure.css";
import type {
  PullRequestAction,
  PullRequestComment,
  PullRequestDetail,
  PullRequestThread,
} from "../../../shared/github-types";
import PullRequestCommentCard from "@renderer/components/PullRequestComment";
import { useAppearanceStore } from "@renderer/stores/appearance";
import { fileIcon } from "@renderer/utils/file-icon";
import { parseUnifiedDiff, type DiffFile } from "@renderer/utils/pull-request-diff";
import { useI18n } from "@renderer/i18n/use-i18n";
import styles from "./PullRequestFiles.module.css";

type Props = {
  patch: string;
  loading: boolean;
  error: string | null;
  detail: PullRequestDetail;
  pending: Set<string>;
  onRun?: (action: PullRequestAction) => void;
  onReload?: () => void;
};

/** 与目标一致：默认只展开前 3 个文件，以及带未过时行评论的文件。 */
const DEFAULT_EXPAND_COUNT = 3;

type ThreadGroup = { root: PullRequestComment; replies: PullRequestComment[]; thread: PullRequestThread | null };

type WidgetTarget = { path: string; line: number; side: "LEFT" | "RIGHT" };

function defaultExpanded(detail: PullRequestDetail): Set<string> {
  const commented = new Set(
    detail.comments
      .filter((comment) => comment.kind === "review" && comment.path && !comment.outdated)
      .map((comment) => comment.path as string),
  );
  return new Set(
    detail.files
      .filter((file, index) => index < DEFAULT_EXPAND_COUNT || commented.has(file.path))
      .map((file) => file.path),
  );
}

export function PullRequestFiles({ patch, loading, error, detail, pending, onRun, onReload }: Props): ReactNode {
  const t = useI18n();
  const appearance = useAppearanceStore();
  const [layout, setLayout] = useState<"unified" | "split">("unified");
  const [fileFilter, setFileFilter] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => defaultExpanded(detail));
  const [widgetTarget, setWidgetTarget] = useState<WidgetTarget | null>(null);
  const [widgetDraft, setWidgetDraft] = useState("");

  const pullRequestUrl = detail.pullRequest.url;

  useEffect(() => {
    setExpanded(defaultExpanded(detail));
    setFileFilter("");
    setWidgetTarget(null);
  }, [pullRequestUrl]);

  const files = useMemo(() => parseUnifiedDiff(patch), [patch]);

  const shownFiles = useMemo(() => {
    const query = fileFilter.trim().toLowerCase();
    if (!query) return files;
    return files.filter((file) => file.path.toLowerCase().includes(query));
  }, [files, fileFilter]);

  const diffMode = layout === "split" ? DiffModeEnum.Split : DiffModeEnum.Unified;
  const diffTheme: "light" | "dark" = appearance.resolvedTheme === "dark" ? "dark" : "light";
  const canComment = Boolean(detail.viewer) && detail.pullRequest.state === "open";

  const reviewComments = useMemo(
    () => detail.comments.filter((comment) => comment.kind === "review"),
    [detail.comments],
  );

  function threadFor(commentId: number): PullRequestThread | null {
    return detail.threads.find((thread) => thread.rootCommentId === commentId) ?? null;
  }

  const groups = useMemo<ThreadGroup[]>(
    () =>
      reviewComments
        .filter((comment) => comment.inReplyToId === undefined)
        .map((root) => ({
          root,
          replies: reviewComments.filter((comment) => comment.inReplyToId === root.id),
          thread: threadFor(root.id),
        })),
    [reviewComments, detail.threads],
  );

  const allOpen = shownFiles.length > 0 && shownFiles.every((file) => expanded.has(file.path));

  function isOpen(path: string): boolean {
    return expanded.has(path);
  }

  function toggleFile(path: string): void {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function toggleAll(): void {
    setExpanded((current) => {
      const next = new Set(current);
      const open = allOpen;
      for (const file of shownFiles) {
        if (open) next.delete(file.path);
        else next.add(file.path);
      }
      return next;
    });
  }

  function conversationCount(path: string): number {
    return groups.filter((group) => group.root.path === path).length;
  }

  function fileGlyph(path: string): string {
    return fileIcon(path).glyph;
  }

  function fileGlyphColor(path: string): string {
    return fileIcon(path).color ?? "currentColor";
  }

  function diffDataOf(file: DiffFile): {
    oldFile: { fileName: string };
    newFile: { fileName: string };
    hunks: string[];
  } {
    return {
      oldFile: { fileName: file.previousPath ?? file.path },
      newFile: { fileName: file.path },
      hunks: [file.rawSection],
    };
  }

  function extendDataOf(file: DiffFile): {
    oldFile: Record<string, { data: ThreadGroup }>;
    newFile: Record<string, { data: ThreadGroup }>;
  } {
    const oldFile: Record<string, { data: ThreadGroup }> = {};
    const newFile: Record<string, { data: ThreadGroup }> = {};
    for (const group of groups) {
      if (group.root.path !== file.path) continue;
      const line = group.root.line;
      if (line === undefined || group.root.outdated) continue;
      if (group.root.side === "LEFT") oldFile[String(line)] = { data: group };
      else newFile[String(line)] = { data: group };
    }
    return { oldFile, newFile };
  }

  function orphanGroups(file: DiffFile): ThreadGroup[] {
    return groups.filter(
      (group) => group.root.path === file.path && (group.root.line === undefined || group.root.outdated),
    );
  }

  function onAddWidgetClick(file: DiffFile, lineNumber: number, side: SplitSide): void {
    setWidgetTarget({
      path: file.path,
      line: lineNumber,
      side: side === SplitSide.old ? "LEFT" : "RIGHT",
    });
    setWidgetDraft("");
  }

  function isWidgetOpen(path: string, lineNumber: number, side: SplitSide): boolean {
    const target = widgetTarget;
    if (!target) return false;
    const expected = side === SplitSide.old ? "LEFT" : "RIGHT";
    return target.path === path && target.line === lineNumber && target.side === expected;
  }

  function closeWidget(onClose: () => void): void {
    setWidgetTarget(null);
    setWidgetDraft("");
    onClose();
  }

  function submitWidget(file: DiffFile, lineNumber: number, side: SplitSide, onClose: () => void): void {
    const body = widgetDraft;
    if (!body.trim()) return;
    onRun?.({
      kind: "line-comment",
      path: file.path,
      line: lineNumber,
      side: side === SplitSide.old ? "LEFT" : "RIGHT",
      body,
      ...(detail.headSha ? { commitId: detail.headSha } : {}),
    });
    closeWidget(onClose);
  }

  function forward(action: PullRequestAction): void {
    onRun?.(action);
  }

  return (
    <div className={styles.root}>
      {loading ? (
        <div className={styles.state}>
          <Spin size="small" />
          {t.prLoadingChanges}
        </div>
      ) : error ? (
        <div className={styles.alert}>
          <p>{error}</p>
          <button type="button" className={styles.linkBtn} onClick={() => onReload?.()}>
            {t.prRefresh}
          </button>
        </div>
      ) : (
        <>
          <div className={styles.filesToolbar}>
            <div className={styles.layoutTabs} role="tablist" aria-label={t.prDiffLayout}>
              <button
                type="button"
                role="tab"
                className={`${styles.layoutTab} ${layout === "unified" ? styles.active : ""}`}
                aria-selected={layout === "unified"}
                onClick={() => setLayout("unified")}
              >
                {t.prDiffUnified}
              </button>
              <button
                type="button"
                role="tab"
                className={`${styles.layoutTab} ${layout === "split" ? styles.active : ""}`}
                aria-selected={layout === "split"}
                onClick={() => setLayout("split")}
              >
                {t.prDiffSplit}
              </button>
            </div>
            <label className={styles.fileFilter}>
              <SearchOutline size={14} className={styles.filterIcon} />
              <input
                value={fileFilter}
                type="search"
                placeholder={t.prFilterFiles}
                aria-label={t.prFilterFiles}
                onChange={(event) => setFileFilter(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setFileFilter("");
                }}
              />
            </label>
            <span className={styles.spacer} />
            <output className={styles.filesSummary}>
              {t.prShowingFiles(shownFiles.length, detail.pullRequest.changedFiles ?? files.length)}
            </output>
            <button
              type="button"
              className={styles.expandBtn}
              disabled={shownFiles.length === 0}
              onClick={toggleAll}
            >
              {allOpen ? t.prCollapseAll : t.prExpandAll}
            </button>
          </div>

          {detail.files.length === 0 ? <div className={styles.state}>{t.prNoFilesChanged}</div> : null}
          {detail.files.length !== 0 && shownFiles.length === 0 ? (
            <div className={styles.state}>{t.prNoFilesMatch(fileFilter.trim())}</div>
          ) : null}

          {shownFiles.map((file) => {
            const orphans = orphanGroups(file);
            return (
              <section key={file.path} className={styles.file}>
                <button
                  type="button"
                  className={styles.fileHead}
                  aria-expanded={isOpen(file.path)}
                  onClick={() => toggleFile(file.path)}
                >
                  <ChevronDownOutline
                    size={14}
                    className={`${styles.chevron} ${isOpen(file.path) ? "" : styles.collapsed}`}
                  />
                  <span className={styles.setiGlyph} style={{ color: fileGlyphColor(file.path) }} aria-hidden="true">
                    {fileGlyph(file.path)}
                  </span>
                  <span className={styles.filePath}>{file.path}</span>
                  {file.previousPath ? (
                    <span className={styles.renamed}>{t.prRenamedFrom(file.previousPath)}</span>
                  ) : null}
                  {conversationCount(file.path) ? (
                    <span className={styles.threadCount} title={t.prCommentsCount(conversationCount(file.path))}>
                      <ChatbubbleOutline size={13} />
                      {conversationCount(file.path)}
                    </span>
                  ) : null}
                  <span className={styles.stats}>
                    {file.additions ? <span className={styles.added}>{t.prAdditionsCount(file.additions)}</span> : null}
                    {file.deletions ? <span className={styles.removed}>{t.prDeletionsCount(file.deletions)}</span> : null}
                  </span>
                </button>

                <div className={styles.fileBody} style={isOpen(file.path) ? undefined : { display: "none" }}>
                  {file.hunks.length === 0 ? <p className={styles.fileNote}>{t.prNoTextChanges}</p> : null}
                  {file.hunks.length !== 0 ? (
                    <DiffView<ThreadGroup>
                      data={diffDataOf(file)}
                      diffViewMode={diffMode}
                      diffViewTheme={diffTheme}
                      diffViewHighlight={false}
                      diffViewWrap={false}
                      diffViewFontSize={12}
                      diffViewAddWidget={canComment}
                      extendData={extendDataOf(file)}
                      onAddWidgetClick={(lineNumber, side) => onAddWidgetClick(file, lineNumber, side)}
                      renderWidgetLine={({ lineNumber, side, onClose }) =>
                        isWidgetOpen(file.path, lineNumber, side) ? (
                          <div className={styles.widgetEditor}>
                            <Input.TextArea
                              value={widgetDraft}
                              onChange={(event) => setWidgetDraft(event.target.value)}
                              placeholder={t.prLineCommentPlaceholder}
                              autoSize={{ minRows: 2, maxRows: 8 }}
                            />
                            <div className={styles.widgetActions}>
                              <Button size="small" type="text" onClick={() => closeWidget(onClose)}>
                                {t.cancel}
                              </Button>
                              <Button
                                size="small"
                                type="primary"
                                disabled={!widgetDraft.trim()}
                                onClick={() => submitWidget(file, lineNumber, side, onClose)}
                              >
                                {t.prComment}
                              </Button>
                            </div>
                          </div>
                        ) : null
                      }
                      renderExtendLine={({ data }) => (
                        <div className={styles.extendThread}>
                          <PullRequestCommentCard
                            comment={data.root}
                            thread={data.thread}
                            replies={data.replies}
                            avatars={detail.avatars}
                            images={detail.images}
                            pending={pending}
                            pendingKey={`resolve-thread:${data.thread?.id ?? ""}`}
                            replyKey={`reply:${data.root.id}`}
                            canComment
                            onRun={forward}
                          />
                        </div>
                      )}
                    />
                  ) : null}

                  {orphans.length ? (
                    <div className={styles.orphans}>
                      {orphans.map((group) => (
                        <div key={group.root.id} className={styles.extendThread}>
                          <PullRequestCommentCard
                            comment={group.root}
                            thread={group.thread}
                            replies={group.replies}
                            avatars={detail.avatars}
                            images={detail.images}
                            pending={pending}
                            replyKey={`reply:${group.root.id}`}
                            canComment
                            onRun={forward}
                          />
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}

export default PullRequestFiles;
