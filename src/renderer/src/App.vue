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
import WelcomeView from "@renderer/components/WelcomeView.vue";
import PiCliSetup from "@renderer/components/PiCliSetup.vue";
import CloseGuard from "@renderer/components/CloseGuard.vue";
import AsrWakeGuard from "@renderer/components/AsrWakeGuard.vue";
import TrustDialog from "@renderer/components/TrustDialog.vue";
import AsrBackendChooseModal from "@renderer/components/AsrBackendChooseModal.vue";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import { useAppearanceStore } from "@renderer/stores/appearance";
import { darkThemeOverrides, lightThemeOverrides } from "@renderer/theme/naive";
import { locale, t } from "@renderer/i18n";
import { dismissLocaleReloadSplash } from "@renderer/utils/locale-reload-splash";
import { dismissStartupSplash } from "@renderer/utils/startup-splash";
import { markRendererStartup } from "@renderer/utils/startup-timing";

/** Heavy workspace chrome — load after first paint when a folder is open. */
const SplitRoot = defineAsyncComponent(() => {
  markRendererStartup("renderer:splitroot-load-start");
  return import("@renderer/components/SplitRoot.vue").then((m) => {
    markRendererStartup("renderer:splitroot-load-done");
    return m;
  });
});

const workspace = useWorkspaceStore();
const appearance = useAppearanceStore();
/** True once workspace/platform init finished (drives the boot overlay). */
const bootInitDone = ref(false);
/**
 * Failsafe: some init steps (e.g. the trust prompt awaiting user input)
 * can take a while; never leave the boot overlay up forever.
 */
const BOOT_MAX_MS = 6000;
/**
 * Keep the boot overlay visible at least this long after first paint. Without
 * this, a fast workspace IPC resolves init before the first frame, so the
 * overlay never paints and the user sees a plain white flash on startup.
 */
const BOOT_MIN_MS = 600;
let bootTimer = 0;
let bootStartedAt = 0;

/** 0-100 progress for the boot bar — UI mounts as soon as workspace init finishes. */
const bootProgress = computed(() => (bootInitDone.value ? 100 : 55));

/** Overlay only covers first paint; workspace chrome mounts underneath (no 3s stall). */
const showBootOverlay = computed(() => !bootInitDone.value);
/** Shell content can mount once init IPC returns (or failsafe fires). */
const shellReady = computed(() => bootInitDone.value);
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
  bootStartedAt = Date.now();
  stopAppearance = appearance.init();
  void window.api.window.setUiLocale(locale === "zh-CN" ? "zh-CN" : "en");
  // Instant open: drop the full-screen splash right after first paint so the
  // window feels instant; heavy workspace init runs behind a light in-app overlay.
  void dismissStartupSplash(true);
  // Hard cap: never leave the overlay up if workspace IPC hangs.
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
      await dismissLocaleReloadSplash();
      // Hold the loading overlay for a minimum time so a fast init still shows
      // the loader instead of a white flash.
      const elapsed = Date.now() - bootStartedAt;
      if (elapsed < BOOT_MIN_MS) {
        await new Promise<void>((r) => setTimeout(r, BOOT_MIN_MS - elapsed));
      }
      bootInitDone.value = true;
      markRendererStartup("renderer:shell-ready");
      if (!workspace.root) markRendererStartup("renderer:ready");
    }
  })();
});

onUnmounted(() => {
  window.clearTimeout(bootTimer);
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
            <div v-if="shellReady" class="app-main-body" :class="{ 'under-boot': showBootOverlay }">
              <WelcomeView v-if="!workspace.root" />
              <SplitRoot v-else />
            </div>
            <Transition name="boot-fade">
              <div v-if="showBootOverlay" class="boot-overlay" role="status">
                <div class="loader" aria-hidden="true">
                  <div class="loader-ring" />
                  <div class="loader-core" />
                </div>
                <div class="boot-text">{{ t.bootLoading }}</div>
                <div class="boot-progress" aria-hidden="true">
                  <div class="boot-progress-fill" :style="{ width: bootProgress + '%' }" />
                </div>
              </div>
            </Transition>
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

.app-main-body.under-boot {
  pointer-events: none;
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

.boot-overlay {
  position: absolute;
  inset: 0;
  /* High enough to sit above any app chrome (titlebar, splitpanes, modals). */
  z-index: 9999;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  background: var(--bg);
}

.boot-fade-enter-active,
.boot-fade-leave-active {
  transition: opacity 0.32s var(--ease-out, ease);
}

.boot-fade-enter-from,
.boot-fade-leave-to {
  opacity: 0;
}

.boot-text {
  font-size: 13px;
  color: var(--fg-muted, #71717a);
}

.boot-progress {
  width: 160px;
  height: 3px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--fg-muted, #71717a) 16%, transparent);
  overflow: hidden;
}

.boot-progress-fill {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #ffbf48, #be4a1d);
  transition: width 0.35s var(--ease-out, ease);
}

/* Lightweight ring loader — avoids SVG feGaussianBlur jank on Windows. */
.loader {
  position: relative;
  width: 52px;
  height: 52px;
}

.loader-ring {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 2.5px solid color-mix(in srgb, #be4a1d 22%, transparent);
  border-top-color: #ffbf48;
  animation: boot-spin 0.75s linear infinite;
}

.loader-core {
  position: absolute;
  inset: 14px;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #ffbf48, #be4a1d);
  opacity: 0.9;
}

@keyframes boot-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .app-main-body,
  .loader-ring,
  .boot-fade-enter-active,
  .boot-fade-leave-active {
    animation: none !important;
    transition: none !important;
  }
}
</style>
