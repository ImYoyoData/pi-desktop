import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Button, Input, Typography } from "antd";
import {
  ChatbubbleEllipsesOutline,
  CheckmarkCircle,
  ChevronDownOutline,
  ChevronForwardOutline,
} from "@renderer/components/icons/ionicons";
import type {
  AskUserAnswerDraft,
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
import styles from "./AskUserStrip.module.css";

type CustomInputMode = "none" | "required" | "optional";

export function AskUserStrip(): ReactNode {
  const t = useI18n();
  const chat = useChatStore();

  const [draft, setDraft] = useState<AskUserAnswerDraft>({});
  const [validationError, setValidationError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [collapsed, setCollapsed] = useState(false);

  const prompt = chat.activePendingAskUser;
  const questions = prompt?.questions ?? [];
  const total = questions.length;
  const currentQuestion = questions[currentIndex] ?? null;
  const isFirst = currentIndex <= 0;
  const isLast = currentIndex >= total - 1;

  useEffect(() => {
    const store = useChatStore.getState();
    const p = store.activePendingAskUser;
    setValidationError(null);
    setConfirming(false);
    setCollapsed(false);
    if (!p) {
      setCurrentIndex(0);
      setDraft({});
      return;
    }
    const savedStep = p.requestId ? store.readAskStep(p.requestId) : null;
    setCurrentIndex(
      Math.max(0, Math.min(savedStep ?? 0, p.questions.length - 1)),
    );
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

  const persistStep = useCallback((step: number): void => {
    const store = useChatStore.getState();
    const p = store.activePendingAskUser;
    if (p?.requestId) store.writeAskStep(p.requestId, step);
  }, []);

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

  const toggleOption = useCallback(
    (q: AskUserQuestion, optionId: string): void => {
      setDraft((prev) => {
        const row = prev[q.id];
        if (!row) return prev;
        // Selecting a real option un-skips the question.
        if (q.type === "multi") {
          const set = new Set(row.optionIds);
          if (set.has(optionId)) set.delete(optionId);
          else set.add(optionId);
          return { ...prev, [q.id]: { ...row, skipped: false, optionIds: [...set] } };
        }
        return { ...prev, [q.id]: { ...row, skipped: false, optionIds: [optionId] } };
      });
    },
    [],
  );

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
    // Advance past skipped questions when possible.
    const nextIndex = isLast ? currentIndex : currentIndex + 1;
    if (!isLast) setCurrentIndex(nextIndex);
    persistStep(nextIndex);
  }, [currentIndex, currentQuestion, isLast, persistStep]);

  const customModel = useCallback(
    (q: AskUserQuestion): string => draft[q.id]?.customText ?? "",
    [draft],
  );

  const setCustom = useCallback((q: AskUserQuestion, text: string): void => {
    setDraft((prev) => {
      const row = prev[q.id];
      if (!row) return prev;
      return { ...prev, [q.id]: { ...row, customText: text } };
    });
  }, []);

  const customInputMode = useCallback(
    (q: AskUserQuestion): CustomInputMode => {
      const row = draft[q.id];
      if (!row) return "none";
      const selected = q.options.filter((o) => row.optionIds.includes(o.id));
      if (selected.some((o) => o.id === ASK_USER_CUSTOM_OPTION_ID)) return "required";
      return selected.some((o) => o.allowCustom) ? "optional" : "none";
    },
    [draft],
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

  const goPrev = useCallback((): void => {
    if (isFirst) return;
    setValidationError(null);
    const nextIndex = currentIndex - 1;
    setCurrentIndex(nextIndex);
    persistStep(nextIndex);
  }, [currentIndex, isFirst, persistStep]);

  const goNext = useCallback((): void => {
    const q = currentQuestion;
    if (!q) return;
    const err = validateAskUserQuestionAnswer(q, draft);
    if (err) {
      setValidationError(err);
      return;
    }
    setValidationError(null);
    const nextIndex = isLast ? currentIndex : currentIndex + 1;
    if (!isLast) setCurrentIndex(nextIndex);
    persistStep(nextIndex);
  }, [currentIndex, currentQuestion, draft, isLast, persistStep]);

  const onConfirm = useCallback(async (): Promise<void> => {
    const store = useChatStore.getState();
    const p = store.activePendingAskUser;
    if (!p?.requestId || confirming) return;
    // Validate current step first, then all questions before publishing.
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
      // Jump to first incomplete question if possible.
      const idx = p.questions.findIndex(
        (q) => validateAskUserQuestionAnswer(q, draft) != null,
      );
      const nextIndex = idx >= 0 ? idx : currentIndex;
      if (idx >= 0) setCurrentIndex(nextIndex);
      persistStep(nextIndex);
      return;
    }
    setValidationError(null);
    setConfirming(true);
    try {
      const answersText = formatAskUserAnswers(p, draft);
      await store.replyAskUser({
        requestId: p.requestId,
        answersText,
      });
    } catch (err) {
      setValidationError(err instanceof Error ? err.message : String(err));
    } finally {
      setConfirming(false);
    }
  }, [confirming, currentIndex, currentQuestion, draft, persistStep]);

  /** Copilot-style "dismiss": cancel the pending ask and stop the blocked turn. */
  const onCancelAsk = useCallback((): void => {
    const p = useChatStore.getState().activePendingAskUser;
    if (!p?.sessionId) return;
    void useChatStore.getState().abort(p.sessionId);
  }, []);

  if (!prompt || !currentQuestion) return null;

  const progressLabel =
    total > 0 ? t.askUserProgress(currentIndex + 1, total) : "";
  const inputMode = customInputMode(currentQuestion);
  const skipped = isSkipped(currentQuestion);

  return (
    <div className={styles.askUserWrap}>
      <div
        className={styles.askUserCard}
        role="dialog"
        aria-label={t.askUserToolLabel}
      >
        <header className={`${styles.stripHead} ${collapsed ? styles.folded : ""}`}>
          <button
            type="button"
            className={`pi-interactive ${styles.headToggle}`}
            aria-expanded={!collapsed}
            aria-label={collapsed ? t.askUserExpand : t.askUserCollapse}
            onClick={toggleCollapsed}
          >
            <span className={styles.headBadge} aria-hidden="true">
              <ChatbubbleEllipsesOutline size={14} />
            </span>
            <span className={styles.headText}>
              <span className={styles.headTitle}>{t.askUserToolLabel}</span>
              <span className={styles.headSub}>{t.askUserTitle}</span>
            </span>
            {total > 1 ? (
              <span className={styles.headProgress} title={progressLabel}>
                {progressLabel}
              </span>
            ) : null}
            {collapsed ? (
              <ChevronForwardOutline className={styles.headChev} size={14} />
            ) : (
              <ChevronDownOutline className={styles.headChev} size={14} />
            )}
          </button>
        </header>

        <div className={`${styles.stripBody} ${collapsed ? styles.hidden : ""}`}>
          <section className={styles.question}>
            <div className={styles.qPrompt}>
              <Typography.Text strong className={styles.qText}>
                {currentQuestion.prompt}
              </Typography.Text>
              {skipped ? (
                <span className={styles.skipTag}>{t.askUserSkipped}</span>
              ) : null}
            </div>

            <div
              className={`${styles.optGrid} ${currentQuestion.type === "buttons" ? styles.optGridWrap : ""} ${skipped ? styles.optGridDim : ""}`}
            >
              {currentQuestion.options.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className={`pi-interactive ${styles.optChip} ${isSelected(currentQuestion, opt.id) ? styles.selected : ""} ${currentQuestion.type === "buttons" ? styles.compact : ""}`}
                  onClick={() => toggleOption(currentQuestion, opt.id)}
                >
                  <span className={styles.optCheck} aria-hidden="true">
                    {isSelected(currentQuestion, opt.id) ? (
                      <CheckmarkCircle size={16} />
                    ) : (
                      <span
                        className={`${styles.optRing} ${currentQuestion.type === "multi" ? styles.multi : ""}`}
                      />
                    )}
                  </span>
                  <span className={styles.optLabel}>{optionLabel(opt)}</span>
                </button>
              ))}
            </div>

            {inputMode !== "none" && !skipped ? (
              <Input.TextArea
                className={styles.customInput}
                value={customModel(currentQuestion)}
                placeholder={
                  inputMode === "required"
                    ? t.askUserCustomPlaceholder
                    : t.askUserCustomOptionalPlaceholder
                }
                autoSize={{ minRows: 2, maxRows: 4 }}
                onChange={(event) => setCustom(currentQuestion, event.target.value)}
              />
            ) : null}
          </section>
        </div>

        <footer className={`${styles.stripFoot} ${collapsed ? styles.hidden : ""}`}>
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
              <Typography.Text type="danger" className={styles.err}>
                {errorText(validationError)}
              </Typography.Text>
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
            {total > 1 ? (
              <Button
                type="text"
                shape="round"
                className="pi-interactive"
                disabled={isFirst || confirming}
                onClick={goPrev}
              >
                {t.askUserPrev}
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
      </div>
    </div>
  );
}

export default AskUserStrip;
