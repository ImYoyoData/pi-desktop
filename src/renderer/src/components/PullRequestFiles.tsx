import { startTransition, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Button, Input, Spin } from "antd";
import { PatchDiff } from "@pierre/diffs/react";
import type { DiffLineAnnotation, SelectedLineRange } from "@pierre/diffs";
import { ChatbubbleOutline, ChevronDownOutline, SearchOutline } from "@renderer/components/icons/ionicons";
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

/** 每一行注释要么是已有讨论，要么是正在写的草稿。 */
type LineNote = { thread?: ThreadGroup; draft?: boolean };

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

function DraftCommentCard({
  placeholder,
  submitLabel,
  cancelLabel,
  onSubmit,
  onCancel,
}: {
  placeholder: string;
  submitLabel: string;
  cancelLabel: string;
  onSubmit: (body: string) => void;
  onCancel: () => void;
}): ReactNode {
  const [text, setText] = useState("");
  return (
    <div className={styles.widgetEditor}>
      <Input.TextArea
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={placeholder}
        autoSize={{ minRows: 2, maxRows: 8 }}
      />
      <div className={styles.widgetActions}>
        <Button size="small" type="text" onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button size="small" type="primary" disabled={!text.trim()} onClick={() => onSubmit(text)}>
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}

export function PullRequestFiles({ patch, loading, error, detail, pending, onRun, onReload }: Props): ReactNode {
  const t = useI18n();
  const appearance = useAppearanceStore();
  const [layout, setLayout] = useState<"unified" | "split">("unified");
  const [fileFilter, setFileFilter] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => defaultExpanded(detail));
  const [widgetTarget, setWidgetTarget] = useState<WidgetTarget | null>(null);

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

  const themeType = appearance.resolvedTheme === "dark" ? "dark" : "light";
  const canComment = Boolean(detail.viewer) && detail.pullRequest.state === "open";

  const reviewComments = useMemo(
    () => detail.comments.filter((comment) => comment.kind === "review"),
    [detail.comments],
  );

  const groups = useMemo<ThreadGroup[]>(
    () =>
      reviewComments
        .filter((comment) => comment.inReplyToId === undefined)
        .map((root) => ({
          root,
          replies: reviewComments.filter((comment) => comment.inReplyToId === root.id),
          thread: detail.threads.find((thread) => thread.rootCommentId === root.id) ?? null,
        })),
    [reviewComments, detail.threads],
  );

  /** 行注释按文件缓存：已有讨论贴行渲染，草稿跟着选中行走。 */
  const notesByPath = useMemo(() => {
    const out = new Map<string, DiffLineAnnotation<LineNote>[]>();
    for (const file of files) {
      const list: DiffLineAnnotation<LineNote>[] = [];
      for (const group of groups) {
        if (group.root.path !== file.path) continue;
        const line = group.root.line;
        if (!line || group.root.outdated) continue;
        list.push({
          side: group.root.side === "LEFT" ? "deletions" : "additions",
          lineNumber: line,
          metadata: { thread: group },
        });
      }
      if (widgetTarget && widgetTarget.path === file.path) {
        list.push({
          side: widgetTarget.side === "LEFT" ? "deletions" : "additions",
          lineNumber: widgetTarget.line,
          metadata: { draft: true },
        });
      }
      out.set(file.path, list);
    }
    return out;
  }, [files, groups, widgetTarget]);

  const allOpen = shownFiles.length > 0 && shownFiles.every((file) => expanded.has(file.path));

  function isOpen(path: string): boolean {
    return expanded.has(path);
  }

  function toggleFile(path: string): void {
    startTransition(() => {
      setExpanded((current) => {
        const next = new Set(current);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      });
    });
  }

  function toggleAll(): void {
    startTransition(() => {
      setExpanded((current) => {
        const next = new Set(current);
        const open = allOpen;
        for (const file of shownFiles) {
          if (open) next.delete(file.path);
          else next.add(file.path);
        }
        return next;
      });
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

  function orphanGroups(file: DiffFile): ThreadGroup[] {
    return groups.filter(
      (group) => group.root.path === file.path && (group.root.line === undefined || group.root.outdated),
    );
  }

  function openWidget(file: DiffFile, range: SelectedLineRange): void {
    const side = (range.endSide ?? range.side) === "deletions" ? "LEFT" : "RIGHT";
    setWidgetTarget({ path: file.path, line: range.end || range.start, side });
  }

  const submitWidget = useCallback(
    (target: WidgetTarget, body: string): void => {
      if (!body.trim()) return;
      onRun?.({
        kind: "line-comment",
        path: target.path,
        line: target.line,
        side: target.side,
        body,
        ...(detail.headSha ? { commitId: detail.headSha } : {}),
      });
      setWidgetTarget(null);
    },
    [onRun, detail.headSha],
  );

  const renderAnnotation = useCallback(
    (annotation: DiffLineAnnotation<LineNote>): ReactNode => {
      if (annotation.metadata.draft) {
        const target = widgetTarget;
        if (!target) return null;
        return (
          <div className={styles.extendThread}>
            <DraftCommentCard
              placeholder={t.prLineCommentPlaceholder}
              submitLabel={t.prComment}
              cancelLabel={t.cancel}
              onSubmit={(body) => submitWidget(target, body)}
              onCancel={() => setWidgetTarget(null)}
            />
          </div>
        );
      }
      const group = annotation.metadata.thread;
      if (!group) return null;
      return (
        <div className={styles.extendThread}>
          <PullRequestCommentCard
            comment={group.root}
            thread={group.thread}
            replies={group.replies}
            avatars={detail.avatars}
            images={detail.images}
            pending={pending}
            pendingKey={`resolve-thread:${group.thread?.id ?? ""}`}
            replyKey={`reply:${group.root.id}`}
            canComment
            onRun={(action) => onRun?.(action)}
          />
        </div>
      );
    },
    [widgetTarget, t, detail.avatars, detail.images, pending, onRun, submitWidget],
  );

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

                {isOpen(file.path) ? (
                  <div className={styles.fileBody}>
                    {file.hasHunks ? (
                      <PatchDiff<LineNote>
                        patch={file.rawSection}
                        options={{
                          diffStyle: layout,
                          diffIndicators: "bars",
                          overflow: "wrap",
                          disableFileHeader: true,
                          themeType,
                          onGutterUtilityClick: (range) => openWidget(file, range),
                        }}
                        renderGutterUtility={
                          canComment
                            ? () => (
                                <button
                                  type="button"
                                  className={styles.addComment}
                                  aria-label={t.prComment}
                                  title={t.prComment}
                                >
                                  +
                                </button>
                              )
                            : undefined
                        }
                        lineAnnotations={notesByPath.get(file.path)}
                        renderAnnotation={renderAnnotation}
                      />
                    ) : (
                      <p className={styles.fileNote}>{t.prNoTextChanges}</p>
                    )}

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
                              onRun={(action) => onRun?.(action)}
                            />
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}

export default PullRequestFiles;
