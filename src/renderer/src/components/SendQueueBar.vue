<script setup lang="ts">
import { NButton, NIcon, NInput } from "naive-ui";
import { FlashOutline, TrashOutline } from "@vicons/ionicons5";
import type { QueuedSendItem } from "@renderer/stores/send-queue";
import { t } from "@renderer/i18n";

defineProps<{
  items: QueuedSendItem[];
}>();

const emit = defineEmits<{
  updateText: [id: string, text: string];
  remove: [id: string];
  sendNow: [id: string];
}>();
</script>

<template>
  <div v-if="items.length" class="send-queue" :aria-label="t.queueTitle">
    <div class="queue-head">{{ t.queueTitle }} · {{ items.length }}</div>
    <div v-for="(item, index) in items" :key="item.id" class="queue-row">
      <span class="queue-index">{{ index + 1 }}</span>
      <NInput
        class="queue-text"
        type="textarea"
        size="tiny"
        :value="item.text"
        :autosize="{ minRows: 1, maxRows: 4 }"
        :placeholder="t.queueEditPlaceholder"
        @update:value="(v) => emit('updateText', item.id, v)"
      />
      <div class="queue-actions">
        <NButton
          size="tiny"
          quaternary
          :title="t.queueSendNow"
          :aria-label="t.queueSendNow"
          @click="emit('sendNow', item.id)"
        >
          <template #icon>
            <NIcon :component="FlashOutline" :size="14" />
          </template>
        </NButton>
        <NButton
          size="tiny"
          quaternary
          :title="t.queueRemove"
          :aria-label="t.queueRemove"
          @click="emit('remove', item.id)"
        >
          <template #icon>
            <NIcon :component="TrashOutline" :size="14" />
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
  gap: 6px;
  padding: 8px 10px;
  margin: 0 0 2px;
  border: 1px solid var(--border-strong, var(--border));
  border-radius: 10px;
  background: var(--bg-panel, var(--bg-elevated));
}

.queue-head {
  font-size: 11px;
  color: var(--fg-muted, #888);
  font-weight: 600;
  letter-spacing: 0.02em;
}

.queue-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.queue-index {
  flex-shrink: 0;
  width: 16px;
  margin-top: 6px;
  font-size: 11px;
  color: var(--fg-muted, #888);
  text-align: center;
}

.queue-text {
  flex: 1;
  min-width: 0;
}

.queue-actions {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex-shrink: 0;
}
</style>
