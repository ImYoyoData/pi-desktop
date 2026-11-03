import { useMemo, type ReactNode } from "react";
import FileChip from "@renderer/components/FileChip";
import SubagentTranscript from "@renderer/components/SubagentTranscript";
import { ToolDiffView } from "@renderer/components/ToolDiffView";
import { FolderOutline } from "@renderer/components/icons/ionicons";
import ToolJsonTree from "@renderer/components/ToolJsonTree";
import type { DetailToolCard, DetailSection } from "@renderer/utils/tool-detail-types";
import { highlightToSafeHtml } from "@renderer/utils/markdown";
import { languageFromPath } from "@renderer/utils/editor-lang";
import { fileIcon } from "@renderer/utils/file-icon";
import { normalizeHttpUrl, openInBuiltinBrowser } from "@renderer/utils/open-link";
import { useI18n } from "@renderer/i18n/use-i18n";
import type { Messages } from "@renderer/i18n";
import styles from "./ToolBody.module.css";

type Props = {
  card: DetailToolCard;
  streaming?: boolean;
  onOpen?: (path: string) => void;
};

function lineCount(text: string): number {
  return text ? text.replace(/\r\n/g, "\n").split("\n").length : 0;
}

function DetailCode({ code, lang }: { code: string; lang: string }): ReactNode {
  const html = useMemo(() => highlightToSafeHtml(code, lang), [code, lang]);
  const count = useMemo(() => lineCount(code), [code]);
  return (
    <div className={styles.codeView}>
      <div className={styles.gutter} aria-hidden="true">
        {Array.from({ length: count }, (_, index) => (
          <span key={index}>{index + 1}</span>
        ))}
      </div>
      <div className={styles.codeScroll}>
        <pre className={styles.code}>
          <code dangerouslySetInnerHTML={{ __html: html }} />
        </pre>
      </div>
    </div>
  );
}

function DetailPaths({
  items,
  notices,
}: {
  items: string[];
  notices: string[];
}): ReactNode {
  return (
    <>
      <ul className={styles.pathList}>
        {items.map((entry, index) => {
          const isDir = entry.endsWith("/");
          const icon = isDir ? null : fileIcon(entry);
          return (
            <li
              key={`${index}-${entry}`}
              className={`${styles.pathItem}${isDir ? ` ${styles.pathDir}` : ""}`}
            >
              {isDir ? (
                <FolderOutline size={13} className={styles.pathIcon} aria-hidden="true" />
              ) : (
                <span
                  className={styles.pathIcon}
                  style={icon?.color ? { color: icon.color } : undefined}
                  aria-hidden="true"
                >
                  {icon?.glyph ?? "▸"}
                </span>
              )}
              <span className={styles.pathName}>{entry}</span>
            </li>
          );
        })}
      </ul>
      {notices.length ? (
        <div className={styles.notice}>
          {notices.map((notice, index) => (
            <span key={index}>{notice}</span>
          ))}
        </div>
      ) : null}
    </>
  );
}

function DetailMatches({
  files,
  notices,
  onOpen,
}: {
  files: NonNullable<Extract<DetailSection, { kind: "matches" }>>["files"];
  notices: string[];
  onOpen?: (path: string) => void;
}): ReactNode {
  return (
    <>
      <div className={styles.grepFiles}>
        {files.map((group, groupIndex) => {
          const lang = languageFromPath(group.path);
          return (
            <div key={`${groupIndex}-${group.path}`} className={styles.grepFile}>
              <div className={styles.grepFileHead}>
                {group.path ? (
                  <FileChip path={group.path} label={group.path} onOpen={onOpen} />
                ) : null}
                <span className={styles.langBadge}>{lang}</span>
                <span className={styles.meta}>{group.lines.filter((row) => row.match).length}</span>
              </div>
              {group.lines.map((row, index) => (
                <button
                  key={`${row.line ?? "meta"}-${index}`}
                  type="button"
                  className={`${styles.grepLine}${row.match ? ` ${styles.grepHit}` : ""}`}
                  onClick={() => onOpen?.(group.path)}
                >
                  <span className={styles.grepLineNo}>{row.line ?? ""}</span>
                  <span
                    className={styles.grepLineText}
                    dangerouslySetInnerHTML={{
                      __html: highlightToSafeHtml(row.text, lang),
                    }}
                  />
                </button>
              ))}
            </div>
          );
        })}
      </div>
      {notices.length ? (
        <div className={styles.notice}>
          {notices.map((notice, index) => (
            <span key={index}>{notice}</span>
          ))}
        </div>
      ) : null}
    </>
  );
}

function DetailLinks({
  items,
}: {
  items: Array<{ title: string; url: string; snippet?: string | null; meta?: string | null }>;
}): ReactNode {
  return (
    <ul className={styles.detailLinks}>
      {items.map((link, index) => {
        const target = normalizeHttpUrl(link.url);
        return (
          <li key={`${index}-${link.url}`} className={styles.detailLinkItem}>
            <button
              type="button"
              className={styles.detailLink}
              disabled={!target}
              onClick={() => {
                if (target) openInBuiltinBrowser(target);
              }}
            >
              <span className={styles.detailLinkTitle}>{link.title}</span>
              <span className={styles.detailLinkUrl}>{link.url}</span>
            </button>
            {link.snippet ? <p className={styles.detailLinkSnippet}>{link.snippet}</p> : null}
            {link.meta ? <span className={styles.meta}>{link.meta}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}

function DetailItems({
  items,
}: {
  items: Array<{
    title: string;
    subtitle?: string | null;
    body?: string | null;
    tone?: "ok" | "error" | "muted";
  }>;
}): ReactNode {
  const toneClass = {
    ok: styles.detailOk,
    error: styles.detailError,
    muted: styles.detailMuted,
  };
  return (
    <ul className={styles.detailItems}>
      {items.map((entry, index) => (
        <li
          key={`${index}-${entry.title}`}
          className={`${styles.detailItem}${entry.tone ? ` ${toneClass[entry.tone]}` : ""}`}
        >
          <div className={styles.detailItemTitle}>{entry.title}</div>
          {entry.subtitle ? <div className={styles.detailItemSubtitle}>{entry.subtitle}</div> : null}
          {entry.body ? <pre className={styles.plain}>{entry.body}</pre> : null}
        </li>
      ))}
    </ul>
  );
}

function sectionTitle(t: Messages, section: DetailSection): string | null {
  const label = section.label ? t.toolDetailLabel(section.label) : null;
  const title = "title" in section ? section.title : null;
  if (label && title) return `${label} · ${title}`;
  return label ?? title ?? null;
}

function SectionBody({
  section,
  onOpen,
}: {
  section: DetailSection;
  onOpen?: (path: string) => void;
}): ReactNode {
  switch (section.kind) {
    case "text":
      return <pre className={styles.plain}>{section.text}</pre>;
    case "code":
      return <DetailCode code={section.code} lang={section.lang} />;
    case "paths":
      return <DetailPaths items={section.items} notices={section.notices} />;
    case "matches":
      return <DetailMatches files={section.files} notices={section.notices} onOpen={onOpen} />;
    case "diffs":
      return (
        <div className={styles.detailDiffs}>
          {section.files.map((file, index) => (
            <div key={`${index}-${file.path}`} className={styles.detailDiff}>
              <div className={styles.grepFileHead}>
                <FileChip path={file.path} label={file.path} onOpen={onOpen} />
              </div>
              <ToolDiffView
                text={file.diff}
                path={file.path}
                fallback={<pre className={styles.plain}>{file.diff}</pre>}
              />
            </div>
          ))}
        </div>
      );
    case "links":
      return <DetailLinks items={section.items} />;
    case "items":
      return <DetailItems items={section.items} />;
    case "json":
      return <ToolJsonTree value={section.value} />;
    default:
      return null;
  }
}

export function ToolDetailBody({ card, streaming, onOpen }: Props): ReactNode {
  const t = useI18n();
  return (
    <>
      <div className={styles.head}>
        <span className={styles.langBadge}>{card.tool}</span>
        {card.target ? (
          <span className={styles.path} title={card.target}>
            {card.target}
          </span>
        ) : null}
        {card.chips.map((chip, index) => (
          <span key={`chip-${index}`} className={styles.meta}>
            {chip.kind === "text" ? chip.text : t.toolDetailCount(chip.unit, chip.value)}
          </span>
        ))}
        {card.flags.map((flag, index) => (
          <span
            key={`flag-${index}`}
            className={
              flag === "failed" || flag === "cancelled" || flag === "timedOut"
                ? styles.exitFail
                : flag === "limit" ||
                    flag === "truncated" ||
                    flag === "noMatches" ||
                    flag === "preview"
                  ? styles.meta
                  : styles.exitOk
            }
          >
            {t.toolDetailFlag(flag)}
          </span>
        ))}
      </div>
      <div className={styles.body} data-inner-scroll="">
        {card.sections.map((section, index) => {
          const title = sectionTitle(t, section);
          return (
            <div key={index} className={styles.detailSection}>
              {title ? <div className={styles.detailSectionHead}>{title}</div> : null}
              <SectionBody section={section} onOpen={onOpen} />
            </div>
          );
        })}
        {!card.sections.length ? (
          <pre className={styles.plain}>
            {streaming ? "" : t.toolResultNoOutput}
          </pre>
        ) : null}
        {card.transcripts.map((entry, index) => (
          <div key={`${index}-${entry.agentId}`} className={styles.detailTranscript}>
            <div className={styles.detailSectionHead}>{entry.label}</div>
            <SubagentTranscript agentId={entry.agentId} active={Boolean(streaming)} />
          </div>
        ))}
      </div>
    </>
  );
}

export default ToolDetailBody;
