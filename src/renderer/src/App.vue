<script setup lang="ts">
import { onMounted } from "vue";
import TopBar from "@renderer/components/TopBar.vue";
import WelcomeView from "@renderer/components/WelcomeView.vue";
import { useWorkspaceStore } from "@renderer/stores/workspace";

const workspace = useWorkspaceStore();

onMounted(() => {
  void workspace.getWorkspace();
});
</script>

<template>
  <div class="app-shell">
    <TopBar />
    <WelcomeView v-if="!workspace.root" />
    <main v-else class="shell-placeholder">
      <p>Agent workspace shell (placeholder)</p>
    </main>
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  margin: 0;
  font-family: system-ui, sans-serif;
}

.shell-placeholder {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  color: #6b7280;
}
</style>
