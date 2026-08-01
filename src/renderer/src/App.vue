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
import { locale } from "@renderer/i18n";
import { dismissLocaleReloadSplash } from "@renderer/utils/locale-reload-splash";
import { dismissStartupSplash } from "@renderer/utils/startup-splash";

/** Heavy workspace chrome — load after first paint when a folder is open. */
const SplitRoot = defineAsyncComponent(() => import("@renderer/components/SplitRoot.vue"));

const workspace = useWorkspaceStore();
const appearance = useAppearanceStore();
/** True once workspace/platform init finished (drives the boot overlay). */
const booted = ref(false);
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
  // Instant open: drop the full-screen splash right after first paint so the
  // window feels instant; heavy workspace init runs behind an in-app boot
  // overlay that fades out when the content is ready (progressive loading).
  void dismissStartupSplash(true);
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
      await dismissLocaleReloadSplash();
      booted.value = true;
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
            <div v-if="!booted" class="boot-overlay" role="status">
              <div class="boot-mark" aria-hidden="true">
                <svg viewBox="0 0 800 800" xmlns="http://www.w3.org/2000/svg">
                  <rect width="800" height="800" rx="120" fill="#09090b"/>
                  <path fill="#fff" fill-rule="evenodd" d="M165.29 165.29 H517.36 V400 H400 V517.36 H282.65 V634.72 H165.29 Z M282.65 282.65 V400 H400 V282.65 Z"/>
                  <path fill="#fff" d="M517.36 400 H634.72 V634.72 H517.36 Z"/>
                </svg>
              </div>
              <div class="boot-text">{{ t.bootLoading }}</div>
            </div>
            <template v-else>
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
  gap: 14px;
  background: var(--bg);
  animation: boot-fade-in 180ms ease;
}

.boot-mark {
  width: 46px;
  height: 46px;
  border-radius: 12px;
  background: #09090b;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.16);
  animation: boot-breathe 1.6s ease-in-out infinite;
}

.boot-mark svg {
  width: 28px;
  height: 28px;
}

.boot-text {
  font-size: 13px;
  color: var(--fg-muted, #71717a);
}

@keyframes boot-fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes boot-breathe {
  0%,
  100% {
    opacity: 0.85;
    transform: scale(0.98);
  }
  50% {
    opacity: 1;
    transform: scale(1);
  }
}
</style>
