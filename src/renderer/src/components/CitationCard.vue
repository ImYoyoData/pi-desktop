<script setup lang="ts">
import type { ElementCitation } from "../../../shared/protocol";

defineProps<{
  citation: ElementCitation;
  index: number;
}>();

const emit = defineEmits<{
  remove: [];
}>();
</script>

<template>
  <div class="citation">
    <div class="meta">
      <span class="badge">Citation {{ index + 1 }}</span>
      <button type="button" class="remove" title="Remove citation" @click="emit('remove')">×</button>
    </div>
    <p class="url">{{ citation.url }}</p>
    <p class="selector">{{ citation.selector }}</p>
    <p class="text">{{ citation.text }}</p>
  </div>
</template>

<style scoped>
.citation {
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  padding: 0.45rem 0.55rem;
  background: #f9fafb;
  font-size: 0.75rem;
}

.meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.25rem;
}

.badge {
  font-weight: 600;
  color: #374151;
}

.remove {
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 1rem;
  line-height: 1;
  color: #6b7280;
}

.url,
.selector,
.text {
  margin: 0.15rem 0 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #4b5563;
}

.selector {
  font-family: ui-monospace, monospace;
  font-size: 0.6875rem;
}
</style>
