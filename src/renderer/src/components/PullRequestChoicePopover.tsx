import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Popover, Spin } from "antd";
import { CheckmarkOutline, SearchOutline, SettingsOutline } from "@renderer/components/icons/ionicons";
import { useI18n } from "@renderer/i18n/use-i18n";
import styles from "./PullRequestChoicePopover.module.css";

export type ChoiceOption = { value: string; label?: string; color?: string };

type Props = {
  title: string;
  options: ChoiceOption[];
  selected: string[];
  multi?: boolean;
  loading?: boolean;
  error?: string | null;
  onLoad?: () => void;
  onToggle?: (value: string, on: boolean) => void;
};

const CHOICE_POPOVER_STYLES = {
  container: { padding: 0 },
  content: { padding: 0, width: "256px" },
};

export function PullRequestChoicePopover({
  title,
  options,
  selected,
  loading = false,
  error = null,
  onLoad,
  onToggle,
}: Props): ReactNode {
  const t = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  const visible = useMemo(() => {
    const text = query.trim().toLowerCase();
    if (!text) return options;
    return options.filter((option) => (option.label ?? option.value).toLowerCase().includes(text));
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  function onOpenChange(next: boolean): void {
    setOpen(next);
    if (!next) return;
    setQuery("");
    onLoad?.();
  }

  function toggle(option: ChoiceOption, next: boolean): void {
    onToggle?.(option.value, next);
  }

  const panel = (
    <div className={styles.panel}>
      <div className={styles.search}>
        <SearchOutline size={14} className={styles.searchIcon} />
        <input
          ref={inputRef}
          value={query}
          type="search"
          placeholder={t.prFilterField(title)}
          aria-label={t.prFilterField(title)}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => event.stopPropagation()}
        />
      </div>
      <div className={styles.list}>
        {error ? (
          <p className={styles.error}>{error}</p>
        ) : loading && options.length === 0 ? (
          <div className={styles.loading}>
            <Spin size="small" />
          </div>
        ) : visible.length === 0 ? (
          <p className={styles.empty}>{t.prNoChoiceMatches(query.trim())}</p>
        ) : (
          visible.map((option) => (
            <button
              key={option.value}
              type="button"
              className={styles.option}
              aria-pressed={selected.includes(option.value)}
              onClick={() => toggle(option, !selected.includes(option.value))}
            >
              <span
                className={`${styles.dot} ${option.color ? "" : styles.hidden}`}
                style={option.color ? { background: `#${option.color}` } : undefined}
              />
              <span className={styles.label}>{option.label ?? option.value}</span>
              <CheckmarkOutline
                size={14}
                className={`${styles.check} ${selected.includes(option.value) ? styles.on : ""}`}
              />
            </button>
          ))
        )}
      </div>
    </div>
  );

  return (
    <Popover
      trigger="click"
      placement="bottomRight"
      arrow={false}
      open={open}
      onOpenChange={onOpenChange}
      styles={CHOICE_POPOVER_STYLES}
      content={panel}
    >
      <button
        type="button"
        className={styles.trigger}
        aria-label={t.prEditField(title)}
        aria-expanded={open}
      >
        <SettingsOutline size={14} />
      </button>
    </Popover>
  );
}

export default PullRequestChoicePopover;
