import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Button, Input, Typography } from "antd";
import {
  CheckmarkOutline,
  CloseOutline,
  ExtensionPuzzleOutline,
} from "@renderer/components/icons/ionicons";
import type {
  ExtensionUiPending,
  ExtensionUiReply,
} from "../../../shared/extension-ui";
import { useI18n } from "@renderer/i18n/use-i18n";
import { useChatStore } from "@renderer/stores/chat";
import styles from "./ExtensionUiStrip.module.css";

export function ExtensionUiStrip(): ReactNode {
  const t = useI18n();
  const chat = useChatStore();
  const [replying, setReplying] = useState(false);
  const [textDraft, setTextDraft] = useState("");
  const [selectedOption, setSelectedOption] = useState<string | null>(null);

  const prompt = chat.activePendingExtensionUi;

  useEffect(() => {
    const p = useChatStore.getState().activePendingExtensionUi;
    setReplying(false);
    setSelectedOption(null);
    if (p?.method === "input") {
      setTextDraft("");
    } else if (p?.method === "editor") {
      setTextDraft(p.prefill ?? "");
    } else {
      setTextDraft("");
    }
  }, [prompt]);

  const reply = useCallback(async (body: ExtensionUiReply): Promise<void> => {
    if (replying) return;
    setReplying(true);
    try {
      await useChatStore.getState().replyExtensionUi(body);
    } finally {
      setReplying(false);
    }
  }, [replying]);

  const onCancel = useCallback(
    async (p: ExtensionUiPending): Promise<void> => {
      await reply({ requestId: p.requestId, cancelled: true });
    },
    [reply],
  );

  const onConfirmYes = useCallback(
    async (
      p: Extract<ExtensionUiPending, { method: "confirm" }>,
    ): Promise<void> => {
      await reply({ requestId: p.requestId, confirmed: true });
    },
    [reply],
  );

  const onConfirmNo = useCallback(
    async (
      p: Extract<ExtensionUiPending, { method: "confirm" }>,
    ): Promise<void> => {
      await reply({ requestId: p.requestId, confirmed: false });
    },
    [reply],
  );

  const onSelect = useCallback(
    async (
      p: Extract<ExtensionUiPending, { method: "select" }>,
      value: string,
    ): Promise<void> => {
      setSelectedOption(value);
      await reply({ requestId: p.requestId, value });
    },
    [reply],
  );

  const onSubmitText = useCallback(
    async (p: ExtensionUiPending | null): Promise<void> => {
      if (!p || (p.method !== "input" && p.method !== "editor")) return;
      const value = textDraft;
      await reply({ requestId: p.requestId, value });
    },
    [reply, textDraft],
  );

  if (!prompt) return null;

  return (
    <div className={styles.extUiWrap}>
      <div className={styles.extUiCard} role="dialog" aria-label={t.extensionUiTitle}>
        <header className={styles.stripHead}>
          <div className={styles.headBadge} aria-hidden="true">
            <ExtensionPuzzleOutline size={16} />
          </div>
          <div className={styles.headText}>
            <div className={styles.headTitle}>{t.extensionUiTitle}</div>
            <div className={styles.headSub}>{prompt.title}</div>
          </div>
        </header>

        {prompt.method === "confirm" ? (
          <div className={styles.stripBody}>
            <Typography.Text type="secondary" className={styles.message}>
              {prompt.message}
            </Typography.Text>
            <footer className={styles.stripFoot}>
              <Button
                shape="round"
                className="pi-interactive"
                disabled={replying}
                onClick={() => void onCancel(prompt)}
              >
                {t.extensionUiCancel}
              </Button>
              <Button
                shape="round"
                className="pi-interactive"
                disabled={replying}
                onClick={() => void onConfirmNo(prompt)}
              >
                {t.extensionUiNo}
              </Button>
              <Button
                type="primary"
                shape="round"
                className="pi-interactive"
                disabled={replying}
                loading={replying}
                icon={<CheckmarkOutline />}
                onClick={() => void onConfirmYes(prompt)}
              >
                {t.extensionUiYes}
              </Button>
            </footer>
          </div>
        ) : null}

        {prompt.method === "select" ? (
          <div className={styles.stripBody}>
            <div className={styles.optList}>
              {prompt.options.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  className={`pi-interactive ${styles.optChip} ${selectedOption === opt ? styles.active : ""}`}
                  disabled={replying}
                  onClick={() => void onSelect(prompt, opt)}
                >
                  {opt}
                </button>
              ))}
            </div>
            <footer className={styles.stripFoot}>
              <Button
                shape="round"
                className="pi-interactive"
                disabled={replying}
                icon={<CloseOutline />}
                onClick={() => void onCancel(prompt)}
              >
                {t.extensionUiCancel}
              </Button>
            </footer>
          </div>
        ) : null}

        {prompt.method === "input" || prompt.method === "editor" ? (
          <div className={styles.stripBody}>
            {prompt.method === "input" ? (
              <Input
                value={textDraft}
                size="small"
                placeholder={prompt.placeholder || t.extensionUiInputPlaceholder}
                disabled={replying}
                onChange={(event) => setTextDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  void onSubmitText(prompt);
                }}
              />
            ) : (
              <Input.TextArea
                value={textDraft}
                rows={4}
                size="small"
                placeholder={t.extensionUiEditorPlaceholder}
                disabled={replying}
                onChange={(event) => setTextDraft(event.target.value)}
              />
            )}
            <footer className={styles.stripFoot}>
              <Button
                shape="round"
                className="pi-interactive"
                disabled={replying}
                onClick={() => void onCancel(prompt)}
              >
                {t.extensionUiCancel}
              </Button>
              <Button
                type="primary"
                shape="round"
                className="pi-interactive"
                disabled={replying}
                loading={replying}
                onClick={() => void onSubmitText(prompt)}
              >
                {t.extensionUiSubmit}
              </Button>
            </footer>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default ExtensionUiStrip;
