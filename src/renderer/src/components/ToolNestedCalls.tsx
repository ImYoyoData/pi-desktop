import { useState, type ReactNode } from "react";
import {
  CheckmarkCircleOutline,
  ChevronForwardOutline,
  CloseCircleOutline,
  EllipseOutline,
} from "@renderer/components/icons/ionicons";
import type { ChatToolNestedCall } from "@renderer/stores/chat-reducer";
import { toolCardForNested } from "@renderer/utils/tool-diff";
import { genericStepTarget } from "@renderer/utils/structured-text";
import { formatDuration } from "@renderer/utils/format-duration";
import { useI18n } from "@renderer/i18n/use-i18n";
import ToolBody, { ToolJsonTree } from "@renderer/components/ToolBody";
import styles from "./ToolNestedCalls.module.css";

type Props = {
  calls: ChatToolNestedCall[];
  onOpen?: (path: string) => void;
};

/**
 * 工具内部调用（codemode 脚本里发出的调用）。
 *
 * 每条都能点开：参数按 JSON 树呈现，有结果时再附上分型后的结果视图。
 */
export function ToolNestedCalls({ calls, onOpen }: Props): ReactNode {
  const t = useI18n();
  const [openId, setOpenId] = useState<string | null>(null);

  if (!calls.length) return null;

  return (
    <div
      className={styles.nestedList}
      onClick={(event) => event.stopPropagation()}
    >
      {calls.map((call) => {
        const target = genericStepTarget(call.args);
        const hasArgs = call.args != null;
        const hasResult = call.result != null;
        const hasError = Boolean(call.error);
        const canOpen = hasArgs || hasResult || hasError;
        const open = openId === call.toolCallId;
        const Icon = call.streaming
          ? EllipseOutline
          : call.isError
            ? CloseCircleOutline
            : CheckmarkCircleOutline;
        const markClass = call.streaming
          ? styles.nestedMarkRunning
          : call.isError
            ? styles.nestedMarkError
            : "";
        return (
          <div key={call.toolCallId} className={styles.nestedItem}>
            <button
              type="button"
              className={styles.nestedHead}
              aria-expanded={open}
              onClick={() => {
                if (canOpen) setOpenId(open ? null : call.toolCallId);
              }}
            >
              <Icon
                size={11}
                className={`${styles.nestedMark}${markClass ? ` ${markClass}` : ""}`}
              />
              <span className={styles.nestedName}>{call.toolName}</span>
              {target ? <span className={styles.nestedTarget}>{target}</span> : null}
              <span className={styles.nestedMeta}>
                {call.streaming
                  ? t.toolRunning
                  : call.isError
                    ? t.toolError
                    : call.durationMs != null
                      ? formatDuration(call.durationMs)
                      : ""}
              </span>
              {canOpen ? (
                <ChevronForwardOutline
                  size={11}
                  className={`${styles.nestedChev}${open ? ` ${styles.nestedChevOpen}` : ""}`}
                />
              ) : null}
            </button>
            {open ? (
              <div className={styles.nestedBody}>
                {hasArgs ? (
                  <div className={styles.nestedArgs}>
                    <div className={styles.nestedSectionTitle}>{t.toolNestedArgs}</div>
                    <ToolJsonTree value={call.args} />
                  </div>
                ) : null}
                {hasResult ? (
                  <div className={styles.nestedResult}>
                    <div className={styles.nestedSectionTitle}>{t.toolNestedResult}</div>
                    <ToolBody
                      card={toolCardForNested(call)}
                      toolName={call.toolName}
                      streaming={call.streaming}
                      isError={call.isError}
                      onOpen={onOpen}
                    />
                  </div>
                ) : null}
                {hasError ? (
                  <div className={styles.nestedError}>
                    <div className={styles.nestedSectionTitle}>{t.toolNestedError}</div>
                    <pre className={styles.nestedErrorText}>{call.error}</pre>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export default ToolNestedCalls;
