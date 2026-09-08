<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  NButton,
  NIcon,
  NText,
} from "naive-ui";
import { ChatbubbleEllipsesOutline, CheckmarkCircle } from "@vicons/ionicons5";
import type { AskUserAnswerDraft, AskUserQuestion } from "../../../shared/ask-user";
import {
  ASK_USER_CUSTOM_OPTION_ID,
  formatAskUserAnswers,
  questionSkippable,
  validateAskUserAnswers,
  validateAskUserQuestionAnswer,
} from "../../../shared/ask-user";
import { t } from "@renderer/i18n";
import { useChatStore } from "@renderer/stores/chat";
import VoiceTextField from "@renderer/components/VoiceTextField.vue";

const chat = useChatStore();

const draft = ref<AskUserAnswerDraft>({});
const validationError = ref<string | null>(null);
const confirming = ref(false);
const currentIndex = ref(0);

const prompt = computed(() => chat.activePendingAskUser);
const questions = computed(() => prompt.value?.questions ?? []);
const total = computed(() => questions.value.length);
const currentQuestion = computed(() => questions.value[currentIndex.value] ?? null);
const isFirst = computed(() => currentIndex.value <= 0);
const isLast = computed(() => currentIndex.value >= total.value - 1);

const progressLabel = computed(() => {
  if (total.value <= 0) return "";
  return t.askUserProgress(currentIndex.value + 1, total.value);
});

watch(
  prompt,
  (p) => {
    validationError.value = null;
    confirming.value = false;
    currentIndex.value = 0;
    if (!p) {
      draft.value = {};
      return;
    }
    const next: AskUserAnswerDraft = {};
    for (const q of p.questions) {
      next[q.id] = { optionIds: [], customText: "", skipped: false };
    }
    draft.value = next;
  },
  { immediate: true },
);

watch(
  draft,
  () => {
    validationError.value = null;
  },
  { deep: true },
);

function optionLabel(opt: { id: string; label: string }): string {
  if (opt.id === ASK_USER_CUSTOM_OPTION_ID) return t.askUserCustomOption;
  return opt.label;
}

function isSelected(q: AskUserQuestion, optionId: string): boolean {
  return (draft.value[q.id]?.optionIds ?? []).includes(optionId);
}

function isSkipped(q: AskUserQuestion): boolean {
  return Boolean(draft.value[q.id]?.skipped);
}

function toggleOption(q: AskUserQuestion, optionId: string): void {
  const row = draft.value[q.id];
  if (!row) return;
  // Selecting a real option un-skips the question.
  row.skipped = false;
  if (q.type === "multi") {
    const set = new Set(row.optionIds);
    if (set.has(optionId)) set.delete(optionId);
    else set.add(optionId);
    row.optionIds = [...set];
    return;
  }
  row.optionIds = [optionId];
}

function skipCurrentQuestion(): void {
  const q = currentQuestion.value;
  if (!q) return;
  const row = draft.value[q.id];
  if (!row) return;
  row.skipped = true;
  row.optionIds = [];
  row.customText = "";
  validationError.value = null;
  // Advance past skipped questions when possible.
  if (!isLast.value) currentIndex.value += 1;
}

function customModel(q: AskUserQuestion): string {
  return draft.value[q.id]?.customText ?? "";
}

function setCustom(q: AskUserQuestion, text: string): void {
  const row = draft.value[q.id];
  if (!row) return;
  row.customText = text;
}

function needsCustomInput(q: AskUserQuestion): boolean {
  const row = draft.value[q.id];
  if (!row) return false;
  const selected = q.options.filter((o) => row.optionIds.includes(o.id));
  return selected.some((o) => o.allowCustom);
}

function goPrev(): void {
  if (isFirst.value) return;
  validationError.value = null;
  currentIndex.value -= 1;
}

function goNext(): void {
  const q = currentQuestion.value;
  if (!q) return;
  const err = validateAskUserQuestionAnswer(q, draft.value);
  if (err) {
    validationError.value = err;
    return;
  }
  validationError.value = null;
  if (!isLast.value) currentIndex.value += 1;
}

async function onConfirm(): Promise<void> {
  const p = prompt.value;
  if (!p?.requestId || confirming.value) return;
  // Validate current step first, then all questions before publishing.
  const stepErr = currentQuestion.value
    ? validateAskUserQuestionAnswer(currentQuestion.value, draft.value)
    : null;
  if (stepErr) {
    validationError.value = stepErr;
    return;
  }
  const err = validateAskUserAnswers(p, draft.value);
  if (err) {
    validationError.value = err;
    // Jump to first incomplete question if possible.
    const idx = p.questions.findIndex(
      (q) => validateAskUserQuestionAnswer(q, draft.value) != null,
    );
    if (idx >= 0) currentIndex.value = idx;
    return;
  }
  validationError.value = null;
  confirming.value = true;
  try {
    const answersText = formatAskUserAnswers(p, draft.value);
    await chat.replyAskUser({
      requestId: p.requestId,
      answersText,
    });
  } finally {
    confirming.value = false;
  }
}

/** Copilot-style "dismiss": cancel the pending ask and stop the blocked turn. */
function onCancelAsk(): void {
  const p = prompt.value;
  if (!p) return;
  void chat.abort(p.sessionId);
}
</script>

<template>
  <div v-if="prompt && currentQuestion" class="ask-user-wrap">
    <div class="ask-user-card" role="dialog" :aria-label="t.askUserToolLabel">
      <header class="strip-head">
        <div class="head-badge" aria-hidden="true">
          <NIcon :component="ChatbubbleEllipsesOutline" :size="14" />
        </div>
        <div class="head-text">
          <div class="head-title">{{ t.askUserToolLabel }}</div>
          <div class="head-sub">{{ t.askUserTitle }}</div>
        </div>
        <div v-if="total > 1" class="head-progress" :title="progressLabel">
          {{ progressLabel }}
        </div>
      </header>

      <div class="strip-body">
        <section class="question">
          <div class="q-prompt">
            <NText strong class="q-text">{{ currentQuestion.prompt }}</NText>
            <span
              v-if="isSkipped(currentQuestion)"
              class="skip-tag"
            >
              {{ t.askUserSkipped }}
            </span>
          </div>

          <div
            class="opt-grid"
            :class="{
              'opt-grid-wrap': currentQuestion.type === 'buttons',
              'opt-grid-stack': currentQuestion.type !== 'buttons',
              'opt-grid-dim': isSkipped(currentQuestion),
            }"
          >
            <button
              v-for="opt in currentQuestion.options"
              :key="opt.id"
              type="button"
              class="opt-chip pi-interactive"
              :class="{
                selected: isSelected(currentQuestion, opt.id),
                compact: currentQuestion.type === 'buttons',
              }"
              @click="toggleOption(currentQuestion, opt.id)"
            >
              <span class="opt-check" aria-hidden="true">
                <NIcon
                  v-if="isSelected(currentQuestion, opt.id)"
                  :component="CheckmarkCircle"
                  :size="16"
                />
                <span
                  v-else
                  class="opt-ring"
                  :class="{ multi: currentQuestion.type === 'multi' }"
                />
              </span>
              <span class="opt-label">{{ optionLabel(opt) }}</span>
            </button>
          </div>

          <VoiceTextField
            v-if="needsCustomInput(currentQuestion) && !isSkipped(currentQuestion)"
            class="custom-input"
            :value="customModel(currentQuestion)"
            type="textarea"
            :placeholder="t.askUserCustomPlaceholder"
            :autosize="{ minRows: 2, maxRows: 4 }"
            round
            @update:value="(v) => setCustom(currentQuestion, v)"
          />
        </section>
      </div>

      <footer class="strip-foot">
        <div class="foot-left">
          <NButton
            quaternary
            round
            size="small"
            class="pi-interactive cancel-btn"
            :disabled="confirming"
            @click="onCancelAsk"
          >
            {{ t.cancel }}
          </NButton>
          <NText v-if="validationError" type="error" class="err">
            {{ validationError }}
          </NText>
        </div>
        <div class="foot-actions">
          <NButton
            v-if="questionSkippable(currentQuestion)"
            quaternary
            round
            class="pi-interactive skip-btn"
            :disabled="confirming"
            @click="skipCurrentQuestion"
          >
            {{ t.askUserSkip }}
          </NButton>
          <NButton
            v-if="total > 1"
            quaternary
            round
            class="pi-interactive"
            :disabled="isFirst || confirming"
            @click="goPrev"
          >
            {{ t.askUserPrev }}
          </NButton>
          <NButton
            v-if="!isLast"
            type="primary"
            round
            class="pi-interactive"
            :disabled="confirming"
            @click="goNext"
          >
            {{ t.askUserNext }}
          </NButton>
          <NButton
            v-else
            type="primary"
            round
            class="pi-interactive confirm-btn"
            :loading="confirming"
            @click="onConfirm"
          >
            {{ t.askUserConfirm }}
          </NButton>
        </div>
      </footer>
    </div>
  </div>
</template>

<style scoped>
/* Column geometry matches the composer's chat-input-stack so the card lines
   up edge-to-edge with the message list and the input box (Copilot style:
   the clarification card shares the chat column). */
.ask-user-wrap {
  flex-shrink: 0;
  width: 100%;
  max-width: var(--composer-max, 748px);
  margin: 0 auto;
  padding: 0 var(--chat-pad-x, 12px) 8px;
  display: flex;
  flex-direction: column;
  min-height: 0;
  animation: ask-rise 160ms var(--ease-out, ease);
}

@keyframes ask-rise {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Copilot-style clarification card: flat elevated surface, hairline border,
   small radius, restrained type — no accent gradient / glow. */
.ask-user-card {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-radius: 8px;
  border: 1px solid var(--chat-line, var(--border));
  background: var(--bg-elevated, #fff);
  box-shadow: none;
  overflow: hidden;
}

/* Header row reads like a chat participant label: icon + name + subtle hint. */
.strip-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px 2px;
  flex-shrink: 0;
}

.head-badge {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--chat-icon-fg, var(--fg-muted));
  background: var(--chat-hover-bg, rgba(127, 127, 127, 0.12));
  flex-shrink: 0;
}

.head-text {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.head-title {
  font-size: var(--chat-font-s, 12px);
  font-weight: 600;
  letter-spacing: 0;
  color: var(--fg-strong);
  white-space: nowrap;
}

.head-sub {
  font-size: var(--chat-font-xs, 11px);
  color: var(--chat-desc-fg, var(--fg-muted));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.head-progress {
  flex-shrink: 0;
  font-size: var(--chat-font-xs, 11px);
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  color: var(--chat-desc-fg, var(--fg-muted));
}

.strip-body {
  overflow-y: auto;
  padding: 6px 10px 8px;
  flex: 1;
  min-height: 0;
}

.question {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.q-prompt {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.q-text {
  font-size: var(--chat-font-m, 13px);
  line-height: 1.45;
  letter-spacing: 0;
  font-weight: 500;
  color: var(--fg);
}

.skip-tag {
  flex-shrink: 0;
  font-size: var(--chat-font-xs, 11px);
  font-weight: 500;
  color: var(--chat-desc-fg, var(--fg-muted));
  padding: 1px 7px;
  border: 1px solid var(--chat-line, var(--border));
  border-radius: 999px;
}

.opt-grid {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.opt-grid-wrap {
  flex-wrap: wrap;
  flex-direction: row;
  gap: 6px;
}

.opt-grid-dim {
  opacity: 0.5;
}

/* Copilot response-style choice rows: quiet checkbox list, hover highlight,
   selected gets a subtle checked state instead of a loud filled pill. */
.opt-chip {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  margin: 0;
  padding: 5px 8px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--fg);
  text-align: left;
  cursor: pointer;
  font-size: var(--chat-font-s, 12px);
  line-height: 1.4;
  transition: background var(--duration-fast, 100ms) var(--ease-out, ease);
}

.opt-chip.compact {
  width: auto;
  max-width: 100%;
  padding: 4px 10px;
  border: 1px solid var(--chat-line, var(--border));
  border-radius: 999px;
  background: transparent;
}

.opt-chip:hover {
  background: var(--chat-hover-bg, rgba(127, 127, 127, 0.12));
}

.opt-chip.compact:hover {
  border-color: var(--chat-line, var(--border));
  background: var(--chat-hover-bg, rgba(127, 127, 127, 0.12));
}

.opt-chip.selected {
  background: var(--accent-soft, rgba(65, 118, 230, 0.08));
}

.opt-chip.selected.compact {
  border-color: var(--accent-border, rgba(65, 118, 230, 0.32));
  background: var(--accent-soft, rgba(65, 118, 230, 0.08));
}

.opt-check {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--accent);
}

.opt-ring {
  width: 14px;
  height: 14px;
  border-radius: 999px;
  border: 1.5px solid var(--chat-line, var(--border-strong));
  box-sizing: border-box;
}

.opt-ring.multi {
  border-radius: 4px;
}

.opt-label {
  min-width: 0;
  overflow-wrap: anywhere;
}

.custom-input {
  margin-top: 4px;
}

.skip-btn {
  color: var(--chat-desc-fg, var(--fg-muted));
}

/* Footer keeps only quiet actions — borderless, no stacked tint bar. */
.strip-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 4px 10px 8px;
  flex-shrink: 0;
}

.foot-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
}

.cancel-btn {
  color: var(--chat-desc-fg, var(--fg-muted));
}

.err {
  min-width: 0;
  font-size: var(--chat-font-xs, 11px);
}

.foot-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  margin-left: auto;
}

.confirm-btn {
  min-width: 84px;
  font-weight: 600;
}

@media (prefers-reduced-motion: reduce) {
  .ask-user-wrap {
    animation: none;
  }
}
</style>
