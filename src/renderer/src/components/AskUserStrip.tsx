import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type ReactNode,
} from "react";
import { Button, Input } from "antd";
import {
  ChatbubbleEllipsesOutline,
  CheckmarkCircle,
  ChevronDownOutline,
  ChevronForwardOutline,
  CloseOutline,
} from "@renderer/components/icons/ionicons";
import type {
  AskUserAnswerDraft,
  AskUserAttachment,
  AskUserQuestion,
  AskUserValidationError,
} from "../../../shared/ask-user";
import {
  ASK_USER_CUSTOM_OPTION_ID,
  formatAskUserAnswers,
  questionSkippable,
  validateAskUserAnswers,
  validateAskUserQuestionAnswer,
} from "../../../shared/ask-user";
import { useI18n } from "@renderer/i18n/use-i18n";
import { useChatStore } from "@renderer/stores/chat";
import { useMessage } from "@renderer/services/feedback";
import styles from "./AskUserStrip.module.css";

/** 单张图片上限：附件会跟着 tool 结果进入上下文与会话文件。 */
const IMAGE_MAX_BYTES = 4 * 1024 * 1024;
const MAX_ATTACHMENTS = 6;

function attachmentId(): string {
  return `att-${Math.random().toString(36).slice(2, 10)}`;
}

function readFileAsDataUrl(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}
/** tab 标签：最多 4 个字，过长或没给 title 时用题干截断。 */
const TAB_LABEL_MAX = 4;

function tabLabel(title: string | undefined, prompt: string): string {
  const raw = (title ?? "").trim() || prompt.trim();
  return raw.length > TAB_LABEL_MAX ? raw.slice(0, TAB_LABEL_MAX) : raw;
}

export function AskUserStrip(): ReactNode {
  const t = useI18n();
  const chat = useChatStore();
  const message = useMessage();

  const [draft, setDraft] = useState<AskUserAnswerDraft>({});
  const [attachments, setAttachments] = useState<AskUserAttachment[]>([]);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const [dragging, setDragging] = useState(false);

  const prompt = chat.activePendingAskUser;
  const questions = prompt?.questions ?? [];
  const total = questions.length;
  const currentQuestion = questions[currentIndex] ?? null;
  const isLast = currentIndex >= total - 1;

  useEffect(() => {
    const store = useChatStore.getState();
    const p = store.activePendingAskUser;
    setValidationError(null);
    setConfirming(false);
    setCollapsed(false);
    setDragging(false);
    if (!p) {
      setCurrentIndex(0);
      setDraft({});
      setAttachments([]);
      return;
    }
    const savedStep = p.requestId ? store.readAskStep(p.requestId) : null;
    setCurrentIndex(
      Math.max(0, Math.min(savedStep ?? 0, p.questions.length - 1)),
    );
    setAttachments(p.requestId ? store.readAskAttachments(p.requestId) : []);
    const saved = p.requestId ? store.readAskDraft(p.requestId) : null;
    const next: AskUserAnswerDraft = {};
    for (const q of p.questions) {
      const row = saved?.[q.id];
      const optionIds = Array.isArray(row?.optionIds)
        ? row.optionIds.filter(
            (id): id is string =>
              typeof id === "string" && q.options.some((o) => o.id === id),
          )
        : [];
      next[q.id] = {
        optionIds,
        customText: typeof row?.customText === "string" ? row.customText : "",
        skipped: row?.skipped === true && optionIds.length === 0,
      };
    }
    setDraft(next);
  }, [prompt]);

  const draftReady = useRef(false);
  useEffect(() => {
    if (!draftReady.current) {
      draftReady.current = true;
      return;
    }
    setValidationError(null);
    const store = useChatStore.getState();
    const p = store.activePendingAskUser;
    if (p?.requestId) store.writeAskDraft(p.requestId, draft);
  }, [draft]);

  const attachReady = useRef(false);
  useEffect(() => {
    if (!attachReady.current) {
      attachReady.current = true;
      return;
    }
    const store = useChatStore.getState();
    const p = store.activePendingAskUser;
    if (p?.requestId) store.writeAskAttachments(p.requestId, attachments);
  }, [attachments]);

  const persistStep = useCallback((step: number): void => {
    const store = useChatStore.getState();
    const p = store.activePendingAskUser;
    if (p?.requestId) store.writeAskStep(p.requestId, step);
  }, []);

  const selectStep = useCallback(
    (index: number): void => {
      setValidationError(null);
      setCurrentIndex(index);
      persistStep(index);
    },
    [persistStep],
  );

  const toggleCollapsed = useCallback((): void => {
    setCollapsed((prev) => !prev);
  }, []);

  const optionLabel = useCallback(
    (opt: { id: string; label: string }): string =>
      opt.id === ASK_USER_CUSTOM_OPTION_ID ? t.askUserCustomOption : opt.label,
    [t],
  );

  const isSelected = useCallback(
    (q: AskUserQuestion, optionId: string): boolean =>
      (draft[q.id]?.optionIds ?? []).includes(optionId),
    [draft],
  );

  const isSkipped = useCallback(
    (q: AskUserQuestion): boolean => Boolean(draft[q.id]?.skipped),
    [draft],
  );

  const isAnswered = useCallback(
    (q: AskUserQuestion): boolean => {
      const row = draft[q.id];
      if (!row) return false;
      return (
        row.skipped || row.optionIds.length > 0 || Boolean(row.customText.trim())
      );
    },
    [draft],
  );

  const toggleOption = useCallback(
    (q: AskUserQuestion, optionId: string): void => {
      setDraft((prev) => {
        const row = prev[q.id];
        if (!row) return prev;
        if (q.type === "multi") {
          const set = new Set(row.optionIds);
          if (set.has(optionId)) set.delete(optionId);
          else set.add(optionId);
          return {
            ...prev,
            [q.id]: { ...row, skipped: false, optionIds: [...set] },
          };
        }
        return {
          ...prev,
          [q.id]: { ...row, skipped: false, optionIds: [optionId] },
        };
      });
    },
    [],
  );

  const setCustom = useCallback((q: AskUserQuestion, text: string): void => {
    setDraft((prev) => {
      const row = prev[q.id];
      if (!row) return prev;
      return { ...prev, [q.id]: { ...row, customText: text, skipped: false } };
    });
  }, []);

  const skipCurrentQuestion = useCallback((): void => {
    const q = currentQuestion;
    if (!q) return;
    setDraft((prev) => {
      const row = prev[q.id];
      if (!row) return prev;
      return {
        ...prev,
        [q.id]: { ...row, skipped: true, optionIds: [], customText: "" },
      };
    });
    setValidationError(null);
    if (!isLast) selectStep(currentIndex + 1);
  }, [currentIndex, currentQuestion, isLast, selectStep]);

  const addImages = useCallback(
    async (files: File[]): Promise<void> => {
      const next: AskUserAttachment[] = [];
      for (const file of files) {
        if (file.size > IMAGE_MAX_BYTES) {
          message.warning(t.askUserAttachmentTooLarge);
          continue;
        }
        const dataUrl = await readFileAsDataUrl(file);
        if (!dataUrl) continue;
        next.push({
          id: attachmentId(),
          name: file.name || "image",
          dataUrl,
        });
      }
      if (!next.length) return;
      setAttachments((prev) => [...prev, ...next].slice(0, MAX_ATTACHMENTS));
    },
    [message, t],
  );

  const removeAttachment = useCallback((id: string): void => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const onPaste = useCallback(
    (event: ClipboardEvent<HTMLDivElement>): void => {
      const files = Array.from(event.clipboardData?.files ?? []).filter((f) =>
        f.type.startsWith("image/"),
      );
      if (!files.length) return;
      event.preventDefault();
      void addImages(files);
    },
    [addImages],
  );

  const onDragOver = useCallback((event: DragEvent<HTMLDivElement>): void => {
    const items = Array.from(event.dataTransfer?.items ?? []);
    const hasImage = items.some(
      (item) => item.kind === "file" && item.type.startsWith("image/"),
    );
    if (!hasImage) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDragging(true);
  }, []);

  const onDragLeave = useCallback((event: DragEvent<HTMLDivElement>): void => {
    const next = event.relatedTarget as Node | null;
    if (next && event.currentTarget.contains(next)) return;
    setDragging(false);
  }, []);

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>): void => {
      setDragging(false);
      const files = Array.from(event.dataTransfer?.files ?? []).filter((f) =>
        f.type.startsWith("image/"),
      );
      if (!files.length) return;
      event.preventDefault();
      void addImages(files);
    },
    [addImages],
  );

  const errorText = useCallback(
    (code: string): string => {
      switch (code as AskUserValidationError) {
        case "missing-answer":
          return t.askUserErrMissingAnswer;
        case "cannot-skip":
          return t.askUserErrCannotSkip;
        case "select-one":
          return t.askUserErrSelectOne;
        case "invalid-option":
          return t.askUserErrInvalidOption;
        case "custom-required":
          return t.askUserErrCustomRequired;
        default:
          return code;
      }
    },
    [t],
  );

  const goNext = useCallback((): void => {
    const q = currentQuestion;
    if (!q) return;
    const err = validateAskUserQuestionAnswer(q, draft);
    if (err) {
      setValidationError(err);
      return;
    }
    setValidationError(null);
    if (!isLast) selectStep(currentIndex + 1);
  }, [currentIndex, currentQuestion, draft, isLast, selectStep]);

  const onConfirm = useCallback(async (): Promise<void> => {
    const store = useChatStore.getState();
    const p = store.activePendingAskUser;
    if (!p?.requestId || confirming) return;
    const stepErr = currentQuestion
      ? validateAskUserQuestionAnswer(currentQuestion, draft)
      : null;
    if (stepErr) {
      setValidationError(stepErr);
      return;
    }
    const err = validateAskUserAnswers(p, draft);
    if (err) {
      setValidationError(err);
      const idx = p.questions.findIndex(
        (q) => validateAskUserQuestionAnswer(q, draft) != null,
      );
      if (idx >= 0) selectStep(idx);
      return;
    }
    setValidationError(null);
    setConfirming(true);
    try {
      const images = attachments.map((a) => a.dataUrl);
      await store.replyAskUser({
        requestId: p.requestId,
        answersText: formatAskUserAnswers(p, draft),
        ...(images.length ? { images } : {}),
      });
    } catch (err) {
      setValidationError(err instanceof Error ? err.message : String(err));
    } finally {
      setConfirming(false);
    }
  }, [attachments, confirming, currentQuestion, draft, selectStep]);

  /** Copilot-style "dismiss": cancel the pending ask and stop the blocked turn. */
  const onCancelAsk = useCallback((): void => {
    const p = useChatStore.getState().activePendingAskUser;
    if (!p?.sessionId) return;
    void useChatStore.getState().abort(p.sessionId);
  }, []);

  if (!prompt || !currentQuestion) return null;

  const skipped = isSkipped(currentQuestion);
  const customText = draft[currentQuestion.id]?.customText ?? "";

  return (
    <div
      className={styles.askUserWrap}
      onPaste={onPaste}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div
        className={`${styles.askUserCard} ${dragging ? styles.dragging : ""}`}
        role="dialog"
        aria-label={t.askUserToolLabel}
      >
        <header className={styles.stripHead}>
          <button
            type="button"
            className={`pi-interactive ${styles.headToggle}`}
            aria-expanded={!collapsed}
            onClick={toggleCollapsed}
          >
            <span className={styles.headBadge} aria-hidden="true">
              <ChatbubbleEllipsesOutline size={14} />
            </span>
            <span className={styles.headTitle}>{t.askUserToolLabel}</span>
          </button>
          {total > 1 ? (
            <div className={styles.tabs} role="tablist">
              {questions.map((q, index) => (
                <button
                  key={q.id}
                  type="button"
                  role="tab"
                  aria-selected={index === currentIndex}
                  className={`pi-interactive ${styles.tab} ${index === currentIndex ? styles.tabActive : ""}`}
                  onClick={() => selectStep(index)}
                >
                  <span className={styles.tabText}>
                    {tabLabel(q.title, q.prompt)}
                  </span>
                  {isAnswered(q) ? (
                    <span className={styles.tabMark} aria-hidden="true" />
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}
          <button
            type="button"
            className={`pi-interactive ${styles.chevBtn}`}
            aria-label={collapsed ? t.askUserExpand : t.askUserCollapse}
            onClick={toggleCollapsed}
          >
            {collapsed ? (
              <ChevronForwardOutline size={14} />
            ) : (
              <ChevronDownOutline size={14} />
            )}
          </button>
        </header>

        {collapsed ? null : (
          <>
            <div className={styles.stripBody}>
              <div className={styles.qPrompt}>
                <span className={styles.qText}>{currentQuestion.prompt}</span>
                {skipped ? (
                  <span className={styles.skipTag}>{t.askUserSkipped}</span>
                ) : null}
              </div>

              <div className={`${styles.optList} ${skipped ? styles.optDim : ""}`}>
                {currentQuestion.options.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    className={`pi-interactive ${styles.optRow} ${
                      isSelected(currentQuestion, opt.id) ? styles.selected : ""
                    }`}
                    onClick={() => toggleOption(currentQuestion, opt.id)}
                  >
                    <span className={styles.optCheck} aria-hidden="true">
                      {isSelected(currentQuestion, opt.id) ? (
                        <CheckmarkCircle size={18} />
                      ) : (
                        <span
                          className={`${styles.optRing} ${currentQuestion.type === "multi" ? styles.multi : ""}`}
                        />
                      )}
                    </span>
                    <span className={styles.optText}>
                      <span className={styles.optLabel}>{optionLabel(opt)}</span>
                      {opt.description ? (
                        <span className={styles.optDesc}>{opt.description}</span>
                      ) : null}
                    </span>
                  </button>
                ))}
              </div>

              <Input.TextArea
                className={styles.customInput}
                value={customText}
                placeholder={t.askUserCustomPlaceholder}
                disabled={skipped || confirming}
                autoSize={{ minRows: 1, maxRows: 5 }}
                onChange={(event) => setCustom(currentQuestion, event.target.value)}
              />

              {attachments.length ? (
                <div className={styles.attachList}>
                  {attachments.map((att) => (
                    <span key={att.id} className={styles.attachChip}>
                      <img
                        className={styles.attachThumb}
                        src={att.dataUrl}
                        alt={att.name}
                      />
                      <button
                        type="button"
                        className={`pi-interactive ${styles.attachRemove}`}
                        aria-label={t.askUserAttachmentRemove}
                        onClick={() => removeAttachment(att.id)}
                      >
                        <CloseOutline size={12} />
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}
            </div>

            <footer className={styles.stripFoot}>
              <div className={styles.footLeft}>
                <Button
                  type="text"
                  shape="round"
                  size="small"
                  className={`pi-interactive ${styles.cancelBtn}`}
                  disabled={confirming}
                  onClick={onCancelAsk}
                >
                  {t.cancel}
                </Button>
                {validationError ? (
                  <span className={styles.err}>{errorText(validationError)}</span>
                ) : null}
              </div>
              <div className={styles.footActions}>
                {questionSkippable(currentQuestion) ? (
                  <Button
                    type="text"
                    shape="round"
                    className={`pi-interactive ${styles.skipBtn}`}
                    disabled={confirming}
                    onClick={skipCurrentQuestion}
                  >
                    {t.askUserSkip}
                  </Button>
                ) : null}
                {!isLast ? (
                  <Button
                    type="primary"
                    shape="round"
                    className="pi-interactive"
                    disabled={confirming}
                    onClick={goNext}
                  >
                    {t.askUserNext}
                  </Button>
                ) : (
                  <Button
                    type="primary"
                    shape="round"
                    className={`pi-interactive ${styles.confirmBtn}`}
                    loading={confirming}
                    onClick={() => void onConfirm()}
                  >
                    {t.askUserConfirm}
                  </Button>
                )}
              </div>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}

export default AskUserStrip;
