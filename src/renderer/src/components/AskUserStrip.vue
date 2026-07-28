<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  NButton,
  NCheckbox,
  NCheckboxGroup,
  NInput,
  NRadio,
  NRadioButton,
  NRadioGroup,
  NSpace,
  NText,
} from "naive-ui";
import type { AskUserAnswerDraft, AskUserQuestion } from "../../../shared/ask-user";
import {
  formatAskUserAnswers,
  validateAskUserAnswers,
} from "../../../shared/ask-user";
import { t } from "@renderer/i18n";
import { useChatStore } from "@renderer/stores/chat";
import { useSessionsStore } from "@renderer/stores/sessions";

const chat = useChatStore();
const sessions = useSessionsStore();

const draft = ref<AskUserAnswerDraft>({});
const validationError = ref<string | null>(null);

const prompt = computed(() => chat.activePendingAskUser);

watch(
  prompt,
  (p) => {
    validationError.value = null;
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

function singleModel(q: AskUserQuestion): string | null {
  const ids = draft.value[q.id]?.optionIds ?? [];
  return ids[0] ?? null;
}

function setSingle(q: AskUserQuestion, optionId: string | null): void {
  const row = draft.value[q.id];
  if (!row) return;
  row.optionIds = optionId ? [optionId] : [];
}

function multiModel(q: AskUserQuestion): string[] {
  return draft.value[q.id]?.optionIds ?? [];
}

function setMulti(q: AskUserQuestion, optionIds: string[]): void {
  const row = draft.value[q.id];
  if (!row) return;
  row.optionIds = optionIds;
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
  if (!p || !sessionId) return;
  const err = validateAskUserAnswers(p, draft.value);
  if (err) {
    validationError.value = err;
    return;
  }
  validationError.value = null;
  const message = formatAskUserAnswers(p, draft.value);
  await chat.sendPrompt(sessionId, message);
}
</script>

<template>
  <div v-if="prompt" class="ask-user-strip">
    <div class="strip-head">
      <NText strong>{{ t.askUserToolLabel }}</NText>
      <NText depth="3" style="font-size: 12px">{{ t.askUserTitle }}</NText>
    </div>

    <div class="strip-body">
      <section v-for="q in prompt.questions" :key="q.id" class="question">
        <NText strong style="display: block; margin-bottom: 8px">{{ q.prompt }}</NText>

        <template v-if="q.type === 'multi'">
          <NCheckboxGroup
            :value="multiModel(q)"
            @update:value="(v) => setMulti(q, v as string[])"
          >
            <NSpace vertical>
              <NCheckbox
                v-for="opt in q.options"
                :key="opt.id"
                :value="opt.id"
                :label="opt.label"
              />
            </NSpace>
          </NCheckboxGroup>
        </template>

        <template v-else-if="q.type === 'buttons'">
          <NRadioGroup
            :value="singleModel(q)"
            size="small"
            @update:value="(v) => setSingle(q, v as string | null)"
          >
            <NSpace>
              <NRadioButton
                v-for="opt in q.options"
                :key="opt.id"
                :value="opt.id"
              >
                {{ opt.label }}
              </NRadioButton>
            </NSpace>
          </NRadioGroup>
        </template>

        <template v-else-if="q.type === 'single'">
          <NRadioGroup
            :value="singleModel(q)"
            @update:value="(v) => setSingle(q, v as string | null)"
          >
            <NSpace vertical>
              <NRadio v-for="opt in q.options" :key="opt.id" :value="opt.id">
                {{ opt.label }}
              </NRadio>
            </NSpace>
          </NRadioGroup>
        </template>

        <NInput
          v-if="needsCustomInput(q)"
          :value="customModel(q)"
          type="textarea"
          :placeholder="t.askUserCustomPlaceholder"
          :autosize="{ minRows: 2, maxRows: 4 }"
          style="margin-top: 8px"
          @update:value="(v) => setCustom(q, v)"
        />
      </section>
    </div>

    <div class="strip-foot">
      <NText v-if="validationError" type="error" style="font-size: 12px; flex: 1; min-width: 0">
        {{ validationError }}
      </NText>
      <NButton type="primary" @click="onConfirm">{{ t.askUserConfirm }}</NButton>
    </div>
  </div>
</template>

<style scoped>
.ask-user-strip {
  flex-shrink: 0;
  max-height: 40vh;
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  background: var(--bg-elevated, var(--bg));
}

.strip-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 10px var(--chat-pad-x, 10px) 0;
  flex-shrink: 0;
}

.strip-body {
  overflow-y: auto;
  padding: 10px var(--chat-pad-x, 10px);
  flex: 1;
  min-height: 0;
}

.question + .question {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--border);
}

.strip-foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  padding: 8px var(--chat-pad-x, 10px) 10px;
  flex-shrink: 0;
}
</style>
