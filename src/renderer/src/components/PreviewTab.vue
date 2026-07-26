<script setup lang="ts">
import type { PreviewResult } from "../../../shared/preview-types";
import { ref, watch } from "vue";
import { usePreviewStore } from "@renderer/stores/preview";

const preview = usePreviewStore();
const currentPath = ref<string | null>(null);
const result = ref<PreviewResult | null>(null);
const loading = ref(false);

async function loadPath(path: string | null): Promise<void> {
  currentPath.value = path;
  result.value = null;
  if (!path) {
    return;
  }
  loading.value = true;
  try {
    result.value = await window.api.preview.read(path);
  } finally {
    loading.value = false;
  }
}

watch(
  () => preview.filePath,
  (path) => {
    void loadPath(path);
  },
  { immediate: true },
);

async function pickFile(): Promise<void> {
  const picked = await window.api.preview.pickFile();
  if (picked) {
    preview.openPreview(picked);
  }
}
</script>

<template>
  <div class="preview-tab">
    <div class="toolbar">
      <button type="button" class="btn" @click="pickFile">Open file…</button>
      <span v-if="currentPath" class="path">{{ currentPath }}</span>
    </div>
    <div class="viewport">
      <p v-if="!currentPath" class="hint">Open a file from the workspace or use Preview on a tool path in chat.</p>
      <p v-else-if="loading" class="hint">Loading…</p>
      <template v-else-if="result">
        <p v-if="result.kind === 'error'" class="msg err">{{ result.message }}</p>
        <p v-else-if="result.kind === 'unsupported'" class="msg warn">
          Preview not available for this file type.
        </p>
        <p
          v-else-if="(result.kind === 'text' || result.kind === 'markdown') && result.truncated"
          class="msg warn"
        >
          File truncated to 1.5MB.
        </p>
        <pre v-if="result.kind === 'text'" class="code">{{ result.content }}</pre>
        <pre v-else-if="result.kind === 'markdown'" class="code md">{{ result.content }}</pre>
        <img v-else-if="result.kind === 'image'" class="img" :src="result.dataUrl" :alt="result.path" />
      </template>
    </div>
  </div>
</template>

<style scoped>
.preview-tab {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.35rem 0.5rem;
  border-bottom: 1px solid #e5e7eb;
  min-width: 0;
}

.btn {
  padding: 0.25rem 0.5rem;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  background: #fff;
  font-size: 0.75rem;
  cursor: pointer;
}

.path {
  font-family: ui-monospace, monospace;
  font-size: 0.6875rem;
  color: #4b5563;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.viewport {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0.5rem;
}

.hint {
  margin: 0;
  font-size: 0.8125rem;
  color: #6b7280;
}

.msg {
  margin: 0 0 0.5rem;
  font-size: 0.8125rem;
}

.msg.err {
  color: #b91c1c;
}

.msg.warn {
  color: #92400e;
}

.code {
  margin: 0;
  font-family: ui-monospace, monospace;
  font-size: 0.75rem;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
}

.code.md {
  font-family: inherit;
}

.img {
  max-width: 100%;
  height: auto;
  display: block;
}
</style>
