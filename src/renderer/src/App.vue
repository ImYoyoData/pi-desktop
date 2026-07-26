<script setup lang="ts">
import { onMounted } from "vue";
import {
  NConfigProvider,
  NMessageProvider,
  NDialogProvider,
  zhCN,
  dateZhCN,
  enUS,
  dateEnUS,
} from "naive-ui";
import TitleBar from "@renderer/components/TitleBar.vue";
import WelcomeView from "@renderer/components/WelcomeView.vue";
import SplitRoot from "@renderer/components/SplitRoot.vue";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import { themeOverrides } from "@renderer/theme/naive";
import { locale } from "@renderer/i18n";

const workspace = useWorkspaceStore();
const naiveLocale = locale === "zh-CN" ? zhCN : enUS;
const naiveDateLocale = locale === "zh-CN" ? dateZhCN : dateEnUS;

onMounted(() => {
  void workspace.getWorkspace();
  void workspace.listRecent();
});
</script>

<template>
  <NConfigProvider
    :locale="naiveLocale"
    :date-locale="naiveDateLocale"
    :theme-overrides="themeOverrides"
    abstract
  >
    <NMessageProvider>
      <NDialogProvider>
        <div class="app-shell">
          <TitleBar />
          <main class="app-main">
            <WelcomeView v-if="!workspace.root" />
            <SplitRoot v-else />
          </main>
        </div>
      </NDialogProvider>
    </NMessageProvider>
  </NConfigProvider>
</template>

<style>
/* global styles imported from main.ts */
</style>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: var(--bg);
  color: var(--fg);
}

.app-main {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
</style>
