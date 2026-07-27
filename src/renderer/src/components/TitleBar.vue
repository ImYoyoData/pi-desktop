<script setup lang="ts">
import { computed, h, onMounted, onUnmounted, ref } from "vue";
import type { DropdownOption } from "naive-ui";
import { NButton, NDropdown, NIcon, NSpace, NTag, useMessage } from "naive-ui";
import {
  ArrowUpCircleOutline,
  ColorPaletteOutline,
  ExtensionPuzzleOutline,
  FolderOpenOutline,
  InformationCircleOutline,
  LogoGithub,
  MicOutline,
  MoonOutline,
  SettingsOutline,
  SparklesOutline,
  StorefrontOutline,
  SunnyOutline,
} from "@vicons/ionicons5";
import ModelsSettings from "@renderer/components/ModelsSettings.vue";
import SkillsSettings from "@renderer/components/SkillsSettings.vue";
import ExtensionsSettings from "@renderer/components/ExtensionsSettings.vue";
import MarketSettings from "@renderer/components/MarketSettings.vue";
import AppearanceSettings from "@renderer/components/AppearanceSettings.vue";
import AsrSettings from "@renderer/components/AsrSettings.vue";
import AboutSettings from "@renderer/components/AboutSettings.vue";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import { useAppearanceStore } from "@renderer/stores/appearance";
import { t } from "@renderer/i18n";
import logoUrl from "@renderer/assets/logo.svg";

const AUTO_CHECK_KEY = "pi-desktop:last-update-check";
const AUTO_CHECK_MS = 24 * 60 * 60 * 1000;

const workspace = useWorkspaceStore();
const appearance = useAppearanceStore();
const messageApi = useMessage();
const modelsOpen = ref(false);
const skillsOpen = ref(false);
const extensionsOpen = ref(false);
const marketOpen = ref(false);
const appearanceOpen = ref(false);
const asrOpen = ref(false);
const aboutOpen = ref(false);
const platform = ref<NodeJS.Platform>("win32");
const updateBusy = ref(false);
let offUpdateProgress: (() => void) | undefined;

onMounted(async () => {
  platform.value = await window.api.window.platform();
  // No loading toasts for update progress — button :loading is enough; sticky duration:0 toasts never clear reliably.
  offUpdateProgress = window.api.update.onProgress((p) => {
    if (p.phase === "error") {
      messageApi.error(p.message, { duration: 5000 });
    }
  });
  void maybeAutoCheckUpdate();
});

onUnmounted(() => {
  offUpdateProgress?.();
});

function openFolder(): void {
  void workspace.openWorkspace();
}

function basename(p: string | null): string {
  if (!p) return t.noFolder;
  const parts = p.replace(/\\/g, "/").split("/");
  return parts.filter(Boolean).pop() ?? p;
}

const settingsOptions: DropdownOption[] = [
  {
    label: t.appearance,
    key: "appearance",
    icon: () => h(NIcon, null, { default: () => h(ColorPaletteOutline) }),
  },
  {
    label: t.asrTitle,
    key: "asr",
    icon: () => h(NIcon, null, { default: () => h(MicOutline) }),
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
    case "asr":
      asrOpen.value = true;
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

async function runUpdateCheck(opts: { download: boolean; silent: boolean }): Promise<void> {
  if (updateBusy.value) return;
  updateBusy.value = true;
  try {
    const result = await window.api.update.check({ download: opts.download });
    try {
      localStorage.setItem(AUTO_CHECK_KEY, String(Date.now()));
    } catch {
      // ignore
    }
    if (result.status === "upToDate") {
      if (!opts.silent) {
        messageApi.success(result.message, { duration: 3000 });
      }
      return;
    }
    if (result.status === "downloaded") {
      messageApi.success(result.message, { duration: 6000 });
      return;
    }
    if (result.status === "openedBrowser" || result.status === "available") {
      messageApi.info(result.message, { duration: 5000 });
      return;
    }
    if (!opts.silent) {
      messageApi.error(result.message, { duration: 5000 });
    }
  } catch (err) {
    if (!opts.silent) {
      messageApi.error(err instanceof Error ? err.message : String(err), { duration: 5000 });
    }
  } finally {
    updateBusy.value = false;
  }
}

async function onCheckUpdate(): Promise<void> {
  await runUpdateCheck({ download: true, silent: false });
}

async function maybeAutoCheckUpdate(): Promise<void> {
  try {
    const raw = localStorage.getItem(AUTO_CHECK_KEY);
    const last = raw ? Number(raw) : 0;
    if (Number.isFinite(last) && Date.now() - last < AUTO_CHECK_MS) return;
  } catch {
    // ignore
  }
  // Silent: only notify when an update / browser open / error with useful message
  await runUpdateCheck({ download: true, silent: true });
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
    <div class="center drag">
      <NTag
        v-if="workspace.root"
        class="no-drag workspace-chip"
        size="small"
        round
        :bordered="true"
        style="cursor: pointer; max-width: 280px"
        :title="workspace.root"
        @click="openFolder"
      >
        <template #icon>
          <NIcon :component="FolderOpenOutline" :size="14" />
        </template>
        {{ basename(workspace.root) }}
      </NTag>
    </div>
    <div class="actions no-drag">
      <NSpace :size="4">
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
        <NButton
          quaternary
          circle
          size="small"
          :loading="updateBusy"
          :disabled="updateBusy"
          @click="onCheckUpdate"
        >
          <template #icon>
            <NIcon :component="ArrowUpCircleOutline" />
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
      </NSpace>
    </div>
    <div v-if="platform !== 'darwin'" class="overlay-space" aria-hidden="true" />
  </header>
  <AppearanceSettings :open="appearanceOpen" @close="appearanceOpen = false" />
  <AsrSettings :open="asrOpen" @close="asrOpen = false" />
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
  background: var(--bg-title);
  border-bottom: 1px solid var(--border);
  color: var(--fg-muted);
  font-size: 12px;
  user-select: none;
  flex-shrink: 0;
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
  width: 78px;
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding-left: 4px;
  color: var(--fg-strong);
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
  display: flex;
  justify-content: center;
  min-width: 0;
}

.actions {
  display: flex;
  align-items: center;
}

.overlay-space {
  width: 138px;
  flex-shrink: 0;
}
</style>
