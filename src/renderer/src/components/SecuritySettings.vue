<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  NModal,
  NRadioGroup,
  NRadioButton,
  NSpace,
  NText,
  NButton,
  NDivider,
  NDynamicTags,
  useMessage,
} from "naive-ui";
import {
  bashAllowlistEntryFromCommand,
  DEFAULT_DESKTOP_SECURITY,
  normalizeSecurityPathKey,
  type DesktopSecuritySettings,
  type SecurityMode,
  type WorkspaceToolPermissions,
} from "../../../shared/desktop-security";
import type { TrustState } from "../../../shared/protocol";
import { toIpcPlain } from "../../../shared/protocol";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import { t } from "@renderer/i18n";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const workspace = useWorkspaceStore();
const message = useMessage();

const draft = ref<DesktopSecuritySettings>({
  ...DEFAULT_DESKTOP_SECURITY,
  bashAllowlist: [],
  workspacePermissions: {},
});
const trust = ref<TrustState | null>(null);
const trustedPaths = ref<string[]>([]);
const loading = ref(false);
const saving = ref(false);
const trustBusy = ref(false);

const modeOptions: { value: SecurityMode; label: string }[] = [
  { value: "ask", label: t.securityModeAsk },
  { value: "allow", label: t.securityModeAllow },
];

const trustStatusLabel = computed(() => {
  if (!workspace.root) return t.securityTrustNoWorkspace;
  if (!trust.value) return t.securityTrustUnknown;
  if (trust.value.projectTrusted) return t.securityTrustTrusted;
  if (trust.value.decision === false) return t.securityTrustUntrusted;
  return t.securityTrustPending;
});

const canChangeTrust = computed(() => Boolean(workspace.root));
const currentTrusted = computed(() => trust.value?.projectTrusted === true);

const workspacePermDraft = ref<WorkspaceToolPermissions>({
  bash: "ask",
  write: "ask",
});

function shortPath(p: string): string {
  const norm = p.replace(/\\/g, "/");
  const parts = norm.split("/").filter(Boolean);
  if (parts.length <= 2) return p;
  return `…/${parts.slice(-2).join("/")}`;
}

function syncWorkspacePermDraft(): void {
  const root = workspace.root;
  if (!root || !currentTrusted.value) {
    workspacePermDraft.value = { bash: "ask", write: "ask" };
    return;
  }
  const key = normalizeSecurityPathKey(root);
  // Prefer exact map entry; fall back to any key that normalizes equal.
  const hit =
    draft.value.workspacePermissions[key] ??
    Object.entries(draft.value.workspacePermissions).find(([k]) =>
      normalizeSecurityPathKey(k) === key,
    )?.[1];
  workspacePermDraft.value = hit
    ? { ...hit }
    : { bash: draft.value.bash, write: draft.value.write };
}

async function loadTrust(): Promise<void> {
  const cwd = workspace.root;
  if (!cwd) {
    trust.value = null;
    return;
  }
  trust.value = await window.api.trust.get(cwd);
}

async function loadTrustedList(): Promise<void> {
  try {
    trustedPaths.value = await window.api.trust.listTrusted();
  } catch {
    trustedPaths.value = [];
  }
}

async function loadSettings(): Promise<void> {
  loading.value = true;
  try {
    const next = await window.api.security.get();
    draft.value = {
      bash: next.bash,
      write: next.write,
      bashAllowlist: [...next.bashAllowlist],
      workspacePermissions: { ...(next.workspacePermissions ?? {}) },
    };
    await loadTrust();
    await loadTrustedList();
    syncWorkspacePermDraft();
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  } finally {
    loading.value = false;
  }
}

function setGlobalModes(mode: SecurityMode): void {
  draft.value = {
    ...draft.value,
    bash: mode,
    write: mode,
  };
}

function setWorkspaceModes(mode: SecurityMode): void {
  workspacePermDraft.value = { bash: mode, write: mode };
}

async function onTrust(trusted: boolean): Promise<void> {
  const cwd = workspace.root;
  if (!cwd || trustBusy.value) return;
  trustBusy.value = true;
  try {
    await window.api.trust.set(cwd, trusted);
    if (!trusted) {
      // Drop override for this path when untrusting.
      const key = normalizeSecurityPathKey(cwd);
      const nextMap = { ...draft.value.workspacePermissions };
      for (const k of Object.keys(nextMap)) {
        if (normalizeSecurityPathKey(k) === key) delete nextMap[k];
      }
      draft.value = { ...draft.value, workspacePermissions: nextMap };
      await window.api.security.set(draft.value);
      await workspace.clearWorkspace();
      message.success(t.securityTrustSetUntrustedClosed);
      emit("close");
      return;
    }
    await loadTrust();
    await loadTrustedList();
    syncWorkspacePermDraft();
    message.success(t.securityTrustSetTrusted);
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  } finally {
    trustBusy.value = false;
  }
}

async function onSave(): Promise<void> {
  if (saving.value) return;
  saving.value = true;
  try {
    const workspacePermissions = { ...draft.value.workspacePermissions };
    const root = workspace.root;
    if (root && currentTrusted.value) {
      const key = normalizeSecurityPathKey(root);
      // Remove any duplicate keys that fold to the same path.
      for (const k of Object.keys(workspacePermissions)) {
        if (normalizeSecurityPathKey(k) === key) delete workspacePermissions[k];
      }
      workspacePermissions[key] = {
        bash: workspacePermDraft.value.bash,
        write: workspacePermDraft.value.write,
      };
    }

    const payload: DesktopSecuritySettings = {
      bash: draft.value.bash,
      write: draft.value.write,
      bashAllowlist: [
        ...new Set(
          draft.value.bashAllowlist
            .map((s) => bashAllowlistEntryFromCommand(s) || s.trim())
            .filter((s) => s.length > 0),
        ),
      ],
      workspacePermissions,
    };
    await window.api.security.set(toIpcPlain(payload));
    draft.value = {
      ...payload,
      bashAllowlist: [...payload.bashAllowlist],
      workspacePermissions: { ...payload.workspacePermissions },
    };
    syncWorkspacePermDraft();
    message.success(t.saved);
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  } finally {
    saving.value = false;
  }
}

watch(
  () => props.open,
  (open) => {
    if (open) void loadSettings();
  },
);

watch(
  () => workspace.root,
  () => {
    if (props.open) {
      void loadTrust().then(() => syncWorkspacePermDraft());
      void loadTrustedList();
    }
  },
);
</script>

<template>
  <NModal
    :show="props.open"
    preset="card"
    class="pi-settings-modal security-modal"
    style="width: min(520px, 92vw)"
    :title="t.securityTitle"
    :bordered="false"
    size="medium"
    @update:show="(v) => !v && emit('close')"
  >
    <div class="section">
      <div class="section-head">
        <NText strong class="section-title">{{ t.securityTrustSection }}</NText>
        <NText depth="3" class="hint">{{ t.securityTrustHint }}</NText>
      </div>
      <NText
        v-if="workspace.root"
        depth="3"
        class="path"
      >
        {{ workspace.root }}
      </NText>
      <div class="row">
        <NText class="status">{{ trustStatusLabel }}</NText>
        <NSpace :size="6">
          <NButton
            size="tiny"
            type="primary"
            :disabled="!canChangeTrust || trust?.projectTrusted === true"
            :loading="trustBusy"
            @click="onTrust(true)"
          >
            {{ t.securityTrustAction }}
          </NButton>
          <NButton
            size="tiny"
            :disabled="!canChangeTrust || trust?.decision === false"
            :loading="trustBusy"
            @click="onTrust(false)"
          >
            {{ t.securityUntrustAction }}
          </NButton>
        </NSpace>
      </div>
    </div>

    <NDivider class="div" />

    <div v-if="currentTrusted && workspace.root" class="section">
      <div class="section-head">
        <NText strong class="section-title">{{ t.securityWorkspacePermissionsSection }}</NText>
        <NText depth="3" class="hint">{{ t.securityWorkspacePermissionsHint }}</NText>
      </div>

      <div class="category-row">
        <NText class="cat-label">{{ t.permissionCategoryBash }}</NText>
        <NRadioGroup v-model:value="workspacePermDraft.bash" size="small" :disabled="loading">
          <NRadioButton v-for="opt in modeOptions" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </NRadioButton>
        </NRadioGroup>
      </div>
      <div class="category-row">
        <NText class="cat-label">{{ t.permissionCategoryWrite }}</NText>
        <NRadioGroup v-model:value="workspacePermDraft.write" size="small" :disabled="loading">
          <NRadioButton v-for="opt in modeOptions" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </NRadioButton>
        </NRadioGroup>
      </div>
      <NSpace :size="6" class="quick">
        <NButton size="tiny" quaternary :disabled="loading" @click="setWorkspaceModes('ask')">
          {{ t.securityAskAll }}
        </NButton>
        <NButton size="tiny" quaternary :disabled="loading" @click="setWorkspaceModes('allow')">
          {{ t.securityAllowAll }}
        </NButton>
      </NSpace>

      <div v-if="trustedPaths.length > 1" class="trusted-list">
        <NText depth="3" class="hint">{{ t.securityTrustedListHint }}</NText>
        <div
          v-for="p in trustedPaths"
          :key="p"
          class="trusted-row"
          :title="p"
        >
          <span class="trusted-path">{{ shortPath(p) }}</span>
          <span class="trusted-badge">
            {{
              normalizeSecurityPathKey(p) === normalizeSecurityPathKey(workspace.root || "")
                ? t.securityTrustedCurrent
                : t.securityTrustTrusted
            }}
          </span>
        </div>
      </div>
    </div>

    <NText v-else-if="workspace.root" depth="3" class="hint muted">
      {{ t.securityWorkspacePermissionsNeedTrust }}
    </NText>

    <NDivider class="div" />

    <div class="section">
      <div class="section-head">
        <NText strong class="section-title">{{ t.securityGlobalCategoriesSection }}</NText>
        <NText depth="3" class="hint">{{ t.securityGlobalCategoriesHint }}</NText>
      </div>

      <div class="category-row">
        <NText class="cat-label">{{ t.permissionCategoryBash }}</NText>
        <NRadioGroup v-model:value="draft.bash" size="small" :disabled="loading">
          <NRadioButton v-for="opt in modeOptions" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </NRadioButton>
        </NRadioGroup>
      </div>
      <div class="category-row">
        <NText class="cat-label">{{ t.permissionCategoryWrite }}</NText>
        <NRadioGroup v-model:value="draft.write" size="small" :disabled="loading">
          <NRadioButton v-for="opt in modeOptions" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </NRadioButton>
        </NRadioGroup>
      </div>
      <NSpace :size="6" class="quick">
        <NButton size="tiny" quaternary :disabled="loading" @click="setGlobalModes('ask')">
          {{ t.securityAskAll }}
        </NButton>
        <NButton size="tiny" quaternary :disabled="loading" @click="setGlobalModes('allow')">
          {{ t.securityAllowAll }}
        </NButton>
      </NSpace>
    </div>

    <NDivider class="div" />

    <div class="section">
      <div class="section-head">
        <NText strong class="section-title">{{ t.securityBashAllowlist }}</NText>
        <NText depth="3" class="hint">{{ t.securityBashAllowlistHint }}</NText>
      </div>
      <NDynamicTags
        v-model:value="draft.bashAllowlist"
        size="small"
        :disabled="loading"
        :input-props="{ placeholder: t.securityBashAllowlistPlaceholder }"
      />
    </div>

    <template #footer>
      <div class="footer">
        <NButton size="small" @click="emit('close')">{{ t.close }}</NButton>
        <NButton size="small" type="primary" :loading="saving" :disabled="loading" @click="onSave">
          {{ t.save }}
        </NButton>
      </div>
    </template>
  </NModal>
</template>

<style scoped>
.section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.section-head {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.section-title {
  font-size: 13px;
}
.hint {
  font-size: 11px;
  line-height: 1.4;
}
.hint.muted {
  display: block;
  margin: 2px 0 4px;
}
.path {
  font-size: 11px;
  word-break: break-all;
  line-height: 1.35;
}
.status {
  font-size: 12px;
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
.category-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 28px;
}
.cat-label {
  font-size: 12px;
  flex: 1;
  min-width: 0;
}
.quick {
  margin-top: 2px;
}
.div {
  margin: 10px 0 !important;
}
.trusted-list {
  margin-top: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.trusted-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 11px;
  color: var(--fg-muted, #71717a);
}
.trusted-path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.trusted-badge {
  flex-shrink: 0;
  font-size: 10px;
  opacity: 0.85;
}
.footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
