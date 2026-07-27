<script setup lang="ts">
import { NButton, NIcon } from "naive-ui";
import { CreateOutline, FlashOutline, TrashOutline } from "@vicons/ionicons5";
import type { QueuedSendItem } from "@renderer/stores/send-queue";
import { t } from "@renderer/i18n";

defineProps<{
  items: QueuedSendItem[];
  editingId?: string | null;
}>();

const emit = defineEmits<{
  edit: [id: string];
  remove: [id: string];
  sendNow: [id: string];
}>();

function previewText(item: QueuedSendItem): string {
  const raw = item.text.replace(/\s+/g, " ").trim();
  if (raw) return raw;
  if (item.images?.length) return `[${item.images.length} image(s)]`;
  if (item.elementTags?.length) return item.elementTags[0]?.label || "[attachment]";
  return "…";
}
</script>

<template>
  <div v-if="items.length" class="send-queue" :aria-label="t.queueTitle">
    <div class="queue-head">{{ t.queueTitle }} · {{ items.length }}</div>
    <div
      v-for="(item, index) in items"
      :key="item.id"
      class="queue-row"
      :class="{ editing: editingId === item.id }"
    >
      <span class="queue-index">{{ index + 1 }}</span>
      <button
        type="button"
        class="queue-preview"
        :title="item.text"
        :disabled="editingId === item.id"
        @click="emit('edit', item.id)"
      >
        <span class="queue-preview-text">{{ previewText(item) }}</span>
        <span v-if="editingId === item.id" class="queue-editing-badge">{{ t.queueEditing }}</span>
      </button>
      <div class="queue-actions">
        <NButton
          size="tiny"
          quaternary
          class="q-btn"
          :disabled="editingId === item.id"
          :title="t.queueEdit"
          :aria-label="t.queueEdit"
          @click="emit('edit', item.id)"
        >
          <template #icon>
            <NIcon :component="CreateOutline" :size="12" />
          </template>
        </NButton>
        <NButton
          size="tiny"
          quaternary
          class="q-btn"
          :disabled="editingId === item.id"
          :title="t.queueSendNow"
          :aria-label="t.queueSendNow"
          @click="emit('sendNow', item.id)"
        >
          <template #icon>
            <NIcon :component="FlashOutline" :size="12" />
          </template>
        </NButton>
        <NButton
          size="tiny"
          quaternary
          class="q-btn"
          :title="t.queueRemove"
          :aria-label="t.queueRemove"
          @click="emit('remove', item.id)"
        >
          <template #icon>
            <NIcon :component="TrashOutline" :size="12" />
          </template>
        </NButton>
      </div>
    </div>
  </div>
</template>

<style scoped>
.send-queue {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px 6px;
  margin: 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-panel, var(--bg-elevated));
}

.queue-head {
  font-size: 10px;
  color: var(--fg-muted, #888);
  font-weight: 600;
  line-height: 1.2;
  padding: 0 2px 1px;
}

.queue-row {
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 22px;
}

.queue-row.editing {
  opacity: 0.8;
}

.queue-index {
  flex-shrink: 0;
  width: 12px;
  font-size: 10px;
  color: var(--fg-muted, #888);
  text-align: center;
}

.queue-preview {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  padding: 2px 4px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.queue-preview:hover:not(:disabled) {
  background: var(--bg-hover, rgba(127, 127, 127, 0.08));
}

.queue-preview:disabled {
  cursor: default;
}

.queue-preview-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  line-height: 1.3;
}

.queue-editing-badge {
  flex-shrink: 0;
  font-size: 9px;
  color: var(--primary, #3b82f6);
  font-weight: 600;
}

.queue-actions {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 0;
  flex-shrink: 0;
}

.q-btn {
  width: 20px !important;
  height: 20px !important;
  padding: 0 !important;
  min-width: 20px !important;
}
</style>
