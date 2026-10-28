import { useState, type ReactNode } from "react";
import { Button } from "antd";
import CodiconIcon from "@renderer/components/icons/CodiconIcon";
import type { PermissionDecision } from "../../../shared/permissions";
import { useI18n } from "@renderer/i18n/use-i18n";
import { useChatStore } from "@renderer/stores/chat";
import { useMessage } from "@renderer/services/feedback";
import styles from "./PermissionStrip.module.css";

/** 工具调用审批条：命令 / 写文件卡住等用户在会话里选。 */
export function PermissionStrip(): ReactNode {
  const t = useI18n();
  const chat = useChatStore();
  const message = useMessage();
  const [busy, setBusy] = useState(false);

  const prompt = chat.activePendingPermission;
  if (!prompt) return null;

  const categoryLabel =
    prompt.category === "write" ? t.permissionCategoryWrite : t.permissionCategoryBash;

  async function reply(decision: PermissionDecision): Promise<void> {
    if (!prompt || busy) return;
    setBusy(true);
    try {
      await chat.replyPermission({ requestId: prompt.requestId, decision });
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.permissionWrap}>
      <div className={styles.permissionCard} role="dialog" aria-label={t.permissionTitle}>
        <header className={styles.stripHead}>
          <span className={styles.headBadge} aria-hidden="true">
            <CodiconIcon name="security" size={14} />
          </span>
          <span className={styles.headText}>
            <span className={styles.headTitle}>{t.permissionTitle}</span>
            <span className={styles.headSub}>
              {t.permissionToolLine(prompt.toolName, categoryLabel)}
            </span>
          </span>
        </header>

        <div className={styles.stripBody}>
          <pre className={styles.summary}>{prompt.summary}</pre>
          {prompt.danger ? <p className={styles.danger}>{t.permissionDangerHint}</p> : null}
        </div>

        <footer className={styles.stripFoot}>
          <Button
            type="text"
            shape="round"
            size="small"
            className={`pi-interactive ${styles.denyBtn}`}
            disabled={busy}
            onClick={() => void reply("deny")}
          >
            {t.permissionDeny}
          </Button>
          <div className={styles.footActions}>
            <Button
              shape="round"
              size="small"
              className="pi-interactive"
              disabled={busy}
              onClick={() => void reply("allow_once")}
            >
              {t.permissionAllowOnce}
            </Button>
            <Button
              type="primary"
              shape="round"
              size="small"
              className="pi-interactive"
              loading={busy}
              onClick={() => void reply("allow_session_category")}
            >
              {t.permissionAllowSession}
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}

export default PermissionStrip;
