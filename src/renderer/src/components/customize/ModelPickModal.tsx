import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button, Checkbox, Input, Modal, Space } from "antd";
import type { DiscoveredModel } from "../../../../shared/model-discover";
import { useI18n } from "@renderer/i18n/use-i18n";
import styles from "./ModelPickModal.module.css";

type Props = {
  show: boolean;
  models: DiscoveredModel[];
  /** Model ids already present in the provider draft. */
  existingIds: string[];
  onClose?: () => void;
  onConfirm?: (models: DiscoveredModel[]) => void;
};

type DisplayRow = {
  id: string;
  meta: string;
  reasoning: boolean;
  vision: boolean;
  existing: boolean;
};

export function ModelPickModal({
  show,
  models,
  existingIds,
  onClose,
  onConfirm,
}: Props): ReactNode {
  const t = useI18n();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!show) return;
    setQuery("");
    setSelected(new Set());
  }, [show]);

  const existing = useMemo(() => new Set(existingIds), [existingIds]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return models;
    return models.filter(
      (model) =>
        model.id.toLowerCase().includes(q) || (model.name ?? "").toLowerCase().includes(q),
    );
  }, [models, query]);

  const selectableVisible = useMemo(
    () => filtered.filter((model) => !existing.has(model.id)),
    [existing, filtered],
  );

  const allVisibleSelected = useMemo(
    () =>
      selectableVisible.length > 0 &&
      selectableVisible.every((model) => selected.has(model.id)),
    [selectableVisible, selected],
  );

  function describeModel(model: DiscoveredModel): string {
    const parts: string[] = [];
    if (model.name && model.name !== model.id) parts.push(model.name);
    if (model.contextWindow) {
      parts.push(`${t.modelsCustomContextWindow} ${model.contextWindow.toLocaleString()}`);
    }
    if (model.maxTokens) {
      parts.push(`${t.modelsCustomMaxTokens} ${model.maxTokens.toLocaleString()}`);
    }
    return parts.join(" · ");
  }

  /** 行数据：把自动获取到的能力信息一并展示出来。 */
  const displayRows: DisplayRow[] = filtered.map((model) => ({
    id: model.id,
    meta: describeModel(model),
    reasoning: model.reasoning === true,
    vision: model.vision === true,
    existing: existing.has(model.id),
  }));

  function toggle(id: string): void {
    if (existing.has(id)) return;
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  function toggleAllVisible(): void {
    const next = new Set(selected);
    if (allVisibleSelected) {
      for (const model of selectableVisible) next.delete(model.id);
    } else {
      for (const model of selectableVisible) next.add(model.id);
    }
    setSelected(next);
  }

  function confirmPick(): void {
    const picked = models.filter((model) => selected.has(model.id));
    if (!picked.length) return;
    onConfirm?.(picked);
  }

  return (
    <Modal
      open={show}
      className="pi-settings-modal"
      width="min(560px, 92vw)"
      mask={{ closable: false }}
      onCancel={() => onClose?.()}
      title={
        <div className={styles.modalTitleBlock}>
          <div className={styles.modalTitle}>{t.modelsCustomPickTitle}</div>
          <div className={styles.modalSubtitle}>{t.modelsCustomPickSubtitle}</div>
        </div>
      }
      footer={
        <div className={styles.pickFooter}>
          <span className={styles.pickCount}>
            {t.modelsCustomPickSelected(selected.size)}
          </span>
          <Space style={{ justifyContent: "flex-end" }}>
            <Button
              type="primary"
              size="small"
              disabled={!selected.size}
              onClick={confirmPick}
            >
              {t.modelsCustomPickAdd}
            </Button>
            <Button size="small" onClick={() => onClose?.()}>
              {t.cancel}
            </Button>
          </Space>
        </div>
      }
    >
      <div className={styles.pickToolbar}>
        <Input
          value={query}
          size="small"
          allowClear
          placeholder={t.modelsCustomPickSearch}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Button
          size="small"
          type="default"
          disabled={!selectableVisible.length}
          onClick={toggleAllVisible}
        >
          {allVisibleSelected ? t.modelsCustomPickClear : t.modelsCustomPickSelectAll}
        </Button>
      </div>

      <div className={styles.pickList}>
        {!displayRows.length ? (
          <p className={styles.pickEmpty}>{t.modelsCustomPickEmpty}</p>
        ) : null}
        {displayRows.map((row) => (
          <div
            key={row.id}
            className={row.existing ? `${styles.pickRow} ${styles.existing}` : styles.pickRow}
            onClick={() => toggle(row.id)}
          >
            <Checkbox
              className={styles.pickCheck}
              checked={selected.has(row.id)}
              disabled={row.existing}
              onClick={(event) => event.stopPropagation()}
              onChange={() => toggle(row.id)}
            />
            <span className={styles.pickMain}>
              <span className={styles.pickHead}>
                <span className={styles.pickId}>{row.id}</span>
                {row.reasoning ? (
                  <span className={styles.pickTag}>{t.modelsCustomReasoning}</span>
                ) : null}
                {row.vision ? (
                  <span className={styles.pickTag}>{t.modelsCustomVision}</span>
                ) : null}
              </span>
              {row.meta ? <span className={styles.pickSub}>{row.meta}</span> : null}
            </span>
            {row.existing ? (
              <span className={styles.pickBadge}>{t.modelsCustomPickExisting}</span>
            ) : null}
          </div>
        ))}
      </div>
    </Modal>
  );
}

export default ModelPickModal;
