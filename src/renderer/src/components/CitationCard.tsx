import { Tag } from "antd";
import type { ReactNode } from "react";
import type { ComposerChip } from "@renderer/stores/composer";
import { truncateElementContent } from "@renderer/stores/composer";
import { fileTagLabel, urlTagLabel } from "@renderer/utils/composer-tags";
import { isRegionCitation } from "../../../shared/protocol";
import { useI18n } from "@renderer/i18n/use-i18n";
import styles from "./CitationCard.module.css";

type Props = {
  chip: ComposerChip;
  onRemove: () => void;
};

export function CitationCard({ chip, onRemove }: Props): ReactNode {
  const t = useI18n();

  /** Content-only label for element tags (max 100 chars). */
  function elementLabel(target: Extract<ComposerChip, { kind: "element" }>): string {
    if (isRegionCitation(target.citation)) return t.chipRegion;
    const content = truncateElementContent(target.citation.text ?? "", 100);
    if (content) return content;
    const sel = target.citation.selector?.trim();
    if (sel) {
      const last = sel.split(">").pop()?.trim() || sel;
      return last.length > 36 ? `${last.slice(0, 36)}…` : last;
    }
    return t.chipElement;
  }

  function elementTitle(target: Extract<ComposerChip, { kind: "element" }>): string {
    return [target.citation.url, target.citation.selector, target.citation.text]
      .filter(Boolean)
      .join("\n");
  }

  function lineRangeSuffix(target: Extract<ComposerChip, { kind: "file" }>): string {
    if (target.startLine && target.endLine) return `:${target.startLine}-${target.endLine}`;
    if (target.startLine) return `:${target.startLine}`;
    return "";
  }

  if (chip.kind === "file") {
    return (
      <Tag
        color="blue"
        closable
        className={`${styles.chipTag} ${styles.chipFile}`}
        title={chip.path}
        onClose={onRemove}
      >
        <span className={styles.chipLabel}>
          {fileTagLabel(chip.path)}
          {lineRangeSuffix(chip)}
        </span>
      </Tag>
    );
  }

  if (chip.kind === "element") {
    return (
      <Tag
        color="blue"
        closable
        className={styles.chipTag}
        title={elementTitle(chip)}
        onClose={onRemove}
      >
        <span className={styles.chipLabel}>{elementLabel(chip)}</span>
      </Tag>
    );
  }

  return (
    <Tag
      color="blue"
      closable
      className={styles.chipTag}
      title={chip.url}
      onClose={onRemove}
    >
      <span className={styles.chipLabel}>{urlTagLabel(chip.url)}</span>
    </Tag>
  );
}

export default CitationCard;
