<script setup lang="ts">
import { computed, h, onMounted, onUnmounted, ref } from "vue";
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
import PanelRightIcon from "@renderer/components/icons/PanelRightIcon.vue";
import ModelsSettings from "@renderer/components/ModelsSettings.vue";
import SkillsSettings from "@renderer/components/SkillsSettings.vue";
import ExtensionsSettings from "@renderer/components/ExtensionsSettings.vue";
import MarketSettings from "@renderer/components/MarketSettings.vue";
import AppearanceSettings from "@renderer/components/AppearanceSettings.vue";
import NotifySettings from "@renderer/components/NotifySettings.vue";
import AsrSettings from "@renderer/components/AsrSettings.vue";
import SecuritySettings from "@renderer/components/SecuritySettings.vue";
import AboutSettings from "@renderer/components/AboutSettings.vue";
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
const platform = ref<NodeJS.Platform>("win32");
let offUpdateProgress: (() => void) | undefined;

onMounted(async () => {
  platform.value = await window.api.window.platform();
  offUpdateProgress = window.api.update.onProgress((p) => {
    updateStore.onProgress(p);
  });
  // Silent startup check — red badge only when an update exists.
  void updateStore.checkOnStartup();
});

onUnmounted(() => {
  offUpdateProgress?.();
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
    label: t.asrTitle,
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
    <div class="brand no-drag">
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
    <div v-if="platform !== 'darwin'" class="overlay-space" aria-hidden="true" />
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

.overlay-space {
  width: 138px;
  flex-shrink: 0;
}
</style>
