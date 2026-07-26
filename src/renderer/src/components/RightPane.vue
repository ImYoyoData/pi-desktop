<script setup lang="ts">
import { ref } from "vue";
import TerminalTab from "@renderer/components/TerminalTab.vue";
import { useLayoutStore } from "@renderer/stores/layout";

type RightTab = "terminal" | "preview" | "browser";

const layout = useLayoutStore();
const activeTab = ref<RightTab>("terminal");

const tabs: { id: RightTab; label: string }[] = [
  { id: "terminal", label: "Terminal" },
  { id: "preview", label: "Preview" },
  { id: "browser", label: "Browser" },
];
</script>

<template>
  <aside class="right-pane">
    <header class="head">
      <div class="tabs">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          class="tab"
          :class="{ active: activeTab === tab.id }"
          @click="activeTab = tab.id"
        >
          {{ tab.label }}
        </button>
      </div>
      <button type="button" class="collapse" title="Collapse panel" @click="layout.toggleRightCollapsed()">
        &rsaquo;
      </button>
    </header>
    <div class="body">
      <TerminalTab v-if="activeTab === 'terminal'" />
      <p v-else class="stub">{{ activeTab }} panel (stub)</p>
    </div>
  </aside>
</template>

<style scoped>
.right-pane {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  background: #f9fafb;
  border-left: 1px solid #e5e7eb;
}

.head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.35rem 0.5rem;
  border-bottom: 1px solid #e5e7eb;
}

.tabs {
  display: flex;
  flex: 1;
  gap: 0.25rem;
  min-width: 0;
}

.tab {
  padding: 0.25rem 0.5rem;
  border: none;
  border-radius: 4px;
  background: transparent;
  font-size: 0.75rem;
  cursor: pointer;
  color: #4b5563;
}

.tab.active {
  background: #e5e7eb;
  color: #111827;
  font-weight: 600;
}

.collapse {
  padding: 0.15rem 0.45rem;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  background: #fff;
  cursor: pointer;
  line-height: 1;
}

.body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.body .stub {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.stub {
  margin: 0;
  font-size: 0.8125rem;
  color: #6b7280;
  text-transform: capitalize;
}
</style>
