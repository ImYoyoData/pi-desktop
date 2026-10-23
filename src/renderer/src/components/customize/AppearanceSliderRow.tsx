import type { ReactNode } from "react";
import { Slider, Tooltip } from "antd";
import styles from "./AppearanceSliderRow.module.css";

type Props = {
  label: string;
  value: number;
  min?: number;
  tip?: string;
  disabled?: boolean;
  onValueChange?: (value: number) => void;
};

export function AppearanceSliderRow({
  label,
  value,
  min = 0,
  tip = "",
  disabled = false,
  onValueChange,
}: Props): ReactNode {
  const percentValue = Math.round(value * 100);

  function onUpdate(next: number): void {
    onValueChange?.(next / 100);
  }

  return (
    <div className={styles.sliderRow}>
      <div className={styles.sliderHead}>
        <span className={styles.sliderLabel}>{label}</span>
        {tip ? (
          <Tooltip title={tip} mouseEnterDelay={0.15}>
            <span className={styles.sliderTip}>?</span>
          </Tooltip>
        ) : null}
        <span className={styles.sliderValue}>{percentValue}%</span>
      </div>
      <Slider
        value={percentValue}
        min={min}
        max={100}
        step={1}
        tooltip={{ open: false }}
        disabled={disabled}
        onChange={onUpdate}
      />
    </div>
  );
}

export default AppearanceSliderRow;
