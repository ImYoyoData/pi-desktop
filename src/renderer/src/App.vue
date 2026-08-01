<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, onUnmounted, watch } from "vue";
import {
  NConfigProvider,
  NMessageProvider,
  NDialogProvider,
  darkTheme,
  zhCN,
  dateZhCN,
  enUS,
  dateEnUS,
} from "naive-ui";
import TitleBar from "@renderer/components/TitleBar.vue";
import WelcomeView from "@renderer/components/WelcomeView.vue";
import PiCliSetup from "@renderer/components/PiCliSetup.vue";
import CloseGuard from "@renderer/components/CloseGuard.vue";
import AsrWakeGuard from "@renderer/components/AsrWakeGuard.vue";
import TrustDialog from "@renderer/components/TrustDialog.vue";
import AsrBackendChooseModal from "@renderer/components/AsrBackendChooseModal.vue";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import { useAppearanceStore } from "@renderer/stores/appearance";
import { darkThemeOverrides, lightThemeOverrides } from "@renderer/theme/naive";
import { locale } from "@renderer/i18n";
import { dismissLocaleReloadSplash } from "@renderer/utils/locale-reload-splash";
import { dismissStartupSplash } from "@renderer/utils/startup-splash";

/** Heavy workspace chrome — load after first paint when a folder is open. */
const SplitRoot = defineAsyncComponent(() => import("@renderer/components/SplitRoot.vue"));

const workspace = useWorkspaceStore();
const appearance = useAppearanceStore();
const naiveLocale = locale === "zh-CN" ? zhCN : enUS;
const naiveDateLocale = locale === "zh-CN" ? dateZhCN : dateEnUS;

const naiveTheme = computed(() =>
  appearance.resolvedTheme === "dark" ? darkTheme : null,
);
const themeOverrides = computed(() =>
  appearance.resolvedTheme === "dark" ? darkThemeOverrides : lightThemeOverrides,
);

// The trust prompt is a modal that must be clickable: drop the splash fast.
watch(
  () => workspace.trustDialogOpen,
  (open) => {
    if (open) void dismissStartupSplash(true);
  },
);

let stopAppearance: (() => void) | undefined;

onMounted(() => {
  stopAppearance = appearance.init();
  void window.api.window.setUiLocale(locale === "zh-CN" ? "zh-CN" : "en");
  void (async () => {
    try {
      await Promise.all([
        workspace.getWorkspace(),
        workspace.listRecent(),
        window.api.window.platform().then((p) => {
          document.documentElement.classList.toggle("platform-darwin", p === "darwin");
          document.documentElement.classList.toggle("platform-win32", p === "win32");
        }),
      ]);
    } finally {
      // Startup splash fades out once the workspace/platform init is done,
      // hiding session/history/trust loading flashes behind a smooth transition.
      await dismissStartupSplash();
      await dismissLocaleReloadSplash();
    }
  })();
});

onUnmounted(() => {
  stopAppearance?.();
});
</script>

<template>
  <NConfigProvider
    :locale="naiveLocale"
    :date-locale="naiveDateLocale"
    :theme="naiveTheme"
    :theme-overrides="themeOverrides"
    abstract
  >
    <NMessageProvider>
      <NDialogProvider>
        <CloseGuard />
        <AsrWakeGuard />
        <div class="app-shell" :data-theme="appearance.resolvedTheme">
          <TitleBar />
          <main class="app-main">
            <WelcomeView v-if="!workspace.root" />
            <SplitRoot v-else />
          </main>
          <PiCliSetup />
          <TrustDialog />
          <AsrBackendChooseModal />
        </div>
      </NDialogProvider>
    </NMessageProvider>
  </NConfigProvider>
</template>

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
