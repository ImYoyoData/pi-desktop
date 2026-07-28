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
  formatAskUserAnswers,
  validateAskUserAnswers,
} from "../../../shared/ask-user";
import { t } from "@renderer/i18n";
import { useChatStore } from "@renderer/stores/chat";
import { useNotifyStore } from "@renderer/stores/notify";
import { useSessionsStore } from "@renderer/stores/sessions";

const chat = useChatStore();
const sessions = useSessionsStore();
const notify = useNotifyStore();

const draft = ref<AskUserAnswerDraft>({});
const validationError = ref<string | null>(null);
const confirming = ref(false);

const prompt = computed(() => chat.activePendingAskUser);

watch(
  prompt,
  (p, prev) => {
    validationError.value = null;
    confirming.value = false;
    if (!p) {
      draft.value = {};
      return;
    }
    const next: AskUserAnswerDraft = {};
    for (const q of p.questions) {
      next[q.id] = { optionIds: [], customText: "" };
    }
    draft.value = next;
    // Chime when a new ask panel appears (respect sound preference).
    if (!prev && notify.soundEnabled) {
      void notify.playChime();
    }
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

async function onConfirm(): Promise<void> {
  const p = prompt.value;
  const sessionId = sessions.activeId;
  if (!p || !sessionId || confirming.value) return;
  const err = validateAskUserAnswers(p, draft.value);
  if (err) {
    validationError.value = err;
    return;
  }
  validationError.value = null;
  confirming.value = true;
  try {
    const message = formatAskUserAnswers(p, draft.value);
    await chat.sendPrompt(sessionId, message);
  } finally {
    confirming.value = false;
  }
}
</script>

<template>
  <div v-if="prompt" class="ask-user-wrap">
    <div class="ask-user-card" role="dialog" :aria-label="t.askUserToolLabel">
      <header class="strip-head">
        <div class="head-badge" aria-hidden="true">
          <NIcon :component="ChatbubbleEllipsesOutline" :size="16" />
        </div>
        <div class="head-text">
          <div class="head-title">{{ t.askUserToolLabel }}</div>
          <div class="head-sub">{{ t.askUserTitle }}</div>
        </div>
      </header>

      <div class="strip-body">
        <section v-for="(q, qi) in prompt.questions" :key="q.id" class="question">
          <div class="q-prompt">
            <span v-if="prompt.questions.length > 1" class="q-index">{{ qi + 1 }}</span>
            <NText strong class="q-text">{{ q.prompt }}</NText>
          </div>

          <div
            class="opt-grid"
            :class="{
              'opt-grid-wrap': q.type === 'buttons',
              'opt-grid-stack': q.type !== 'buttons',
            }"
          >
            <button
              v-for="opt in q.options"
              :key="opt.id"
              type="button"
              class="opt-chip pi-interactive"
              :class="{
                selected: isSelected(q, opt.id),
                compact: q.type === 'buttons',
              }"
              @click="toggleOption(q, opt.id)"
            >
              <span class="opt-check" aria-hidden="true">
                <NIcon
                  v-if="isSelected(q, opt.id)"
                  :component="CheckmarkCircle"
                  :size="16"
                />
                <span v-else class="opt-ring" :class="{ multi: q.type === 'multi' }" />
              </span>
              <span class="opt-label">{{ opt.label }}</span>
            </button>
          </div>

          <NInput
            v-if="needsCustomInput(q)"
            class="custom-input"
            :value="customModel(q)"
            type="textarea"
            :placeholder="t.askUserCustomPlaceholder"
            :autosize="{ minRows: 2, maxRows: 4 }"
            round
            @update:value="(v) => setCustom(q, v)"
          />
        </section>
      </div>

      <footer class="strip-foot">
        <NText v-if="validationError" type="error" class="err">
          {{ validationError }}
        </NText>
        <NButton
          type="primary"
          round
          class="pi-interactive confirm-btn"
          :loading="confirming"
          @click="onConfirm"
        >
          {{ t.askUserConfirm }}
        </NButton>
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

.strip-body {
  overflow-y: auto;
  padding: 4px 14px 8px;
  flex: 1;
  min-height: 0;
}

.question + .question {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
}

.q-prompt {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 10px;
}

.q-index {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  margin-top: 1px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 650;
  color: var(--accent);
  background: var(--accent-soft);
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
