import type { ReactNode } from "react";
import { useI18n } from "@renderer/i18n/use-i18n";
import styles from "./ToggleButton.module.css";

type Props = {
  value: boolean;
  /** 无标签时按钮固定显示「启用」，有标签时显示标签；高亮均代表已开启。 */
  label?: string;
  title?: string;
  disabled?: boolean;
  loading?: boolean;
  className?: string;
  onValueChange?: (value: boolean) => void;
};

export function ToggleButton({
  value,
  label,
  title,
  disabled,
  loading,
  className,
  onValueChange,
}: Props): ReactNode {
  const t = useI18n();
  const text = label || t.enable;
  const hint = title || label || "";

  return (
    <button
      type="button"
      className={[styles.root, value && styles.checked, className].filter(Boolean).join(" ")}
      disabled={disabled || loading}
      title={hint}
      aria-pressed={value}
      onClick={() => onValueChange?.(!value)}
    >
      {text}
    </button>
  );
}

export default ToggleButton;
