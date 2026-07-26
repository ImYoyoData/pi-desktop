<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import type { ChatMessage } from "@renderer/stores/chat";
import { extractWorkspacePaths } from "@renderer/utils/preview-paths";
import { usePreviewStore } from "@renderer/stores/preview";

const props = defineProps<{
  messages: ChatMessage[];
  running: boolean;
}>();

const previewStore = usePreviewStore();

function toolPaths(msg: Extract<ChatMessage, { role: "tool" }>): string[] {
  const fromArgs = extractWorkspacePaths(msg.args);
  const fromResult = extractWorkspacePaths(msg.result);
  return [...new Set([...fromArgs, ...fromResult])];
}

function openPreview(filePath: string): void {
  previewStore.openPreview(filePath);
}

const scroller = ref<HTMLElement | null>(null);
const expandedTools = ref<Set<string>>(new Set());

function toggleTool(id: string): void {
  const next = new Set(expandedTools.value);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  expandedTools.value = next;
}

function toolExpanded(id: string): boolean {
  return expandedTools.value.has(id);
}

function formatArgs(args: unknown): string {
  if (args === undefined) {
    return "";
  }
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
}

watch(
  () => [props.messages.length, props.messages.at(-1)],
  async () => {
    await nextTick();
    const el = scroller.value;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  },
);
</script>

<template>
  <div ref="scroller" class="message-list">
    <p v-if="messages.length === 0" class="empty">Send a message to start the agent.</p>

    <article
      v-for="msg in messages"
      :key="msg.id"
      class="row"
      :class="`row-${msg.role}`"
    >
      <template v-if="msg.role === 'user'">
        <div class="bubble user">{{ msg.text }}</div>
      </template>

      <template v-else-if="msg.role === 'assistant'">
        <div class="bubble assistant">
          <pre class="text">{{ msg.text || (msg.streaming ? "…" : "") }}</pre>
          <span v-if="msg.streaming" class="cursor" aria-hidden="true" />
        </div>
      </template>

      <template v-else-if="msg.role === 'tool'">
        <div class="tool">
          <button type="button" class="tool-head" @click="toggleTool(msg.id)">
            <span class="chevron">{{ toolExpanded(msg.id) ? "▾" : "▸" }}</span>
            <span class="tool-name">{{ msg.toolName }}</span>
            <span v-if="msg.streaming" class="tool-status">running</span>
            <span v-else-if="msg.isError" class="tool-status err">error</span>
            <span v-else class="tool-status ok">done</span>
          </button>
          <pre v-if="toolExpanded(msg.id)" class="tool-body">{{ formatArgs(msg.args ?? msg.result) }}</pre>
          <div v-if="toolExpanded(msg.id) && toolPaths(msg).length" class="tool-preview">
            <button
              v-for="filePath in toolPaths(msg)"
              :key="filePath"
              type="button"
              class="preview-btn"
              @click.stop="openPreview(filePath)"
            >
              Preview {{ filePath }}
            </button>
          </div>
        </div>
      </template>

      <template v-else-if="msg.role === 'error'">
        <div class="bubble error">{{ msg.text }}</div>
      </template>
    </article>

    <div v-if="running && messages.length > 0" class="running-indicator">
      <span class="dot" />
      Agent running…
    </div>
  </div>
</template>

<style scoped>
.message-list {
  flex: 1;
  overflow: auto;
  padding: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.empty {
  margin: auto;
  color: #6b7280;
  font-size: 0.875rem;
}

.row {
  display: flex;
}

.row-user {
  justify-content: flex-end;
}

.row-assistant,
.row-tool,
.row-error {
  justify-content: flex-start;
}

.bubble {
  max-width: min(42rem, 92%);
  border-radius: 10px;
  padding: 0.55rem 0.75rem;
  font-size: 0.875rem;
  line-height: 1.45;
}

.bubble.user {
  background: #111827;
  color: #f9fafb;
  white-space: pre-wrap;
}

.bubble.assistant {
  background: #f3f4f6;
  color: #111827;
  border: 1px solid #e5e7eb;
}

.bubble.error {
  background: #fef2f2;
  color: #b91c1c;
  border: 1px solid #fecaca;
}

.text {
  margin: 0;
  font-family: inherit;
  white-space: pre-wrap;
  word-break: break-word;
}

.cursor {
  display: inline-block;
  width: 0.45rem;
  height: 1em;
  margin-left: 2px;
  background: #6b7280;
  animation: blink 1s step-end infinite;
  vertical-align: text-bottom;
}

@keyframes blink {
  50% {
    opacity: 0;
  }
}

.tool {
  max-width: min(42rem, 92%);
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #fff;
  overflow: hidden;
}

.tool-head {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.4rem 0.55rem;
  border: none;
  background: #f9fafb;
  cursor: pointer;
  font-size: 0.8125rem;
  text-align: left;
}

.chevron {
  color: #6b7280;
}

.tool-name {
  font-family: ui-monospace, monospace;
  font-weight: 600;
}

.tool-status {
  margin-left: auto;
  font-size: 0.6875rem;
  text-transform: uppercase;
  color: #6b7280;
}

.tool-status.ok {
  color: #15803d;
}

.tool-status.err {
  color: #b91c1c;
}

.tool-body {
  margin: 0;
  padding: 0.45rem 0.55rem;
  font-size: 0.75rem;
  overflow: auto;
  max-height: 12rem;
  background: #fff;
}

.tool-preview {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  padding: 0.35rem 0.55rem 0.5rem;
  border-top: 1px solid #f3f4f6;
}

.preview-btn {
  padding: 0.2rem 0.45rem;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  background: #fff;
  font-size: 0.6875rem;
  font-family: ui-monospace, monospace;
  cursor: pointer;
}

.preview-btn:hover {
  background: #f3f4f6;
}

.running-indicator {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.75rem;
  color: #6b7280;
  padding-left: 0.25rem;
}

.dot {
  width: 0.45rem;
  height: 0.45rem;
  border-radius: 999px;
  background: #22c55e;
  animation: pulse 1.2s ease-in-out infinite;
}

@keyframes pulse {
  50% {
    opacity: 0.35;
  }
}
</style>
