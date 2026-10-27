import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  BrainOutline,
  ChevronForwardOutline,
  CreateOutline,
  DocumentTextOutline,
  EyeOutline,
  ListOutline,
  SquareTerminalOutline,
} from "@renderer/components/icons/ionicons";
import type { ChatMessage } from "@renderer/stores/chat";
import ThinkingBlock from "@renderer/components/ThinkingBlock";
import ToolCallCard from "@renderer/components/ToolCallCard";
import { toolCardFor, type ToolCard } from "@renderer/utils/tool-diff";
import {
  categorizeToolCall,
  workSectionCountSummary,
  workSectionLiveTitle,
  type WorkSectionTool,
} from "@renderer/utils/tool-group";
import { useI18n } from "@renderer/i18n/use-i18n";
import styles from "./WorkSectionGroup.module.css";

type ToolMessage = Extract<ChatMessage, { role: "tool" }>;

type Props = {
  /** Process rows in order: tool calls mixed with thinking-only notes. */
  items: ChatMessage[];
  /** True once the next output appeared after this section: fold + summary title. */
  autoCollapse?: boolean;
  onOpen: (path: string) => void;
};

function isToolMessage(msg: ChatMessage): msg is ToolMessage {
  return msg.role === "tool";
}

export function WorkSectionGroup({ items, autoCollapse, onOpen }: Props): ReactNode {
  const t = useI18n();
  const [manuallyOpen, setManuallyOpen] = useState<boolean | null>(null);
  /** Animate folds only after first paint — matches Copilot (transition after mount). */
  const [animated, setAnimated] = useState(false);
  const animationRaf = useRef(0);
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  /**
   * Fold/unfold animates grid-rows, which re-layouts the whole expanded subtree
   * on every frame. When the section holds huge tool outputs (each diff/output
   * line becomes a DOM node), that freezes the UI thread, so oversized sections
   * skip the animation and snap instead.
   */
  const HEAVY_SECTION_CHARS = 60_000;

  const toolItems = useMemo(() => items.filter(isToolMessage), [items]);

  const heavySection = useMemo(() => {
    let chars = 0;
    for (const msg of items) {
      if (msg.role === "tool") {
        const card = toolCardFor(msg);
        if (card.kind === "bash" || card.kind === "read" || card.kind === "generic") {
          chars += card.preview?.length ?? 0;
        } else if (card.kind === "edit" || card.kind === "write" || card.kind === "other") {
          chars += card.diff?.length ?? 0;
        }
      } else if (msg.role === "assistant" && msg.thinking) {
        chars += msg.thinking.length;
      }
      if (chars > HEAVY_SECTION_CHARS) return true;
    }
    return false;
  }, [items]);

  const anyStreaming = items.some((m) => "streaming" in m && Boolean(m.streaming));

  const open = useMemo(() => {
    // Next output appeared: only a user-expanded section stays open.
    if (autoCollapse) return manuallyOpen === true;
    if (manuallyOpen !== null) return manuallyOpen;
    // Live: stay expanded so each step streams in line by line (Copilot
    // CollapsedPreview keeps the section open while streaming).
    return true;
  }, [autoCollapse, manuallyOpen]);

  // Copilot folds the block as soon as the next output shows up (the answer
  // text or the next work section), not when the whole turn finishes. We delay
  // the fold slightly so the newly appearing output is visible first, then the
  // earlier block rolls up — no snap on the first token of the next output.
  const prevAutoCollapse = useRef(autoCollapse);
  useEffect(() => {
    const prev = prevAutoCollapse.current;
    prevAutoCollapse.current = autoCollapse;
    if (!autoCollapse || prev) return;
    collapseTimer.current = setTimeout(() => {
      collapseTimer.current = undefined;
      setManuallyOpen(false);
    }, 350);
    return () => {
      if (collapseTimer.current) {
        clearTimeout(collapseTimer.current);
        collapseTimer.current = undefined;
      }
    };
  }, [autoCollapse]);

  const prevItemsLength = useRef(items.length);
  useEffect(() => {
    const prev = prevItemsLength.current;
    prevItemsLength.current = items.length;
    if (items.length <= prev || autoCollapse || manuallyOpen !== false) return;
    // A new step arrived while we were about to auto-fold — abort the fold.
    if (collapseTimer.current) {
      clearTimeout(collapseTimer.current);
      collapseTimer.current = undefined;
    }
    setManuallyOpen(null);
  }, [items.length, autoCollapse, manuallyOpen]);

  const lastOpen = useRef(open);
  useEffect(() => {
    if (lastOpen.current === open) return;
    lastOpen.current = open;
    // Oversized sections snap instantly: animating grid-rows would re-layout
    // tens of thousands of DOM nodes every frame and freeze the UI thread.
    if (heavySection) {
      setAnimated(false);
      return;
    }
    animationRaf.current = requestAnimationFrame(() => {
      setAnimated(true);
    });
  }, [open, heavySection]);

  function toggle(): void {
    setManuallyOpen(!open);
  }

  useEffect(() => {
    return () => {
      cancelAnimationFrame(animationRaf.current);
      clearTimeout(collapseTimer.current);
    };
  }, []);

  const thinkingCount = items.length - toolItems.length;

  const categorized = useMemo(() => {
    const tools: WorkSectionTool[] = [];
    for (const msg of toolItems) {
      tools.push(categorizeToolCall(msg.toolName, msg.args));
      // 嵌套调用（codemode 等）也计入分类，但不另占一行。
      for (const call of msg.nestedCalls ?? []) {
        tools.push(categorizeToolCall(call.toolName, call.args));
      }
    }
    return tools;
  }, [toolItems]);

  /** Cap so a wide fan-out cannot push the header past its single line. */
  const MAX_LIVE_LABELS = 4;

  /**
   * Live title: every tool call that is still running, shown while streaming.
   *
   * The same step later folds into the section summary — this is only so the user
   * can see what is happening RIGHT NOW, including several operations running at
   * once (each one gets its own segment, capped at MAX_LIVE_LABELS).
   */
  const liveTitle = useMemo(() => {
    const active: { name: string; tool: WorkSectionTool }[] = [];
    for (const msg of items) {
      if (msg.role !== "tool") continue;
      if (msg.streaming) {
        active.push({ name: msg.toolName, tool: categorizeToolCall(msg.toolName, msg.args) });
      }
      for (const call of msg.nestedCalls ?? []) {
        if (call.streaming) {
          active.push({ name: call.toolName, tool: categorizeToolCall(call.toolName, call.args) });
        }
      }
    }
    // Nothing marked streaming yet (between steps / thinking only): same fallback.
    if (!active.length) return t.wsLiveThinking;

    const labels: string[] = [];
    const seen = new Set<string>();
    for (const step of active) {
      const label = workSectionLiveTitle(step.name, step.tool);
      // Two identical operations (e.g. three reads of the same file) collapse to
      // one segment rather than "读取 a.ts · 读取 a.ts".
      if (seen.has(label)) continue;
      seen.add(label);
      labels.push(label);
      if (labels.length >= MAX_LIVE_LABELS) break;
    }
    // Trailing "+N" when the cap hides work, so the header never under-reports.
    const hidden = Math.max(0, active.length - labels.length);
    return labels.join(" · ") + (hidden > 0 ? ` · +${hidden}` : "");
  }, [items, t]);

  /** Settled title: past-tense natural-language summary (Copilot finalized header). */
  const summaryTitle = useMemo(
    () =>
      workSectionCountSummary(categorized, thinkingCount, {
        editOne: t.wsSummaryEditOne,
        editMany: t.wsSummaryEditMany,
        readOne: t.wsSummaryReadOne,
        readMany: t.wsSummaryReadMany,
        readAndEdited: t.wsSummaryReadEdited,
        steps: t.wsSummarySteps,
        thinkingCount: t.wsSummaryThinkingCount,
        editCount: t.wsSummaryEditCount,
        readCount: t.wsSummaryReadCount,
        bashCount: t.wsSummaryBashCount,
        todoCount: t.wsSummaryTodoCount,
        toolCount: t.wsSummaryToolCount,
        separator: t.wsSummarySeparator,
      }),
    [categorized, thinkingCount, t],
  );

  /** Copilot aggregated diff pill: sums diff stats of every edit in the section. */
  const diffTotals = useMemo(() => {
    let added = 0;
    let removed = 0;
    for (const msg of toolItems) {
      const card = toolCardFor(msg);
      if (card.kind === "edit" || card.kind === "write" || card.kind === "other") {
        if (card.stats) {
          added += card.stats.additions;
          removed += card.stats.deletions;
        }
      }
    }
    return { added, removed };
  }, [toolItems]);
  const hasDiff = diffTotals.added > 0 || diffTotals.removed > 0;

  /**
   * 折叠态的读/改/命令比例条：一眼看出这一轮主要在做什么。
   * 宽度按各类步骤数占比分配，没有这三类步骤时不显示。
   */
  const ratioParts = useMemo(() => {
    const counts = { edit: 0, read: 0, bash: 0 };
    for (const tool of categorized) {
      if (tool.kind === "edit") counts.edit += 1;
      else if (tool.kind === "read") counts.read += 1;
      else if (tool.kind === "bash") counts.bash += 1;
    }
    const total = counts.edit + counts.read + counts.bash;
    if (!total) return [];
    const parts: Array<{ key: string; className: string; percent: number }> = [];
    if (counts.edit) {
      parts.push({
        key: "edit",
        className: styles.ratioEdit,
        percent: (counts.edit / total) * 100,
      });
    }
    if (counts.read) {
      parts.push({
        key: "read",
        className: styles.ratioRead,
        percent: (counts.read / total) * 100,
      });
    }
    if (counts.bash) {
      parts.push({
        key: "bash",
        className: styles.ratioBash,
        percent: (counts.bash / total) * 100,
      });
    }
    return parts;
  }, [categorized]);

  const settled = Boolean(autoCollapse) || !anyStreaming;
  const title = settled ? summaryTitle : liveTitle;

  /** 小节首图标跟随标题第一个统计段。 */
  const HeaderIcon = useMemo(() => {
    const kinds = new Set(categorized.map((tool) => tool.kind));
    if (kinds.has("edit")) return CreateOutline;
    if (thinkingCount > 0) return BrainOutline;
    if (kinds.has("read")) return EyeOutline;
    if (kinds.has("bash")) return SquareTerminalOutline;
    if (kinds.has("todo")) return ListOutline;
    return DocumentTextOutline;
  }, [categorized, thinkingCount]);

  /** Shared memoized card parsing per message object (tool-diff.ts). */
  function toolCard(msg: ToolMessage): ToolCard {
    return toolCardFor(msg);
  }

  function toolStatus(msg: ToolMessage): {
    type: "default" | "success" | "error" | "info";
    label: string;
  } {
    if (msg.streaming) return { type: "info", label: t.toolRunning };
    if (msg.isError) return { type: "error", label: t.toolError };
    return { type: "success", label: t.toolDone };
  }

  return (
    <div className={`${styles.workSection}${open ? ` ${styles.open}` : ""}`}>
      <button
        type="button"
        className={styles.workSectionHead}
        aria-expanded={open}
        onClick={toggle}
      >
        <span className={styles.sectionIcon} aria-hidden="true">
          <HeaderIcon size={13} />
        </span>
        <span className={`${styles.summary}${!settled ? " copilot-shimmer" : ""}`}>{title}</span>
        {settled && hasDiff ? (
          <span className={styles.diffPill} title={t.wsViewChanges}>
            <span className={styles.labelAdded}>+{diffTotals.added}</span>
            <span className={styles.labelRemoved}>-{diffTotals.removed}</span>
          </span>
        ) : null}
        <ChevronForwardOutline
          size={12}
          className={`${styles.hoverChev}${open ? ` ${styles.expanded}` : ""}`}
          aria-hidden="true"
        />
      </button>

      {ratioParts.length ? (
        <div className={styles.ratioBar} aria-hidden="true">
          {ratioParts.map((part) => (
            <i key={part.key} className={part.className} style={{ width: `${part.percent}%` }} />
          ))}
        </div>
      ) : null}

      <div
        className={`${styles.workSectionAnimation}${!open ? ` ${styles.collapsed}` : ""}${animated ? ` ${styles.animated}` : ""}`}
        aria-hidden={open ? undefined : "true"}
      >
        <div
          className={`${styles.workSectionAnimationInner}${heavySection && !open ? ` ${styles.forceHidden}` : ""}`}
        >
          <div className={styles.timeline}>
            {items.map((msg) => {
              if (isToolMessage(msg)) {
                const status = toolStatus(msg);
                return (
                  <div key={msg.toolCallId}>
                    <ToolCallCard
                      card={toolCard(msg)}
                      toolName={msg.toolName}
                      statusLabel={status.label}
                      statusType={status.type}
                      streaming={msg.streaming}
                      autoCollapse={autoCollapse}
                      nestedCalls={msg.nestedCalls}
                      variant="step"
                      detailCollapsed
                      onOpen={onOpen}
                    />
                  </div>
                );
              }
              if (msg.role === "assistant" && msg.thinking) {
                return (
                  <div
                    key={msg.id}
                    className={styles.thinkingItem}
                  >
                    <div className={styles.thinkingContent}>
                      <ThinkingBlock
                        thinking={msg.thinking}
                        streaming={Boolean(msg.streaming)}
                        autoCollapse={Boolean(autoCollapse)}
                        durationMs={msg.thinkingDurationMs}
                        startedAt={msg.thinkingStartedAt}
                        leadingIcon={
                          <span className={styles.thinkingIcon} aria-hidden="true">
                            <BrainOutline size={12} />
                          </span>
                        }
                      />
                    </div>
                  </div>
                );
              }
              return null;
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

export default WorkSectionGroup;
