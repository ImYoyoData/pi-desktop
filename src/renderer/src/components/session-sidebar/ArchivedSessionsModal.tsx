import type { ReactElement } from "react";
import { Button, Checkbox, Input, Modal } from "antd";
import type { useI18n } from "@renderer/i18n/use-i18n";
import { relativeTime, type ArchivedRow } from "./sidebar-model";
import styles from "../SessionSidebar.module.css";

type Translator = ReturnType<typeof useI18n>;

type Props = {
  open: boolean;
  rows: ArchivedRow[];
  query: string;
  selected: string[];
  t: Translator;
  onClose: () => void;
  onQueryChange: (query: string) => void;
  onRowClick: (id: string, shiftKey: boolean) => void;
  onToggleSelect: (id: string) => void;
  onRestore: () => void;
  onDelete: () => void;
};

/** 归档会话列表：搜索、Shift 连选、批量恢复/删除。 */
export function ArchivedSessionsModal({
  open,
  rows,
  query,
  selected,
  t,
  onClose,
  onQueryChange,
  onRowClick,
  onToggleSelect,
  onRestore,
  onDelete,
}: Props): ReactElement {
  return (
    <Modal
      open={open}
      className="pi-settings-modal"
      mask={{ closable: false }}
      width="min(520px, 92vw)"
      title={t.archivedSessions}
      onCancel={onClose}
      footer={
        <div className={styles.archivedActions}>
          <Button type="text" size="small" onClick={onClose}>
            {t.cancel}
          </Button>
          <Button
            type="text"
            size="small"
            disabled={!selected.length}
            onClick={onRestore}
          >
            {t.archiveRestore}
          </Button>
          <Button
            type="text"
            size="small"
            danger
            disabled={!selected.length}
            onClick={onDelete}
          >
            {t.delete}
          </Button>
        </div>
      }
    >
      <Input
        className={styles.archivedSearch}
        size="small"
        allowClear
        value={query}
        placeholder={t.archiveSearchPlaceholder}
        onChange={(e) => onQueryChange(e.target.value)}
      />
      {!rows.length ? (
        <div className={styles.archivedEmpty}>
          {query.trim() ? t.archiveNoMatch : t.archiveEmpty}
        </div>
      ) : (
        <ul className={styles.archivedList}>
          {rows.map((row) => (
            <li
              key={row.id}
              className={`${styles.archivedRow} ${
                selected.includes(row.id) ? styles.archivedRowSelected : ""
              }`}
              onClick={(e) => onRowClick(row.id, e.shiftKey)}
            >
              <Checkbox
                className={styles.archivedCheck}
                checked={selected.includes(row.id)}
                onClick={(e) => e.stopPropagation()}
                onChange={() => onToggleSelect(row.id)}
              />
              <div className={styles.archivedMeta}>
                <span className={styles.archivedLabel}>{row.label}</span>
                <span className={styles.archivedSub}>
                  {row.workspace}
                  {row.modified ? ` · ${relativeTime(row.modified)}` : ""}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
