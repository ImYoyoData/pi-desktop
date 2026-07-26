<script setup lang="ts">
import { onMounted } from "vue";
import { useWorkspaceStore } from "@renderer/stores/workspace";

const workspace = useWorkspaceStore();

onMounted(() => {
  void workspace.listRecent();
});

function openFolder(): void {
  void workspace.openWorkspace();
}

function openRecent(path: string): void {
  void workspace.openWorkspacePath(path);
}
</script>

<template>
  <section class="welcome">
    <h2>Open a folder</h2>
    <p class="subtitle">Choose a project directory to start the agent workspace.</p>
    <button type="button" class="primary" @click="openFolder">Open Folder</button>

    <div v-if="workspace.recent.length" class="recent">
      <h3>Recent</h3>
      <ul>
        <li v-for="item in workspace.recent" :key="item">
          <button type="button" class="recent-item" @click="openRecent(item)">
            {{ item }}
          </button>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.welcome {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  padding: 2rem;
}

.subtitle {
  margin: 0;
  color: #666;
}

.primary {
  padding: 0.5rem 1.25rem;
  border: none;
  border-radius: 6px;
  background: #2563eb;
  color: #fff;
  font-size: 0.95rem;
  cursor: pointer;
}

.primary:hover {
  background: #1d4ed8;
}

.recent {
  width: min(520px, 100%);
  margin-top: 1.5rem;
}

.recent h3 {
  margin: 0 0 0.5rem;
  font-size: 0.85rem;
  font-weight: 600;
  color: #444;
}

.recent ul {
  margin: 0;
  padding: 0;
  list-style: none;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  overflow: hidden;
}

.recent-item {
  display: block;
  width: 100%;
  padding: 0.65rem 1rem;
  border: none;
  border-bottom: 1px solid #e5e7eb;
  background: #fff;
  text-align: left;
  font-size: 0.9rem;
  cursor: pointer;
}

.recent-item:last-child {
  border-bottom: none;
}

.recent-item:hover {
  background: #f3f4f6;
}
</style>
