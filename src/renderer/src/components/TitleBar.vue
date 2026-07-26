<script setup lang="ts">
import { h, onMounted, ref } from "vue";
import type { DropdownOption } from "naive-ui";
import { NButton, NDropdown, NIcon, NSpace, NTag, NTooltip } from "naive-ui";
import {
  ExtensionPuzzleOutline,
  FolderOpenOutline,
  SettingsOutline,
  SparklesOutline,
} from "@vicons/ionicons5";
import ModelsSettings from "@renderer/components/ModelsSettings.vue";
import SkillsSettings from "@renderer/components/SkillsSettings.vue";
import ExtensionsSettings from "@renderer/components/ExtensionsSettings.vue";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import { t } from "@renderer/i18n";

const workspace = useWorkspaceStore();
const modelsOpen = ref(false);
const skillsOpen = ref(false);
const extensionsOpen = ref(false);
const platform = ref<NodeJS.Platform>("win32");

onMounted(async () => {
  platform.value = await window.api.window.platform();
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
    label: "模型 / API Keys",
    key: "models",
    icon: () => h(NIcon, null, { default: () => h(SettingsOutline) }),
  },
  {
    label: "Skills",
    key: "skills",
    icon: () => h(NIcon, null, { default: () => h(SparklesOutline) }),
  },
  {
    label: "扩展 / Plugins",
    key: "extensions",
    icon: () => h(NIcon, null, { default: () => h(ExtensionPuzzleOutline) }),
  },
];

function onSettingsSelect(key: string | number): void {
  switch (String(key)) {
    case "models":
      modelsOpen.value = true;
      break;
    case "skills":
      skillsOpen.value = true;
      break;
    case "extensions":
      extensionsOpen.value = true;
      break;
    default:
      break;
  }
}
</script>

<template>
  <header
    class="title-bar"
    :class="{ mac: platform === 'darwin', win: platform !== 'darwin' }"
  >
    <div class="drag traffic-space" aria-hidden="true" />
    <div class="brand no-drag">
      <span class="logo">π</span>
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
        <NTooltip trigger="hover">
          <template #trigger>
            <NButton quaternary circle size="small" @click="openFolder">
              <template #icon>
                <NIcon :component="FolderOpenOutline" />
              </template>
            </NButton>
          </template>
          {{ t.openFolder }}
        </NTooltip>
        <NDropdown trigger="click" :options="settingsOptions" @select="onSettingsSelect">
          <NButton quaternary circle size="small" title="设置">
            <template #icon>
              <NIcon :component="SettingsOutline" />
            </template>
          </NButton>
        </NDropdown>
      </NSpace>
    </div>
    <div v-if="platform !== 'darwin'" class="overlay-space" aria-hidden="true" />
  </header>
  <ModelsSettings :open="modelsOpen" @close="modelsOpen = false" />
  <SkillsSettings :open="skillsOpen" @close="skillsOpen = false" />
  <ExtensionsSettings :open="extensionsOpen" @close="extensionsOpen = false" />
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
  width: 72px;
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding-left: 4px;
  color: var(--fg-strong);
}

.logo {
  width: 18px;
  height: 18px;
  display: grid;
  place-items: center;
  border-radius: 5px;
  background: #fff;
  border: 1px solid var(--border);
  font-size: 11px;
  font-weight: 700;
}

.name {
  font-weight: 550;
  font-size: 12px;
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
