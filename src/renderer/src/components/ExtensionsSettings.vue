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
  NTag,
  NText,
  useDialog,
  useMessage,
} from "naive-ui";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import { t } from "@renderer/i18n";

type PluginRow = {
  source: string;
  scope: "global" | "project";
  disabled: boolean;
  installedPath?: string;
  status: "loaded" | "installed" | "missing" | "disabled";
};

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const workspace = useWorkspaceStore();
const message = useMessage();
const dialog = useDialog();
const loading = ref(false);
const packages = ref<PluginRow[]>([]);
const selected = ref<string | null>(null);
const toggling = ref<string | null>(null);
const removing = ref(false);

function keyOf(p: PluginRow): string {
  return `${p.scope}\0${p.source}`;
}

const selectedPkg = () => packages.value.find((p) => keyOf(p) === selected.value) ?? null;

async function load(): Promise<void> {
  loading.value = true;
  try {
    const data = await window.api.plugins.list(workspace.root ?? undefined);
    packages.value = data.packages;
    if (!selected.value && packages.value.length) {
      selected.value = keyOf(packages.value[0]);
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

async function onToggle(pkg: PluginRow, enabled: boolean): Promise<void> {
  toggling.value = keyOf(pkg);
  try {
    const data = await window.api.plugins.setEnabled(
      pkg.source,
      pkg.scope,
      enabled,
      workspace.root ?? undefined,
    );
    packages.value = data.packages;
    message.success(enabled ? t.extensionEnabled : t.extensionDisabled);
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  } finally {
    toggling.value = null;
  }
}

function statusType(status: PluginRow["status"]): "default" | "success" | "warning" | "error" {
  switch (status) {
    case "loaded":
    case "installed":
      return "success";
    case "disabled":
      return "warning";
    case "missing":
      return "error";
    default: {
      const _never: never = status;
      return _never;
    }
  }
}

function onRemove(pkg: PluginRow): void {
  const d = dialog.warning({
    title: t.extensionUninstallTitle,
    content: t.extensionUninstallConfirm(pkg.source, pkg.scope),
    positiveText: t.uninstall,
    negativeText: t.cancel,
    onPositiveClick: () => {
      d.loading = true;
      removing.value = true;
      return (async () => {
        try {
          const data = await window.api.plugins.remove(
            pkg.source,
            pkg.scope,
            workspace.root ?? undefined,
          );
          packages.value = data.packages;
          selected.value = packages.value[0] ? keyOf(packages.value[0]) : null;
          message.success(t.extensionUninstalled);
        } catch (err) {
          message.error(err instanceof Error ? err.message : String(err));
          d.loading = false;
          return false;
        } finally {
          removing.value = false;
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
    :title="t.extensionsTitle"
    class="pi-settings-modal"
    style="width: min(860px, 94vw)"
    :bordered="false"
    @update:show="(v) => !v && emit('close')"
  >
    <template #header-extra>
      <NText depth="3" style="font-size: 11px">pi packages</NText>
    </template>

    <div class="modal-body">
      <NSpin :show="loading" class="spin-fill">
        <div class="layout">
          <NScrollbar class="left">
            <NEmpty v-if="!packages.length" :description="t.extensionsEmpty" style="padding: 24px" />
            <button
              v-for="pkg in packages"
              :key="keyOf(pkg)"
              type="button"
              class="row"
              :class="{ active: selected === keyOf(pkg) }"
              @click="selected = keyOf(pkg)"
            >
              <div class="name">{{ pkg.source }}</div>
              <NText depth="3" style="font-size: 11px">{{ pkg.scope }}</NText>
            </button>
          </NScrollbar>

          <NScrollbar class="right">
            <template v-if="selectedPkg()">
              <div class="head">
                <div>
                  <div class="title">{{ selectedPkg()!.source }}</div>
                  <NSpace :size="8" style="margin-top: 4px">
                    <NTag size="tiny" :type="statusType(selectedPkg()!.status)" :bordered="false">
                      {{ selectedPkg()!.status }}
                    </NTag>
                    <NTag size="tiny" :bordered="false">{{ selectedPkg()!.scope }}</NTag>
                  </NSpace>
                </div>
                <NSpace align="center">
                  <NText style="font-size: 12px">{{ t.enable }}</NText>
                  <NSwitch
                    :value="!selectedPkg()!.disabled"
                    :loading="toggling === keyOf(selectedPkg()!)"
                    @update:value="(v) => onToggle(selectedPkg()!, v)"
                  />
                </NSpace>
              </div>
              <NText v-if="selectedPkg()!.installedPath" depth="3" style="font-size: 12px">
                {{ selectedPkg()!.installedPath }}
              </NText>
              <NText depth="3" style="display: block; margin-top: 12px; font-size: 12px">
                {{ t.extensionsHint }}
              </NText>
              <NText depth="3" style="display: block; margin-top: 8px; font-size: 11.5px; line-height: 1.5">
                {{ t.extensionsCapabilitiesNote }}
              </NText>
              <div class="danger">
                <NButton
                  size="small"
                  type="error"
                  secondary
                  :loading="removing"
                  @click="onRemove(selectedPkg()!)"
                >
                  {{ t.extensionUninstall }}
                </NButton>
              </div>
            </template>
            <NEmpty v-else :description="t.extensionSelect" />
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
  grid-template-columns: 260px 1fr;
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
  word-break: break-all;
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
  align-items: flex-start;
  margin-bottom: 10px;
  gap: 12px;
}
.title {
  font-size: 14px;
  font-weight: 600;
  word-break: break-all;
}
.danger {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}
</style>
