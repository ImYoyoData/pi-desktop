<script setup lang="ts">
import { useLayoutStore } from "@renderer/stores/layout";

const layout = useLayoutStore();
</script>

<template>
  <aside class="session-sidebar">
    <header class="head">
      <span class="title">Sessions</span>
      <button type="button" class="collapse" title="Collapse sidebar" @click="layout.toggleLeftCollapsed()">
        ‹
      </button>
    </header>
    <p class="stub">Session list (stub)</p>
  </aside>
</template>

<style scoped>
.session-sidebar {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  background: #f9fafb;
  border-right: 1px solid #e5e7eb;
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid #e5e7eb;
  font-size: 0.8125rem;
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

.stub {
  margin: 0.75rem;
  font-size: 0.8125rem;
  color: #6b7280;
}
</style>
