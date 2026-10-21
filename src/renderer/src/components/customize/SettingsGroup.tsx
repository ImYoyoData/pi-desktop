import type { ReactNode } from "react";
import styles from "./SettingsGroup.module.css";

type GroupProps = {
  title?: string;
  hint?: string;
  className?: string;
  children: ReactNode;
};

/** 胶囊卡片：一组相关设置放在同一张圆角卡片里，行之间用分隔线隔开。 */
export function SettingsGroup({ title, hint, className, children }: GroupProps): ReactNode {
  return (
    <section className={[styles.group, className].filter(Boolean).join(" ")}>
      {title ? <h3 className={styles.groupTitle}>{title}</h3> : null}
      {hint ? <p className={styles.groupHint}>{hint}</p> : null}
      <div className={styles.card}>{children}</div>
    </section>
  );
}

type RowProps = {
  label: string;
  description?: string;
  className?: string;
  children?: ReactNode;
};

/** 胶囊行：左侧标题与说明，右侧控件。 */
export function SettingsRow({ label, description, className, children }: RowProps): ReactNode {
  return (
    <div className={[styles.row, className].filter(Boolean).join(" ")}>
      <div className={styles.rowText}>
        <span className={styles.rowLabel}>{label}</span>
        {description ? <span className={styles.rowDescription}>{description}</span> : null}
      </div>
      {children ? <div className={styles.rowControl}>{children}</div> : null}
    </div>
  );
}

type SwitchProps = {
  checked: boolean;
  label: string;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
};

/** 胶囊行里的布尔开关。 */
export function SettingsSwitch({
  checked,
  label,
  disabled,
  onChange,
}: SwitchProps): ReactNode {
  const className = checked ? `${styles.switch} ${styles.switchOn}` : styles.switch;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      className={className}
      onClick={() => onChange(!checked)}
    >
      <span className={styles.switchThumb} />
    </button>
  );
}
