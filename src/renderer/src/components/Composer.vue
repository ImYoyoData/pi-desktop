<script setup lang="ts">
import { computed, ref } from "vue";
import CitationCard from "@renderer/components/CitationCard.vue";
import { useChatStore } from "@renderer/stores/chat";
import { useComposerStore } from "@renderer/stores/composer";
import { useSessionsStore } from "@renderer/stores/sessions";

const chat = useChatStore();
const composer = useComposerStore();
const sessions = useSessionsStore();

const textarea = ref<HTMLTextAreaElement | null>(null);

const sessionId = computed(() => sessions.activeId);
const running = computed(() => chat.activeRunning || activeSessionRunning());

function activeSessionRunning(): boolean {
  const id = sessions.activeId;
  if (!id) {
    return false;
  }
  const row = sessions.sessions.find((s) => s.id === id);
  return row?.status === "running";
}

const sendHint = computed(() => {
  if (running.value) {
    return "Enter: steer · Alt+Enter: follow-up";
  }
  return "Enter: send · Shift+Enter: new line";
});

const canSend = computed(() => Boolean(sessionId.value && composer.draft.trim()));

async function submit(mode: "prompt" | "steer" | "follow_up"): Promise<void> {
  const id = sessionId.value;
  const text = composer.draft.trim();
  if (!id || !text) {
    return;
  }
  composer.draft = "";
  const citations = composer.citations.length ? [...composer.citations] : undefined;
  composer.clear();
  if (mode === "prompt") {
    await chat.sendPrompt(id, text, citations);
  } else if (mode === "steer") {
    await chat.steer(id, text);
  } else {
    await chat.followUp(id, text);
  }
  textarea.value?.focus();
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== "Enter") {
    return;
  }
  if (event.isComposing) {
    return;
  }
  if (event.shiftKey) {
    return;
  }
  event.preventDefault();
  if (running.value) {
    if (event.altKey) {
      void submit("follow_up");
    } else {
      void submit("steer");
    }
    return;
  }
  void submit("prompt");
}

async function onAbort(): Promise<void> {
  const id = sessionId.value;
  if (!id) {
    return;
  }
  await chat.abort(id);
}
</script>

<template>
  <div class="composer">
    <div v-if="composer.citations.length" class="citations">
      <CitationCard
        v-for="(citation, index) in composer.citations"
        :key="`${citation.url}-${index}`"
        :citation="citation"
        :index="index"
        @remove="composer.removeCitation(index)"
      />
    </div>

    <div class="input-row">
      <textarea
        ref="textarea"
        v-model="composer.draft"
        class="input"
        rows="3"
        :placeholder="sessionId ? 'Ask the agent…' : 'Select a session first'"
        :disabled="!sessionId"
        @keydown="onKeydown"
      />
      <div class="actions">
        <span class="hint" :title="sendHint">{{ sendHint }}</span>
        <button
          v-if="running"
          type="button"
          class="btn abort"
          :disabled="!sessionId"
          @click="onAbort"
        >
          Stop
        </button>
        <button
          type="button"
          class="btn send"
          :disabled="!canSend"
          @click="submit(running ? 'steer' : 'prompt')"
        >
          {{ running ? "Steer" : "Send" }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.composer {
  border-top: 1px solid #e5e7eb;
  padding: 0.65rem 0.75rem 0.75rem;
  background: #fff;
}

.citations {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  margin-bottom: 0.45rem;
}

.input-row {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.input {
  width: 100%;
  resize: vertical;
  min-height: 4.5rem;
  max-height: 12rem;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  padding: 0.55rem 0.65rem;
  font: inherit;
  line-height: 1.4;
}

.input:disabled {
  background: #f9fafb;
  color: #9ca3af;
}

.actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.hint {
  flex: 1;
  font-size: 0.6875rem;
  color: #6b7280;
}

.btn {
  font-size: 0.8125rem;
  padding: 0.35rem 0.75rem;
  border-radius: 6px;
  border: 1px solid #d1d5db;
  background: #fff;
  cursor: pointer;
}

.btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.btn.send {
  background: #111827;
  color: #fff;
  border-color: #111827;
}

.btn.abort {
  border-color: #fca5a5;
  color: #b91c1c;
}
</style>
