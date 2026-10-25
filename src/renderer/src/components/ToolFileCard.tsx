import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button, Tag, Typography } from "antd";
import { ChevronDownOutline, ChevronForwardOutline } from "@renderer/components/icons/ionicons";
import type { FileToolCard } from "@renderer/utils/tool-diff";
import { fileIcon } from "@renderer/utils/file-icon";
import { useI18n } from "@renderer/i18n/use-i18n";
import styles from "./ToolFileCard.module.css";

type Props = {
  card: FileToolCard;
  statusLabel: string;
  statusType: "default" | "success" | "error" | "info";
  toolName: string;
  streaming?: boolean;
  onOpen: (path: string) => void;
};

const STATUS_COLOR: Record<Props["statusType"], string | undefined> = {
  default: undefined,
  success: "success",
  error: "error",
  info: "blue",
};

export function ToolFileCard({
  card,
  statusLabel,
  statusType,
  toolName,
  streaming,
  onOpen,
}: Props): ReactNode {
  const t = useI18n();
  /** Auto-expand while streaming and after completion so the diff is visible. */
  const [manuallyOpen, setManuallyOpen] = useState<boolean | null>(null);
  const [wasStreaming, setWasStreaming] = useState(false);

  const open = manuallyOpen !== null ? manuallyOpen : wasStreaming || Boolean(streaming);

  useEffect(() => {
    if (streaming) {
      setManuallyOpen(null);
      setWasStreaming(true);
    }
  }, [streaming]);

  function toggleOpen(): void {
    setManuallyOpen(!open);
  }

  const fileName = useMemo(() => {
    const p = card.path;
    if (!p) return toolName;
    const parts = p.split(/[/\\]/);
    return parts[parts.length - 1] || p;
  }, [card.path, toolName]);

  const fileGlyph = useMemo(() => (card.path ? fileIcon(card.path) : null), [card.path]);

  const diffLines = useMemo(() => (card.diff ? card.diff.split("\n") : []), [card.diff]);

  return (
    <div className={`${styles.toolFile}${streaming ? ` ${styles.streaming}` : ""}`}>
      <button type="button" className={styles.toolFileHead} onClick={toggleOpen}>
        {open ? (
          <ChevronDownOutline size={12} className={styles.chev} />
        ) : (
          <ChevronForwardOutline size={12} className={styles.chev} />
        )}
        <Typography.Text code className={styles.toolName}>
          {toolName}
        </Typography.Text>
        <span className={styles.path} title={card.path ?? undefined}>
          {fileName}
        </span>
        {card.stats ? (
          <span className={styles.stats}>
            <span className={styles.add}>+{card.stats.additions}</span>
            <span className={styles.del}>-{card.stats.deletions}</span>
          </span>
        ) : null}
        <Tag color={STATUS_COLOR[statusType]}>{statusLabel}</Tag>
        {card.path ? (
          <Button
            size="small"
            type="text"
            className={styles.openBtn}
            title={t.previewFile}
            icon={
              fileGlyph ? (
                <span
                  className={styles.fileGlyph}
                  style={fileGlyph.color ? { color: fileGlyph.color } : undefined}
                  aria-hidden="true"
                >
                  {fileGlyph.glyph}
                </span>
              ) : undefined
            }
            onClick={(event) => {
              event.stopPropagation();
              onOpen(card.path as string);
            }}
          />
        ) : null}
      </button>
      {open && card.diff ? (
        <pre className={styles.toolDiff}>
          <code>
            {diffLines.map((line, i) => (
              <span
                key={i}
                className={`${styles.dline}${
                  line.startsWith("+") && !line.startsWith("+++")
                    ? ` ${styles.addLine}`
                    : line.startsWith("-") && !line.startsWith("---")
                      ? ` ${styles.delLine}`
                      : line.startsWith("@@") ||
                          line.startsWith("diff ") ||
                          line.startsWith("index ") ||
                          line.startsWith("+++") ||
                          line.startsWith("---")
                        ? ` ${styles.meta}`
                        : ""
                }`}
              >
                {line || " "}
              </span>
            ))}
          </code>
        </pre>
      ) : null}
      {open && !card.diff ? (
        <pre className={`${styles.toolDiff} ${styles.empty}`}>{t.toolNoDiff}</pre>
      ) : null}
    </div>
  );
}

export default ToolFileCard;
