import type { ReactNode } from "react";
import type { WaitWidget, WaitWidgetBlock } from "@renderer/utils/tool-diff";
import styles from "./WaitJobWidget.module.css";

type Props = {
  widget: WaitWidget;
  /** 已经显示在任务行上的活动文本，避免 widget 的 text 块重复。 */
  activity: string | null;
};

function toneClass(tone: string | null): string {
  switch (tone) {
    case "success":
      return styles.toneSuccess;
    case "error":
      return styles.toneError;
    case "warning":
      return styles.toneWarning;
    case "accent":
      return styles.toneAccent;
    default:
      return styles.toneMuted;
  }
}

function SparkBlock({
  block,
}: {
  block: Extract<WaitWidgetBlock, { kind: "spark" }>;
}): ReactNode {
  const range = block.max - block.min;
  return (
    <div className={styles.spark}>
      {block.label ? <span className={styles.blockLabel}>{block.label}</span> : null}
      <span className={styles.sparkBars} aria-hidden="true">
        {block.values.map((value, index) => (
          <span
            key={index}
            className={`${styles.sparkBar} ${toneClass(block.tone)}`}
            style={{
              height: `${Math.max(4, Math.min(100, ((value - block.min) / range) * 100))}%`,
            }}
          />
        ))}
      </span>
      <span className={styles.sparkLast}>{block.last}</span>
    </div>
  );
}

function BarsBlock({
  block,
}: {
  block: Extract<WaitWidgetBlock, { kind: "bars" }>;
}): ReactNode {
  return (
    <div className={styles.bars}>
      {block.label ? <span className={styles.blockLabel}>{block.label}</span> : null}
      {block.items.map((item, index) => (
        <div key={`${index}-${item.label}`} className={styles.barRow}>
          <span className={styles.barLabel}>{item.label}</span>
          <span className={styles.barTrack}>
            <span
              className={`${styles.barFill} ${toneClass(item.tone)}`}
              style={{
                width: `${Math.max(0, Math.min(100, (item.value / block.max) * 100))}%`,
              }}
            />
          </span>
          <span className={`${styles.barText} ${toneClass(item.tone)}`}>{item.text}</span>
        </div>
      ))}
    </div>
  );
}

function StatBlock({
  block,
}: {
  block: Extract<WaitWidgetBlock, { kind: "stat" }>;
}): ReactNode {
  return (
    <div className={styles.stats}>
      {block.items.map((item, index) => (
        <span key={index} className={styles.stat}>
          <span className={styles.statLabel}>{item.label}</span>
          <span className={`${styles.statValue} ${toneClass(item.tone)}`}>{item.text}</span>
          {item.trend ? <span className={styles.statTrend}>{item.trend}</span> : null}
        </span>
      ))}
    </div>
  );
}

function GridBlock({
  block,
}: {
  block: Extract<WaitWidgetBlock, { kind: "grid" }>;
}): ReactNode {
  return (
    <div className={styles.grid}>
      {block.label ? <span className={styles.blockLabel}>{block.label}</span> : null}
      {block.items.map((item, index) => (
        <span key={`${index}-${item.label}`} className={styles.gridCell}>
          <span className={styles.gridLabel}>{item.label}</span>
          <span className={toneClass(item.tone)}>{item.text}</span>
        </span>
      ))}
    </div>
  );
}

function MeterBlock({
  block,
}: {
  block: Extract<WaitWidgetBlock, { kind: "meter" }>;
}): ReactNode {
  return (
    <div className={styles.meter}>
      {block.label ? <span className={styles.blockLabel}>{block.label}</span> : null}
      <span className={styles.meterTrack}>
        <span
          className={`${styles.meterFill} ${toneClass(block.tone)}`}
          style={{ width: `${block.value * 100}%` }}
        />
      </span>
      <span className={styles.meterText}>{block.text}</span>
    </div>
  );
}

function WidgetBlock({
  block,
  activity,
}: {
  block: WaitWidgetBlock;
  activity: string | null;
}): ReactNode {
  switch (block.kind) {
    case "spark":
      return <SparkBlock block={block} />;
    case "bars":
      return <BarsBlock block={block} />;
    case "stat":
      return <StatBlock block={block} />;
    case "grid":
      return <GridBlock block={block} />;
    case "meter":
      return <MeterBlock block={block} />;
    case "text":
      if (activity && block.text === activity) return null;
      return <div className={styles.text}>{block.text}</div>;
    default: {
      const _never: never = block;
      void _never;
      return null;
    }
  }
}

/** omp 的 JobWidgetView：headline + 指标块，说明后台任务此刻在做什么。 */
export function WaitJobWidget({ widget, activity }: Props): ReactNode {
  return (
    <div className={styles.widget}>
      {widget.headline ? (
        <div className={styles.headline}>
          <span className={`${styles.headlineText} ${toneClass(widget.headline.tone)}`}>
            {widget.headline.text}
          </span>
          {widget.headline.label ? (
            <span className={styles.headlineLabel}>{widget.headline.label}</span>
          ) : null}
          {widget.headline.trend ? (
            <span className={`${styles.trend} ${toneClass(widget.headline.tone)}`}>
              {widget.headline.trend}
            </span>
          ) : null}
        </div>
      ) : null}
      {widget.blocks.map((block, index) => (
        <WidgetBlock key={index} block={block} activity={activity} />
      ))}
    </div>
  );
}

export default WaitJobWidget;
