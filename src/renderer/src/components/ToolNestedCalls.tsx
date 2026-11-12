import { useState, type ReactNode } from "react";
import { Button } from "antd";
import {
 CheckmarkCircleOutline,
 ChevronForwardOutline,
 CloseCircleOutline,
 EllipseOutline,
} from "@renderer/components/icons/ionicons";
import type { ChatToolNestedCall } from "@renderer/stores/chat-reducer";
import { isBashTool, toolCardForNested } from "@renderer/utils/tool-diff";
import { resolveXdevToolCall } from "@renderer/utils/tool-xdev";
import { toolCommandFromArgs } from "@renderer/utils/tool-args";
import { genericStepTarget } from "@renderer/utils/structured-text";
import { formatDuration } from "@renderer/utils/format-duration";
import { useI18n } from "@renderer/i18n/use-i18n";
import { useAgentRunsStore } from "@renderer/stores/agent-runs";
import { useSessionsStore } from "@renderer/stores/sessions";
import { useMessage } from "@renderer/services/feedback";
import ToolBody from "@renderer/components/ToolBody";
import ToolJsonTree from "@renderer/components/ToolJsonTree";
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
 const message = useMessage();
 const agentRuns = useAgentRunsStore();
 const sessionId = useSessionsStore((state) => state.activeId);
 const [openId, setOpenId] = useState<string | null>(null);
 const [busyId, setBusyId] = useState<string | null>(null);

 if (!calls.length) return null;

 /** 嵌套的 bash 调用同样在运行面板里有 run，可以甩到后台。 */
 function blockingRunIdFor(call: ChatToolNestedCall): string | null {
  if (!sessionId || !call.streaming || !isBashTool(call.toolName)) return null;
  const command = toolCommandFromArgs(call.args);
  if (!command) return null;
  return agentRuns.findBlockingRun(sessionId, command)?.id ?? null;
 }

 async function moveToBackground(runId: string): Promise<void> {
  if (busyId) return;
  setBusyId(runId);
  try {
   await agentRuns.background(runId);
   message.success(t.toolBackgrounded);
  } catch (err) {
   message.error(err instanceof Error ? err.message : t.toolBackgroundFailed);
  } finally {
   setBusyId(null);
  }
 }

 return (
  <div
   className={styles.nestedList}
   onClick={(event) => event.stopPropagation()}
  >
   {calls.map((call) => {
    const device = resolveXdevToolCall(call.toolName, call.args, call.result ?? null);
    const displayName = device?.toolName ?? call.toolName;
    const target = genericStepTarget(device?.args ?? call.args);
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
    const runId = blockingRunIdFor(call);
    return (
     <div key={call.toolCallId} className={styles.nestedItem}>
      <div className={styles.nestedHead}>
       <button
        type="button"
        className={styles.nestedHeadMain}
        aria-expanded={open}
        onClick={() => {
         if (canOpen) setOpenId(open ? null : call.toolCallId);
        }}
       >
        <Icon
         size={11}
         className={`${styles.nestedMark}${markClass ? ` ${markClass}` : ""}`}
        />
        <span className={styles.nestedName}>{displayName}</span>
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
       {runId ? (
        <Button
         size="small"
         className={styles.nestedBgBtn}
         loading={busyId === runId}
         title={t.toolMoveToBackground}
         onClick={(event) => {
          event.stopPropagation();
          void moveToBackground(runId);
         }}
        >
         {t.toolMoveToBackground}
        </Button>
       ) : null}
      </div>
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
           toolName={displayName}
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
