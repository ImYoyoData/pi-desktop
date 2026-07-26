<script setup lang="ts">
import { ref } from "vue";
import ModelsSettings from "@renderer/components/ModelsSettings.vue";
import { useWorkspaceStore } from "@renderer/stores/workspace";

const workspace = useWorkspaceStore();
const settingsOpen = ref(false);

function openFolder(): void {
  void workspace.openWorkspace();
}

function openSettings(): void {
  settingsOpen.value = true;
}
</script>

<template>
  <header class="top-bar">
    <span class="brand">Pi Desktop</span>
    <span class="root" :title="workspace.root ?? undefined">
      {{ workspace.root ?? "No folder" }}
    </span>
    <button type="button" class="open" @click="openSettings">Models</button>
    <button type="button" class="open" @click="openFolder">Open Folder</button>
  </header>
  <ModelsSettings :open="settingsOpen" @close="settingsOpen = false" />
</template>

<style scoped>
.top-bar {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.5rem 1rem;
  border-bottom: 1px solid #e5e7eb;
  background: var(--bg-title);
  font-size: 0.875rem;
}

.brand {
  font-weight: 600;
}

.root {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #374151;
}

.open {
  padding: 0.35rem 0.75rem;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: var(--bg-elevated);
  cursor: pointer;
}

.open:hover {
  background: var(--bg-hover);
}
</style>
