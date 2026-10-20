import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Input, Modal } from "antd";
import type {
  McpAuthEventPayload,
  McpAuthTarget,
} from "../../../../shared/customizations";
import { useMessage } from "@renderer/services/feedback";
import { useI18n } from "@renderer/i18n/use-i18n";
import styles from "./McpLoginModal.module.css";

type Props = {
  show: boolean;
  target: McpAuthTarget | null;
  onClose?: () => void;
  onChanged?: () => void;
};

export function McpLoginModal({ show, target, onClose, onChanged }: Props): ReactNode {
  const message = useMessage();
  const t = useI18n();

  const [running, setRunning] = useState(false);
  const [info, setInfo] = useState("");
  const [authUrl, setAuthUrl] = useState("");
  const [errorText, setErrorText] = useState("");
  const [promptId, setPromptId] = useState<number | null>(null);
  const [promptValue, setPromptValue] = useState("");

  const targetRef = useRef(target);
  const runningRef = useRef(false);
  const cancelledRef = useRef(false);

  useEffect(() => {
    targetRef.current = target;
  }, [target]);

  function setRunningState(next: boolean): void {
    runningRef.current = next;
    setRunning(next);
  }

  function reset(): void {
    setInfo("");
    setAuthUrl("");
    setErrorText("");
    setPromptId(null);
    setPromptValue("");
  }

  function handleEvent(payload: McpAuthEventPayload): void {
    const current = targetRef.current;
    if (!current || !runningRef.current) return;
    if (payload.name !== current.name || payload.scope !== current.scope) return;
    const event = payload.event;
    if (event.type === "info") {
      setInfo(event.message);
    } else if (event.type === "auth_url") {
      setAuthUrl(event.url);
    } else if (event.type === "prompt") {
      setPromptId(event.promptId);
      setPromptValue("");
    }
  }

  async function start(): Promise<void> {
    const current = target;
    if (!current) return;
    if (runningRef.current) return;
    setRunningState(true);
    cancelledRef.current = false;
    reset();
    try {
      await window.api.customizations.mcpLogin(current);
      message.success(t.customizeMcpSignInSuccess);
      onChanged?.();
      onClose?.();
    } catch (err) {
      if (!cancelledRef.current) {
        setErrorText(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setRunningState(false);
    }
  }

  async function cancel(): Promise<void> {
    cancelledRef.current = true;
    await window.api.customizations.mcpLoginCancel().catch(() => {});
    onClose?.();
  }

  async function submitPrompt(): Promise<void> {
    const current = targetRef.current;
    const id = promptId;
    if (!current || id === null) return;
    const value = promptValue.trim();
    if (!value) return;
    setPromptId(null);
    await window.api.customizations.mcpAuthPrompt({
      name: current.name,
      scope: current.scope,
      promptId: id,
      value,
    });
  }

  async function copyUrl(): Promise<void> {
    if (!authUrl) return;
    try {
      await navigator.clipboard.writeText(authUrl);
      message.success(t.customizeMcpCopied);
    } catch {
      // 剪贴板不可用时地址仍可手动复制
    }
  }

  useEffect(() => {
    const unsubscribe = window.api.customizations.onMcpAuthEvent((payload) =>
      handleEvent(payload),
    );
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (show) void start();
  }, [show]);

  return (
    <Modal
      open={show}
      className="pi-settings-modal"
      width="min(520px, 94vw)"
      mask={{ closable: false }}
      onCancel={() => onClose?.()}
      title={
        <div className={styles.modalTitleBlock}>
          <div className={styles.modalTitle}>
            {target ? t.customizeMcpSignInTitle(target.name) : t.customizeMcpSignIn}
          </div>
        </div>
      }
      footer={
        <div className={styles.modalFooter}>
          <Button size="small" onClick={() => void cancel()}>
            {t.cancel}
          </Button>
        </div>
      }
    >
      <div className={styles.body}>
        {info ? (
          <div className={styles.loginInfo}>{info}</div>
        ) : running ? (
          <div className={styles.loginInfo}>{t.customizeMcpSignInWaiting}</div>
        ) : null}

        {authUrl ? (
          <div className={styles.loginUrlBlock}>
            <div className={styles.loginUrl}>{authUrl}</div>
            <Button size="small" type="default" onClick={() => void copyUrl()}>
              {t.customizeMcpCopyUrl}
            </Button>
          </div>
        ) : null}

        {promptId !== null ? (
          <>
            <div className={styles.loginHint}>{t.customizeMcpSignInBrowserHint}</div>
            <div className={styles.loginPrompt}>
              <Input
                value={promptValue}
                size="small"
                placeholder={t.customizeMcpRedirectPlaceholder}
                onChange={(event) => setPromptValue(event.target.value)}
                onPressEnter={() => void submitPrompt()}
              />
              <Button
                size="small"
                type="primary"
                disabled={!promptValue.trim()}
                onClick={() => void submitPrompt()}
              >
                {t.customizeMcpSubmit}
              </Button>
            </div>
          </>
        ) : null}

        {errorText ? (
          <div className={styles.loginError}>{t.customizeMcpSignInFailed(errorText)}</div>
        ) : null}
      </div>
    </Modal>
  );
}

export default McpLoginModal;
