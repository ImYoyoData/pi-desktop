<script setup lang="ts">
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

/** Heavy workspace chrome — load after first paint when a folder is open. */
const SplitRoot = defineAsyncComponent(() => import("@renderer/components/SplitRoot.vue"));

const workspace = useWorkspaceStore();
const appearance = useAppearanceStore();
/** True once workspace/platform init finished (drives the boot overlay). */
const bootInitDone = ref(false);
/**
 * True once a session worker finished loading its extensions/skills/tools;
 * the boot overlay waits for this so the app only appears fully ready.
 */
const bootResourcesReady = ref(false);
/**
 * Failsafe: some init steps (e.g. the trust prompt awaiting user input)
 * can take a while; never leave the boot overlay up forever.
 */
const BOOT_TIMEOUT_MS = 12000;
let bootTimer = 0;
let offWorkerReady: (() => void) | undefined;

const showBootOverlay = computed(
  () =>
    !bootInitDone.value ||
    (Boolean(workspace.root) && !bootResourcesReady.value),
);
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
  // Wait for the session worker's extensions/skills/tools before fading
  // the boot overlay (the overlay only covers the main area).
  offWorkerReady = window.api.sessions.onWorkerReady(() => {
    bootResourcesReady.value = true;
  });
  void window.api.window.setUiLocale(locale === "zh-CN" ? "zh-CN" : "en");
  // Instant open: drop the full-screen splash right after first paint so the
  // window feels instant; heavy workspace init runs behind an in-app boot
  // overlay that fades out when the content is ready (progressive loading).
  void dismissStartupSplash(true);
  bootTimer = window.setTimeout(() => {
    bootInitDone.value = true;
    bootResourcesReady.value = true;
  }, BOOT_TIMEOUT_MS);
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
      window.clearTimeout(bootTimer);
      await dismissLocaleReloadSplash();
      bootInitDone.value = true;
    }
  })();
});

onUnmounted(() => {
  window.clearTimeout(bootTimer);
  offWorkerReady?.();
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
            <Transition name="boot-fade">
              <div v-if="showBootOverlay" class="boot-overlay" role="status">
                <div class="loader" aria-hidden="true">
                  <div class="loader-inner">
                    <div class="blob b1"></div>
                    <div class="blob b2"></div>
                    <div class="blob b3"></div>
                    <div class="blob b4"></div>
                    <div class="blob b5"></div>
                  </div>
                </div>
                <div class="boot-text">{{ t.bootLoading }}</div>
              </div>
            </Transition>
            <template v-if="!showBootOverlay">
              <WelcomeView v-if="!workspace.root" />
              <SplitRoot v-else />
            </template>
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

.boot-overlay {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 22px;
  background: var(--bg);
}

.boot-fade-enter-active,
.boot-fade-leave-active {
  transition: opacity 0.45s ease;
}

.boot-fade-enter-from,
.boot-fade-leave-to {
  opacity: 0;
}

.boot-text {
  font-size: 13px;
  color: var(--fg-muted, #71717a);
}

/* Fluid blob loader */
.loader {
  --c1: #ffbf48;
  --c2: #be4a1d;
  --t: 2s;
  --size: 0.9;
  position: relative;
  width: 100px;
  height: 100px;
  border-radius: 50%;
  transform: scale(var(--size));
  box-shadow:
    0 0 25px 0 #ffbf4780,
    0 20px 50px 0 #bf4a1d80;
  animation: colorize calc(var(--t) * 3) ease-in-out infinite;
  overflow: hidden;
}

.loader::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border-top: 1px solid var(--c1);
  border-bottom: 1px solid var(--c2);
  background: linear-gradient(180deg, #ffbf4740, #bf4a1d80);
  box-shadow:
    inset 0 10px 10px 0 #ffbf4780,
    inset 0 -10px 10px 0 #bf4a1d80;
}

.loader-inner {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  overflow: hidden;
  -webkit-filter: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"><filter id="g"><feGaussianBlur in="SourceGraphic" stdDeviation="5"/><feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -9"/></filter></svg>#g');
  filter: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"><filter id="g"><feGaussianBlur in="SourceGraphic" stdDeviation="5"/><feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -9"/></filter></svg>#g');
}

.blob {
  position: absolute;
  border-radius: 42%;
  background: linear-gradient(180deg, var(--c1) 30%, var(--c2) 70%);
}

.b1 {
  width: 44px;
  height: 44px;
  top: 12px;
  left: 28px;
  transform-origin: 50% 130%;
  animation: spin var(--t) linear infinite reverse;
}

.b2 {
  width: 40px;
  height: 40px;
  top: 18px;
  left: 30px;
  transform-origin: 50% -30%;
  animation: spin var(--t) linear infinite;
  animation-delay: calc(var(--t) / -3);
}

.b3 {
  width: 30px;
  height: 30px;
  top: 28px;
  left: 35px;
  transform-origin: -30% -10%;
  animation: spin var(--t) linear infinite reverse;
}

.b4 {
  width: 28px;
  height: 28px;
  top: 30px;
  left: 36px;
  transform-origin: -30% -10%;
  animation: spin var(--t) linear infinite reverse;
  animation-delay: calc(var(--t) / -2);
}

.b5 {
  width: 30px;
  height: 30px;
  top: 28px;
  left: 35px;
  transform-origin: 130% -10%;
  animation: spin var(--t) linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes colorize {
  0% {
    filter: hue-rotate(0deg);
  }
  20% {
    filter: hue-rotate(-30deg);
  }
  40% {
    filter: hue-rotate(-60deg);
  }
  60% {
    filter: hue-rotate(-90deg);
  }
  80% {
    filter: hue-rotate(-45deg);
  }
  100% {
    filter: hue-rotate(0deg);
  }
}
</style>
