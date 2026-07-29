<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  NButton,
  NIcon,
  NInput,
  NText,
} from "naive-ui";
import { ChatbubbleEllipsesOutline, CheckmarkCircle } from "@vicons/ionicons5";
import type { AskUserAnswerDraft, AskUserQuestion } from "../../../shared/ask-user";
import {
  ASK_USER_CUSTOM_OPTION_ID,
  formatAskUserAnswers,
  validateAskUserAnswers,
  validateAskUserQuestionAnswer,
} from "../../../shared/ask-user";
import { t } from "@renderer/i18n";
import { useChatStore } from "@renderer/stores/chat";

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
      next[q.id] = { optionIds: [], customText: "" };
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

function toggleOption(q: AskUserQuestion, optionId: string): void {
  const row = draft.value[q.id];
  if (!row) return;
  if (q.type === "multi") {
    const set = new Set(row.optionIds);
    if (set.has(optionId)) set.delete(optionId);
    else set.add(optionId);
    row.optionIds = [...set];
    return;
  }
  row.optionIds = [optionId];
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
</script>

<template>
  <div v-if="prompt && currentQuestion" class="ask-user-wrap">
    <div class="ask-user-card" role="dialog" :aria-label="t.askUserToolLabel">
      <header class="strip-head">
        <div class="head-badge" aria-hidden="true">
          <NIcon :component="ChatbubbleEllipsesOutline" :size="16" />
        </div>
        <div class="head-text">
          <div class="head-title">{{ t.askUserToolLabel }}</div>
          <div class="head-sub">{{ t.askUserTitle }}</div>
        </div>
        <div v-if="total > 0" class="head-progress" :title="progressLabel">
          {{ progressLabel }}
        </div>
      </header>

      <div class="strip-body">
        <section class="question">
          <div class="q-prompt">
            <NText strong class="q-text">{{ currentQuestion.prompt }}</NText>
          </div>

          <div
            class="opt-grid"
            :class="{
              'opt-grid-wrap': currentQuestion.type === 'buttons',
              'opt-grid-stack': currentQuestion.type !== 'buttons',
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

          <NInput
            v-if="needsCustomInput(currentQuestion)"
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
        <NText v-if="validationError" type="error" class="err">
          {{ validationError }}
        </NText>
        <div class="foot-actions">
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
.ask-user-wrap {
  flex-shrink: 0;
  padding: 0 12px 10px;
  max-height: min(42vh, 420px);
  display: flex;
  flex-direction: column;
  min-height: 0;
  animation: ask-rise 240ms var(--ease-out, ease);
}

@keyframes ask-rise {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.ask-user-card {
  display: flex;
  flex-direction: column;
  min-height: 0;
  max-height: inherit;
  border-radius: 18px;
  border: 1px solid color-mix(in srgb, var(--accent-border, var(--border)) 55%, var(--border));
  background:
    linear-gradient(
      165deg,
      color-mix(in srgb, var(--accent-soft, transparent) 70%, var(--bg-elevated)) 0%,
      var(--bg-elevated, #fff) 42%
    );
  box-shadow:
    var(--shadow-md),
    0 0 0 1px color-mix(in srgb, var(--accent) 6%, transparent);
  overflow: hidden;
}

.strip-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px 10px;
  flex-shrink: 0;
}

.head-badge {
  width: 34px;
  height: 34px;
  border-radius: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--accent);
  background: var(--accent-soft);
  border: 1px solid var(--accent-border);
  flex-shrink: 0;
}

.head-text {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.head-title {
  font-size: 13.5px;
  font-weight: 650;
  letter-spacing: -0.02em;
  color: var(--fg-strong);
}

.head-sub {
  font-size: 12px;
  color: var(--fg-muted);
}

.head-progress {
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  color: var(--accent);
  background: var(--accent-soft);
  border: 1px solid var(--accent-border);
  border-radius: 999px;
  padding: 4px 10px;
}

.strip-body {
  overflow-y: auto;
  padding: 4px 14px 8px;
  flex: 1;
  min-height: 0;
}

.q-prompt {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 10px;
}

.q-text {
  font-size: 13.5px;
  line-height: 1.45;
  letter-spacing: -0.01em;
}

.opt-grid {
  display: flex;
  gap: 8px;
}

.opt-grid-wrap {
  flex-wrap: wrap;
}

.opt-grid-stack {
  flex-direction: column;
}

.opt-chip {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  margin: 0;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: color-mix(in srgb, var(--bg-elevated) 70%, var(--bg));
  color: var(--fg);
  text-align: left;
  cursor: pointer;
  transition:
    border-color var(--duration-fast, 140ms) var(--ease-out, ease),
    background var(--duration-fast, 140ms) var(--ease-out, ease),
    box-shadow var(--duration-fast, 140ms) var(--ease-out, ease),
    transform var(--duration-fast, 140ms) var(--ease-out, ease);
}

.opt-chip.compact {
  width: auto;
  max-width: 100%;
  padding: 8px 12px;
  border-radius: 999px;
}

.opt-chip:hover {
  border-color: var(--accent-border);
  background: var(--accent-soft);
}

.opt-chip.selected {
  border-color: var(--accent);
  background: var(--accent-soft);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 28%, transparent);
  color: var(--fg-strong);
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
  border: 1.5px solid var(--border-strong);
  box-sizing: border-box;
}

.opt-ring.multi {
  border-radius: 4px;
}

.opt-label {
  font-size: 13px;
  line-height: 1.35;
  font-weight: 500;
}

.custom-input {
  margin-top: 10px;
}

.strip-foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  padding: 10px 14px 14px;
  flex-shrink: 0;
  border-top: 1px solid color-mix(in srgb, var(--border) 75%, transparent);
  background: color-mix(in srgb, var(--bg-elevated) 88%, transparent);
}

.err {
  flex: 1;
  min-width: 0;
  font-size: 12px;
}

.foot-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.confirm-btn {
  min-width: 96px;
  font-weight: 600;
}

@media (prefers-reduced-motion: reduce) {
  .ask-user-wrap {
    animation: none;
  }
}
</style>
