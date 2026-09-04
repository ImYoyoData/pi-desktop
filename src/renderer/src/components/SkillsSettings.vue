<script setup lang="ts">
import { ref, watch } from "vue";
import {
  NButton,
  NEmpty,
  NModal,
  NScrollbar,
  NSpace,
  NSpin,
  NSwitch,
  NText,
  useDialog,
  useMessage,
} from "naive-ui";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import { t } from "@renderer/i18n";

type SkillRow = {
  name: string;
  description: string;
  filePath: string;
  source: string;
  scope: string;
  disableModelInvocation: boolean;
};

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const workspace = useWorkspaceStore();
const message = useMessage();
const dialog = useDialog();
const loading = ref(false);
const skills = ref<SkillRow[]>([]);
const selected = ref<string | null>(null);
const toggling = ref<string | null>(null);
const uninstalling = ref(false);

const selectedSkill = () => skills.value.find((s) => s.filePath === selected.value) ?? null;

async function load(): Promise<void> {
  loading.value = true;
  try {
    const data = await window.api.skills.list(workspace.root ?? undefined);
    skills.value = data.skills;
    if (!selected.value && skills.value.length) {
      selected.value = skills.value[0].filePath;
    }
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  } finally {
    loading.value = false;
  }
}

watch(
  () => props.open,
  (v) => {
    if (v) void load();
  },
);

async function onToggle(skill: SkillRow, enabled: boolean): Promise<void> {
  toggling.value = skill.filePath;
  try {
    await window.api.skills.setDisabled(skill.filePath, !enabled);
    skill.disableModelInvocation = !enabled;
    message.success(enabled ? t.skillEnabled : t.skillDisabledManual);
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  } finally {
    toggling.value = null;
  }
}

function sourceLabel(skill: SkillRow): string {
  if (skill.scope === "project" || skill.source === "project") return "project";
  if (skill.scope === "user" || skill.source === "user") return "global";
  return skill.source || "path";
}

function canUninstall(skill: SkillRow): boolean {
  const scope = skill.scope || skill.source;
  return scope === "user" || scope === "global" || scope === "project" || scope === "path";
}

function onUninstall(skill: SkillRow): void {
  const d = dialog.warning({
    title: t.skillUninstallTitle,
    content: t.skillUninstallConfirm(skill.name),
    positiveText: t.uninstall,
    negativeText: t.cancel,
    onPositiveClick: () => {
      d.loading = true;
      uninstalling.value = true;
      return (async () => {
        try {
          await window.api.skills.uninstall(skill.filePath, workspace.root ?? undefined);
          message.success(t.skillUninstalled);
          if (selected.value === skill.filePath) selected.value = null;
          await load();
          return true;
        } catch (err) {
          message.error(err instanceof Error ? err.message : String(err));
          d.loading = false;
          return false;
        } finally {
          uninstalling.value = false;
        }
      })();
    },
  });
}
</script>

<template>
  <NModal
    :show="open"
    preset="card"
    :title="t.skillsTitle"
    class="pi-settings-modal"
    style="width: min(860px, 94vw)"
    :bordered="false"
    @update:show="(v) => !v && emit('close')"
  >
    <template #header-extra>
      <NText depth="3" style="font-size: 11px">{{ workspace.root ?? "~/.pi/agent" }}</NText>
    </template>

    <div class="modal-body">
      <NSpin :show="loading" class="spin-fill">
        <div class="layout">
          <NScrollbar class="left">
            <NEmpty v-if="!skills.length" :description="t.skillsEmpty" style="padding: 24px" />
            <button
              v-for="skill in skills"
              :key="skill.filePath"
              type="button"
              class="row"
              :class="{ active: selected === skill.filePath }"
              @click="selected = skill.filePath"
            >
              <div class="name">{{ skill.name }}</div>
              <NText depth="3" style="font-size: 11px">{{ sourceLabel(skill) }}</NText>
            </button>
          </NScrollbar>

          <NScrollbar class="right">
            <template v-if="selectedSkill()">
              <div class="head">
                <div>
                  <div class="title">{{ selectedSkill()!.name }}</div>
                  <NText depth="3" style="font-size: 12px">{{ sourceLabel(selectedSkill()!) }}</NText>
                </div>
                <NSpace align="center">
                  <NText style="font-size: 12px">{{ t.enable }}</NText>
                  <NSwitch
                    :value="!selectedSkill()!.disableModelInvocation"
                    :loading="toggling === selectedSkill()!.filePath"
                    @update:value="(v) => onToggle(selectedSkill()!, v)"
                  />
                </NSpace>
              </div>
              <NText depth="3" style="font-size: 12px; display: block; margin-bottom: 10px">
                {{ selectedSkill()!.filePath }}
              </NText>
              <p class="desc">{{ selectedSkill()!.description }}</p>
              <div v-if="canUninstall(selectedSkill()!)" class="danger">
                <NButton
                  size="small"
                  type="error"
                  secondary
                  :loading="uninstalling"
                  @click="onUninstall(selectedSkill()!)"
                >
                  {{ t.skillUninstall }}
                </NButton>
              </div>
            </template>
            <NEmpty v-else :description="t.skillSelect" />
          </NScrollbar>
        </div>
      </NSpin>
    </div>

    <template #footer>
      <NSpace justify="end">
        <NButton size="small" @click="emit('close')">{{ t.close }}</NButton>
      </NSpace>
    </template>
  </NModal>
</template>

<style scoped>
.modal-body {
  height: min(480px, 65vh);
  overflow: hidden;
}
.spin-fill {
  height: 100%;
}
.spin-fill :deep(.n-spin-content) {
  height: 100%;
}
.layout {
  display: grid;
  grid-template-columns: 240px 1fr;
  height: 100%;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}
.left {
  height: 100%;
  border-right: 1px solid var(--border);
  background: var(--bg-panel);
}
.row {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border: none;
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.row:hover {
  background: var(--bg-hover);
}
.row.active {
  background: var(--bg-selected);
}
.name {
  font-size: 12.5px;
  font-weight: 550;
}
.right {
  height: 100%;
  padding: 20px 24px 24px;
  box-sizing: border-box;
  overflow: auto;
}
.head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  gap: 8px;
}
.title {
  font-size: 14px;
  font-weight: 600;
}
.desc {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--fg);
  white-space: pre-wrap;
}
.danger {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}
</style>
