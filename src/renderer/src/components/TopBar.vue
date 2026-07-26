<script setup lang="ts">
import { useWorkspaceStore } from "@renderer/stores/workspace";

const workspace = useWorkspaceStore();

function openFolder(): void {
  void workspace.openWorkspace();
}
</script>

<template>
  <header class="top-bar">
    <span class="brand">Pi Desktop</span>
    <span class="root" :title="workspace.root ?? undefined">
      {{ workspace.root ?? "No folder" }}
    </span>
    <button type="button" class="open" @click="openFolder">Open Folder</button>
  </header>
</template>

<style scoped>
.top-bar {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.5rem 1rem;
  border-bottom: 1px solid #e5e7eb;
  background: #fafafa;
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
  background: #fff;
  cursor: pointer;
}

.open:hover {
  background: #f3f4f6;
}
</style>
