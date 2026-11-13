import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactElement } from "react";
import { Button, Checkbox } from "antd";
import {
  ChevronDownOutline,
  PinOutline,
  TrashOutline,
} from "@renderer/components/icons/ionicons";
import {
  isRunning,
  relativeTime,
  type VisibleSessionItem,
} from "./sidebar-model";
import styles from "../SessionSidebar.module.css";

type Props = {
  root: string;
  item: VisibleSessionItem;
  sIdx: number;
  projectName?: string;
  label: string;
  pinned: boolean;
  pendingAsk: boolean;
  justEnded: boolean;
  selected: boolean;
  guidesVisible: boolean;
  selectMode: boolean;
  sessionSelected: boolean;
  collapsedNode: boolean;
  onSelect: (event: ReactMouseEvent) => void;
  onContextMenu: (event: ReactMouseEvent) => void;
  onEnter: () => void;
  onLeave: () => void;
  onToggleNode: () => void;
  onDelete: () => void;
  onToggleSelect: () => void;
};

/** 单条会话行：树导线、状态点、折叠按钮、标题/元信息与选择/删除操作。 */
export function SessionRow({
  root,
  item,
  sIdx,
  projectName,
  label,
  pinned,
  pendingAsk,
  justEnded,
  selected,
  guidesVisible,
  selectMode,
  sessionSelected,
  collapsedNode,
  onSelect,
  onContextMenu,
  onEnter,
  onLeave,
  onToggleNode,
  onDelete,
  onToggleSelect,
}: Props): ReactElement {
  const sessionId = item.session.id;
  return (
    <li
      className={`${styles.sessionRow} ${selected ? styles.sessionRowActive : ""} ${
        guidesVisible ? styles.sessionRowGuidesVisible : ""
      } ${selectMode && sessionSelected ? styles.sessionRowSelected : ""}`}
      data-session-row
      data-id={sessionId}
      data-no-ws-drag
      style={
        {
          "--i": String(sIdx),
          "--depth": item.depth,
        } as CSSProperties
      }
      aria-expanded={item.hasChildren ? !collapsedNode : undefined}
      onClick={onSelect}
      onContextMenu={onContextMenu}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <div className={styles.sessionInner}>
        {item.guideFull.map((full, gi) => (
          <span
            key={gi}
            className={`${styles.treeGuide} ${
              full
                ? styles.treeGuideFull
                : gi === item.guideFull.length - 1
                  ? styles.treeGuideElbow
                  : styles.treeGuideEnded
            }`}
            style={{ "--g": gi } as CSSProperties}
            aria-hidden="true"
          />
        ))}
        {item.depth > 0 && !item.isLastSibling ? (
          <span
            className={styles.treeConnector}
            style={{ "--g": item.depth - 1 } as CSSProperties}
            aria-hidden="true"
          />
        ) : null}
        {item.hasChildren && !collapsedNode ? (
          <span
            className={styles.treeDescender}
            style={{ "--g": item.depth } as CSSProperties}
            aria-hidden="true"
          />
        ) : null}
        <span className={styles.activeBar} />
        <span
          className={`${styles.statusMark} ${
            styles[
              `st${(item.session.status || "idle").charAt(0).toUpperCase()}${(item.session.status || "idle").slice(1)}`
            ] ?? ""
          }`}
          aria-hidden="true"
        >
          <i className={styles.statusCore} />
        </span>
        {item.hasChildren ? (
          <button
            type="button"
            className={`${styles.treeTwistie} ${
              collapsedNode ? styles.treeTwistieCollapsed : ""
            }`}
            onClick={(e) => {
              e.stopPropagation();
              onToggleNode();
            }}
          >
            <ChevronDownOutline size={16} />
          </button>
        ) : null}
        <div className={styles.sessionBody}>
          <div className={styles.sessionTitleRow}>
            {pinned ? <PinOutline className={styles.pin} size={11} /> : null}
            <span className={styles.sessionLabel}>{label}</span>
          </div>
          <div className={styles.sessionMeta}>
            {projectName ? (
              <span className={styles.projectTag} title={root}>
                {projectName}
              </span>
            ) : null}
            <span className={styles.time}>
              {relativeTime(item.session.modified)}
            </span>
            {isRunning(item.session.status) ? (
              <span
                className={`${styles.runTag} ${pendingAsk ? styles.runTagAsk : ""}`}
              >
                {pendingAsk ? "ask" : "live"}
              </span>
            ) : item.session.status === "error" ? (
              <span className={styles.errTag}>err</span>
            ) : item.session.status === "stuck" ? (
              <span className={styles.stuckTag}>stuck</span>
            ) : justEnded ? (
              <span className={styles.doneTag}>done</span>
            ) : null}
          </div>
        </div>
        {selectMode ? (
          <Checkbox
            className={styles.sessionCheck}
            checked={sessionSelected}
            data-no-session-drag
            onClick={(e) => e.stopPropagation()}
            onChange={onToggleSelect}
          />
        ) : (
          <Button
            className={styles.trash}
            type="text"
            shape="circle"
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
          >
            <TrashOutline size={14} />
          </Button>
        )}
      </div>
    </li>
  );
}
