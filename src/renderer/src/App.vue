<script setup lang="ts">
// pi-lens-ignore: 2305
import { computed, defineAsyncComponent, onMounted, onUnmounted, ref, watch } from "vue";
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
import AppWallpaper from "@renderer/components/AppWallpaper.vue";
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
import { dismissStartupSplash } from "@renderer/utils/startup-splash";
import { markRendererStartup } from "@renderer/utils/startup-timing";
import { startFsChangedBus } from "@renderer/utils/fs-changed-bus";

/** Heavy workspace chrome — load after first paint when a folder is open. */
const SplitRoot = defineAsyncComponent(() => {
  markRendererStartup("renderer:splitroot-load-start");
  return import("@renderer/components/SplitRoot.vue").then((m) => {
    markRendererStartup("renderer:splitroot-load-done");
    return m;
  });
});
const AiCustomizationModal = defineAsyncComponent(
  () => import("@renderer/components/AiCustomizationModal.vue"),
);

const workspace = useWorkspaceStore();
const appearance = useAppearanceStore();
/** True once workspace/platform init finished (gates shell mounting). */
const bootInitDone = ref(false);
/**
 * Failsafe: some init steps (e.g. the trust prompt awaiting user input)
 * can take a while; never block shell mounting forever.
 */
const BOOT_MAX_MS = 6000;
let bootTimer = 0;

/** Shell content can mount once init IPC returns (or failsafe fires). */
const shellReady = computed(() => bootInitDone.value);
const naiveLocale = computed(() => (locale.value === "zh-CN" ? zhCN : enUS));
const naiveDateLocale = computed(() =>
  locale.value === "zh-CN" ? dateZhCN : dateEnUS,
);

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
let stopFsChangedBus: (() => void) | undefined;

onMounted(() => {
  stopAppearance = appearance.init();
  stopFsChangedBus = startFsChangedBus();
  void window.api.window.setUiLocale(locale.value);
  // Instant open: drop the full-screen splash right after first paint so the
  // window feels instant; shell content mounts once workspace init finishes.
  void dismissStartupSplash(true);
  // Hard cap: never block shell mounting if workspace IPC hangs.
  bootTimer = window.setTimeout(() => {
    bootInitDone.value = true;
  }, BOOT_MAX_MS);
  void (async () => {
    try {
      await Promise.all([
        workspace.getWorkspace(),
        // Desktop-only first; Pi CLI session scan merges in the background.
        workspace.listRecentFast(),
        window.api.window.platform().then((p) => {
          document.documentElement.classList.toggle("platform-darwin", p === "darwin");
          document.documentElement.classList.toggle("platform-win32", p === "win32");
        }),
      ]);
    } finally {
      bootInitDone.value = true;
      markRendererStartup("renderer:shell-ready");
      if (!workspace.root) markRendererStartup("renderer:ready");
    }
  })();
});

onUnmounted(() => {
  window.clearTimeout(bootTimer);
  stopAppearance?.();
  stopFsChangedBus?.();
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
          <AppWallpaper />
          <TitleBar />
          <main class="app-main">
            <div v-if="shellReady" class="app-main-body">
              <WelcomeView v-if="!workspace.root" />
              <SplitRoot v-else />
            </div>
          </main>
          <PiCliSetup />
          <AiCustomizationModal v-if="workspace.root" />
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
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.app-main-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  animation: shell-rise 280ms var(--ease-out, cubic-bezier(0.22, 1, 0.36, 1));
}

@keyframes shell-rise {
  from {
    opacity: 0.35;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .app-main-body {
    animation: none !important;
    transition: none !important;
  }
}
</style>
