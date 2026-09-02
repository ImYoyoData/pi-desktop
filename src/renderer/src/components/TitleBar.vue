<script setup lang="ts">
import { computed, defineAsyncComponent, h, onMounted, onUnmounted, ref } from "vue";
import type { DropdownOption } from "naive-ui";
import { NButton, NDropdown, NIcon, NSpace } from "naive-ui";
import {
  ArrowUpCircleOutline,
  ColorPaletteOutline,
  ExtensionPuzzleOutline,
  FolderOpenOutline,
  InformationCircleOutline,
  LogoGithub,
  MicOutline,
  MoonOutline,
  NotificationsOutline,
  SettingsOutline,
  ShieldCheckmarkOutline,
  SparklesOutline,
  StorefrontOutline,
  SunnyOutline,
} from "@vicons/ionicons5";
import PanelLeftIcon from "@renderer/components/icons/PanelLeftIcon.vue";
import LanRemoteIcon from "@renderer/components/icons/LanRemoteIcon.vue";
import PanelRightIcon from "@renderer/components/icons/PanelRightIcon.vue";

/**
 * Settings modals are only opened on demand — load their code lazily so
 * startup stays light on slower CPUs.
 */
const ModelsSettings = defineAsyncComponent(() => import("@renderer/components/ModelsSettings.vue"));
const SkillsSettings = defineAsyncComponent(() => import("@renderer/components/SkillsSettings.vue"));
const ExtensionsSettings = defineAsyncComponent(() => import("@renderer/components/ExtensionsSettings.vue"));
const MarketSettings = defineAsyncComponent(() => import("@renderer/components/MarketSettings.vue"));
const AppearanceSettings = defineAsyncComponent(() => import("@renderer/components/AppearanceSettings.vue"));
const NotifySettings = defineAsyncComponent(() => import("@renderer/components/NotifySettings.vue"));
const AsrSettings = defineAsyncComponent(() => import("@renderer/components/AsrSettings.vue"));
const SecuritySettings = defineAsyncComponent(() => import("@renderer/components/SecuritySettings.vue"));
const AboutSettings = defineAsyncComponent(() => import("@renderer/components/AboutSettings.vue"));
const LanConsoleSettings = defineAsyncComponent(() => import("@renderer/components/LanConsoleSettings.vue"));

import UpdateCard from "@renderer/components/UpdateCard.vue";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import { useAppearanceStore } from "@renderer/stores/appearance";
import { useUpdateStore } from "@renderer/stores/update";
import { useLayoutStore } from "@renderer/stores/layout";
import { t } from "@renderer/i18n";
import logoUrl from "@renderer/assets/logo.svg";

const workspace = useWorkspaceStore();
const appearance = useAppearanceStore();
const updateStore = useUpdateStore();
const layout = useLayoutStore();
const modelsOpen = ref(false);
const skillsOpen = ref(false);
const extensionsOpen = ref(false);
const marketOpen = ref(false);
const appearanceOpen = ref(false);
const notifyOpen = ref(false);
const asrOpen = ref(false);
const securityOpen = ref(false);
const aboutOpen = ref(false);
const lanConsoleOpen = ref(false);
const lanConsoleEnabled = ref(false);

async function refreshLanConsoleStatus(): Promise<void> {
  try {
    lanConsoleEnabled.value = (await window.api.lanConsole.getStatus()).enabled;
  } catch {
    lanConsoleEnabled.value = false;
  }
}
const platform = ref<NodeJS.Platform>("win32");
const isMaximized = ref(false);
let offUpdateProgress: (() => void) | undefined;
let offMaximized: (() => void) | undefined;
let offUnmaximized: (() => void) | undefined;

async function onMinimize(): Promise<void> {
  await window.api.window.minimize();
}

async function onMaximize(): Promise<void> {
  await window.api.window.maximize();
}

async function onClose(): Promise<void> {
  await window.api.window.close();
}

onMounted(async () => {
  void refreshLanConsoleStatus();
  platform.value = await window.api.window.platform();
  if (platform.value !== "darwin") {
    isMaximized.value = await window.api.window.isMaximized();
    offMaximized = window.api.window.onMaximized(() => {
      isMaximized.value = true;
    });
    offUnmaximized = window.api.window.onUnmaximized(() => {
      isMaximized.value = false;
    });
  }
  offUpdateProgress = window.api.update.onProgress((p) => {
    updateStore.onProgress(p);
  });
  // Silent startup check — red badge only when an update exists.
  void updateStore.checkOnStartup();
});

onUnmounted(() => {
  offUpdateProgress?.();
  offMaximized?.();
  offUnmaximized?.();
});

function openFolder(): void {
  void workspace.openWorkspace();
}

const settingsOptions: DropdownOption[] = [
  {
    label: t.appearance,
    key: "appearance",
    icon: () => h(NIcon, null, { default: () => h(ColorPaletteOutline) }),
  },
  {
    label: t.notifyTitle,
    key: "notify",
    icon: () => h(NIcon, null, { default: () => h(NotificationsOutline) }),
  },
  {
    label: t.voiceTitle,
    key: "asr",
    icon: () => h(NIcon, null, { default: () => h(MicOutline) }),
  },
  {
    label: t.securityTitle,
    key: "security",
    icon: () => h(NIcon, null, { default: () => h(ShieldCheckmarkOutline) }),
  },
  {
    label: t.modelsMenu,
    key: "models",
    icon: () => h(NIcon, null, { default: () => h(SettingsOutline) }),
  },
  {
    label: t.skillsTitle,
    key: "skills",
    icon: () => h(NIcon, null, { default: () => h(SparklesOutline) }),
  },
  {
    label: t.extensionsTitle,
    key: "extensions",
    icon: () => h(NIcon, null, { default: () => h(ExtensionPuzzleOutline) }),
  },
  {
    label: t.marketTitle,
    key: "market",
    icon: () => h(NIcon, null, { default: () => h(StorefrontOutline) }),
  },
  {
    type: "divider",
    key: "d-about",
  },
  {
    label: t.aboutTitle,
    key: "about",
    icon: () => h(NIcon, null, { default: () => h(InformationCircleOutline) }),
  },
];

function onSettingsSelect(key: string | number): void {
  switch (String(key)) {
    case "appearance":
      appearanceOpen.value = true;
      break;
    case "notify":
      notifyOpen.value = true;
      break;
    case "asr":
      asrOpen.value = true;
      break;
    case "security":
      securityOpen.value = true;
      break;
    case "models":
      modelsOpen.value = true;
      break;
    case "skills":
      skillsOpen.value = true;
      break;
    case "extensions":
      extensionsOpen.value = true;
      break;
    case "market":
      marketOpen.value = true;
      break;
    case "about":
      aboutOpen.value = true;
      break;
    default:
      break;
  }
}

function cycleTheme(): void {
  const order = ["system", "light", "dark"] as const;
  const idx = order.indexOf(appearance.themePreference);
  appearance.setThemePreference(order[(idx + 1) % order.length]);
}

const themeIcon = computed(() => {
  if (appearance.themePreference === "light") return SunnyOutline;
  if (appearance.themePreference === "dark") return MoonOutline;
  return ColorPaletteOutline;
});

async function openGithub(): Promise<void> {
  await window.api.update.openGithub();
}

async function onUpdateClick(): Promise<void> {
  await updateStore.openUpdateCard();
}
</script>

<template>
  <header
    class="title-bar"
    :class="{ mac: platform === 'darwin', win: platform !== 'darwin' }"
  >
    <div class="drag traffic-space" aria-hidden="true" />
    <div class="brand">
      <img class="logo-img" :src="logoUrl" alt="" width="18" height="18" />
      <span class="name">{{ t.appName }}</span>
    </div>
    <NButton
      v-if="workspace.root && layout.leftCollapsed"
      class="pane-toggle no-drag"
      quaternary
      circle
      size="small"
      :title="t.expandLeft"
      :aria-label="t.expandLeft"
      @click="layout.toggleLeftCollapsed()"
    >
      <template #icon>
        <PanelLeftIcon :size="16" />
      </template>
    </NButton>
    <div class="center drag" />
    <div class="actions no-drag">
      <NSpace :size="4">
        <NButton
          class="update-btn"
          quaternary
          circle
          size="small"
          :loading="updateStore.checking && !updateStore.modalOpen"
          :title="t.checkUpdate"
          @click="onUpdateClick"
        >
          <template #icon>
            <NIcon :component="ArrowUpCircleOutline" />
          </template>
          <span v-if="updateStore.available" class="update-dot" aria-hidden="true" />
        </NButton>
    <NPopover
      trigger="click"
      placement="bottom-end"
      :show="lanConsoleOpen"
      :width="360"
      :show-arrow="false"
      style="padding: 0"
      @update:show="(v) => (lanConsoleOpen = v)"
    >
      <template #trigger>
        <NButton
          class="no-drag"
          quaternary
          circle
          size="small"
          :title="t.lanConsoleTitle"
          :aria-label="t.lanConsoleTitle"
          @click.stop="
            lanConsoleOpen = true;
            void refreshLanConsoleStatus();
          "
        >
          <template #icon>
            <LanRemoteIcon :size="16" />
          </template>
          <span
            v-if="lanConsoleEnabled"
            class="lan-console-dot"
            :title="t.lanConsoleOn"
          />
        </NButton>
      </template>
      <LanConsoleSettings @close="lanConsoleOpen = false" />
    </NPopover>
        <NButton quaternary circle size="small" @click="cycleTheme">
          <template #icon>
            <NIcon :component="themeIcon" />
          </template>
        </NButton>
        <NButton quaternary circle size="small" @click="openFolder">
          <template #icon>
            <NIcon :component="FolderOpenOutline" />
          </template>
        </NButton>
        <NButton quaternary circle size="small" @click="openGithub">
          <template #icon>
            <NIcon :component="LogoGithub" />
          </template>
        </NButton>
        <NDropdown trigger="click" :options="settingsOptions" @select="onSettingsSelect">
          <NButton quaternary circle size="small">
            <template #icon>
              <NIcon :component="SettingsOutline" />
            </template>
          </NButton>
        </NDropdown>
        <NButton
          v-if="workspace.root && layout.rightCollapsed"
          class="pane-toggle"
          quaternary
          circle
          size="small"
          :title="t.expandRight"
          :aria-label="t.expandRight"
          @click="layout.toggleRightCollapsed()"
        >
          <template #icon>
            <PanelRightIcon :size="16" />
          </template>
        </NButton>
      </NSpace>
    </div>
    <div v-if="platform !== 'darwin'" class="window-controls no-drag">
      <button type="button" class="wc-btn" :title="t.minimize" :aria-label="t.minimize" @click="onMinimize">
        <svg class="wc-icon minimize-icon" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <line x1="0.5" y1="5" x2="9.5" y2="5" stroke="currentColor" stroke-width="1" />
        </svg>
      </button>
      <button type="button" class="wc-btn" :title="isMaximized ? t.restore : t.maximize" :aria-label="isMaximized ? t.restore : t.maximize" @click="onMaximize">
        <svg v-if="!isMaximized" class="wc-icon maximize-icon" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1" />
        </svg>
        <svg v-else class="wc-icon restore-icon" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <rect x="2.5" y="2.5" width="7" height="7" fill="none" stroke="currentColor" stroke-width="1" />
          <rect x="0.5" y="0.5" width="7" height="7" fill="var(--wc-restore-fill, var(--bg-title))" stroke="currentColor" stroke-width="1" />
        </svg>
      </button>
      <button type="button" class="wc-btn close-btn" :title="t.close" :aria-label="t.close" @click="onClose">
        <svg class="wc-icon close-icon" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <line x1="0.5" y1="0.5" x2="9.5" y2="9.5" stroke="currentColor" stroke-width="1" />
          <line x1="9.5" y1="0.5" x2="0.5" y2="9.5" stroke="currentColor" stroke-width="1" />
        </svg>
      </button>
    </div>
  </header>
  <UpdateCard />
  <AppearanceSettings :open="appearanceOpen" @close="appearanceOpen = false" />
  <NotifySettings :open="notifyOpen" @close="notifyOpen = false" />
  <AsrSettings :open="asrOpen" @close="asrOpen = false" />
  <SecuritySettings :open="securityOpen" @close="securityOpen = false" />
  <ModelsSettings :open="modelsOpen" @close="modelsOpen = false" />
  <SkillsSettings :open="skillsOpen" @close="skillsOpen = false" />
  <ExtensionsSettings :open="extensionsOpen" @close="extensionsOpen = false" />
  <MarketSettings :open="marketOpen" @close="marketOpen = false" />
  <AboutSettings :open="aboutOpen" @close="aboutOpen = false" />
</template>

<style scoped>
.title-bar {
  display: flex;
  align-items: center;
  height: 36px;
  padding: 0 8px;
  background: color-mix(in srgb, var(--bg-title) 88%, var(--bg-elevated));
  border-bottom: 1px solid var(--border);
  color: var(--fg-muted);
  font-size: 12px;
  user-select: none;
  flex-shrink: 0;
  box-shadow: 0 1px 0 color-mix(in srgb, var(--bg-elevated) 40%, transparent);
  /* Whole bar is draggable; interactive children use .no-drag. */
  -webkit-app-region: drag;
}

.drag {
  -webkit-app-region: drag;
}

.no-drag {
  -webkit-app-region: no-drag;
}

.traffic-space {
  width: 0;
  flex-shrink: 0;
}

.title-bar.mac .traffic-space {
  /* Leave room for traffic lights (hiddenInset + trafficLightPosition). */
  width: 72px;
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding-left: 4px;
  color: var(--fg-strong);
}

.pane-toggle {
  flex-shrink: 0;
  margin-left: 2px;
  color: var(--fg-muted) !important;
  transform: none !important;
}

.pane-toggle:active {
  transform: none !important;
}

.logo-img {
  width: 18px;
  height: 18px;
  border-radius: 5px;
  display: block;
  flex-shrink: 0;
}

.name {
  font-weight: 600;
  font-size: 12.5px;
  letter-spacing: -0.01em;
}

.center {
  flex: 1;
  min-width: 0;
}

.actions {
  display: flex;
  align-items: center;
}

.update-btn {
  position: relative;
  flex-shrink: 0;
  margin-right: 2px;
}

.update-dot {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #e5484d;
  box-shadow: 0 0 0 1.5px var(--bg-title, var(--bg));
  pointer-events: none;
}

.window-controls {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  height: 100%;
}

.wc-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 100%;
  margin: 0;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--fg-muted);
  cursor: pointer;
  -webkit-app-region: no-drag;
  transition: background 0.12s ease, color 0.12s ease;
}

.wc-btn:hover {
  background: var(--bg-hover, rgba(127, 127, 127, 0.1));
  color: var(--fg-strong);
}

.wc-btn.close-btn:hover {
  background: #e5484d;
  color: #fff;
}

.wc-icon {
  display: block;
  width: 10px;
  height: 10px;
  flex-shrink: 0;
}
/* LAN console titlebar entry (left, after the app name) - same visual
   language as the right-side titlebar buttons. */
.lan-console-dot {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #22c55e;
  box-shadow: 0 0 0 1.5px var(--bg-title, var(--bg));
}
</style>
