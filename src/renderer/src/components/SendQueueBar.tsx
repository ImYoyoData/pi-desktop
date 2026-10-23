import { useEffect, useState, type ReactNode } from "react";
import { Button } from "antd";
import {
  ChevronDownOutline,
  ChevronForwardOutline,
  CreateOutline,
  NavigateOutline,
  TrashOutline,
} from "@renderer/components/icons/ionicons";
import type { QueuedSendItem } from "@renderer/stores/send-queue";
import { useI18n } from "@renderer/i18n/use-i18n";
import styles from "./SendQueueBar.module.css";

export type SendQueueBarProps = {
  items: QueuedSendItem[];
  editingId?: string | null;
  onEdit?: (id: string) => void;
  onRemove?: (id: string) => void;
  onSendNow?: (id: string) => void;
};

export function SendQueueBar({
  items,
  editingId,
  onEdit,
  onRemove,
  onSendNow,
}: SendQueueBarProps): ReactNode {
  const t = useI18n();
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    if (items.length === 0) setExpanded(true);
    if (editingId) setExpanded(true);
  }, [items.length]);

  useEffect(() => {
    if (editingId) setExpanded(true);
  }, [editingId]);

  function toggleExpanded(): void {
    setExpanded((prev) => !prev);
  }

  function previewText(item: QueuedSendItem): string {
    const raw = item.text.replace(/\s+/g, " ").trim();
    if (raw) return raw;
    if (item.images?.length) return `[${item.images.length} image(s)]`;
    if (item.elementTags?.length) return item.elementTags[0]?.label || "[attachment]";
    return "…";
  }

  if (!items.length) return null;

  return (
    <div className={styles.root} aria-label={t.queueTitle}>
      <button type="button" className={styles.queueHead} onClick={toggleExpanded}>
        {expanded ? (
          <ChevronDownOutline size={12} className={styles.queueChevron} />
        ) : (
          <ChevronForwardOutline size={12} className={styles.queueChevron} />
        )}
        <span className={styles.queueHeadTitle}>
          {t.queueTitle} · {items.length}
        </span>
        {!expanded ? (
          <span className={styles.queueHeadPreview}>{previewText(items[0]!)}</span>
        ) : null}
      </button>

      {expanded
        ? items.map((item, index) => (
            <div
              key={item.id}
              className={`${styles.queueRow} ${editingId === item.id ? styles.editing : ""}`}
            >
              <span className={styles.queueIndex}>{index + 1}</span>
              <button
                type="button"
                className={styles.queuePreview}
                title={item.text}
                disabled={editingId === item.id}
                onClick={() => onEdit?.(item.id)}
              >
                <span className={styles.queuePreviewText}>{previewText(item)}</span>
                {editingId === item.id ? (
                  <span className={styles.queueEditingBadge}>{t.queueEditing}</span>
                ) : null}
              </button>
              <div className={styles.queueActions}>
                <Button
                  size="small"
                  type="text"
                  className={styles.qBtn}
                  disabled={editingId === item.id}
                  title={t.queueEdit}
                  aria-label={t.queueEdit}
                  onClick={() => onEdit?.(item.id)}
                  icon={<CreateOutline size={12} />}
                />
                <Button
                  size="small"
                  type="text"
                  className={styles.qBtn}
                  disabled={editingId === item.id}
                  title={t.queueSendNow}
                  aria-label={t.queueSendNow}
                  onClick={() => onSendNow?.(item.id)}
                  icon={<NavigateOutline size={12} />}
                />
                <Button
                  size="small"
                  type="text"
                  className={styles.qBtn}
                  title={t.queueRemove}
                  aria-label={t.queueRemove}
                  onClick={() => onRemove?.(item.id)}
                  icon={<TrashOutline size={12} />}
                />
              </div>
            </div>
          ))
        : null}
    </div>
  );
}

export default SendQueueBar;
