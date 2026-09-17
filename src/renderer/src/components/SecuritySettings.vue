<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { NModal, NText, NButton, NDivider, useMessage } from "naive-ui";
import {
  PERMISSION_PROFILES,
  type PermissionProfile,
} from "../../../shared/desktop-security";
import { useSecurityStore } from "@renderer/stores/security";
import { t } from "@renderer/i18n";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const security = useSecurityStore();
const message = useMessage();
const saving = ref(false);

function profileLabel(value: PermissionProfile): string {
  switch (value) {
    case "ask":
      return t.permissionProfileAsk;
    case "edits":
      return t.permissionProfileEdits;
    case "auto":
      return t.permissionProfileAuto;
    case "yolo":
      return t.permissionProfileYolo;
  }
}

function profileHint(value: PermissionProfile): string {
  switch (value) {
    case "ask":
      return t.permissionProfileAskHint;
    case "edits":
      return t.permissionProfileEditsHint;
    case "auto":
      return t.permissionProfileAutoHint;
    case "yolo":
      return t.permissionProfileYoloHint;
  }
}

const profileOptions = computed(() =>
  PERMISSION_PROFILES.map((value) => ({
    value,
    label: profileLabel(value),
    hint: profileHint(value),
  })),
);

watch(
  () => props.open,
  (open) => {
    if (open) void refresh();
  },
);

async function refresh(): Promise<void> {
  try {
    await security.load();
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  }
}

/** 选择即生效，与输入框工具栏共用同一份状态。 */
async function pick(value: PermissionProfile): Promise<void> {
  if (saving.value || security.profile === value) return;
  saving.value = true;
  try {
    await security.setProfile(value);
    message.success(t.saved);
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  } finally {
    saving.value = false;
  }
}

async function onOpenDevTools(): Promise<void> {
  try {
    await window.api.window.openDevTools();
  } catch (err) {
    message.error(err instanceof Error ? err.message : t.cannotOpenDevtools);
  }
}
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
    <div class="modal-scroll">
      <div class="section">
        <div class="section-head">
          <NText strong class="section-title">{{ t.securityPermissionMode }}</NText>
          <NText depth="3" class="hint">{{ t.securityPermissionModeHint }}</NText>
        </div>
        <div
          class="profile-list"
          role="radiogroup"
          :aria-label="t.securityPermissionMode"
        >
          <button
            v-for="opt in profileOptions"
            :key="opt.value"
            type="button"
            role="radio"
            class="profile-option"
            :class="{ active: security.profile === opt.value }"
            :aria-checked="security.profile === opt.value"
            :disabled="saving"
            @click="pick(opt.value)"
          >
            <span class="profile-name">{{ opt.label }}</span>
            <span class="profile-hint">{{ opt.hint }}</span>
          </button>
        </div>
      </div>

      <NDivider class="div" />

      <div class="section">
        <div class="section-head">
          <NText strong class="section-title">{{ t.securityOpenDevTools }}</NText>
          <NText depth="3" class="hint">{{ t.securityOpenDevToolsHint }}</NText>
        </div>
        <NButton size="small" secondary :disabled="saving" @click="onOpenDevTools">
          {{ t.securityOpenDevTools }}
        </NButton>
      </div>
    </div>

    <template #footer>
      <div class="footer">
        <NButton size="small" @click="emit('close')">{{ t.close }}</NButton>
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
.div {
  margin: 10px 0 !important;
}
.profile-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 2px;
}
.profile-option {
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-items: flex-start;
  width: 100%;
  margin: 0;
  padding: 8px 12px;
  border: 1px solid var(--border, rgba(128, 128, 128, 0.25));
  border-radius: 6px;
  background: var(--bg-elevated, transparent);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.profile-option:hover {
  border-color: var(--accent-border, var(--accent));
}
.profile-option.active {
  border-color: var(--accent);
  background: var(--accent-soft, transparent);
}
.profile-option:disabled {
  cursor: default;
  opacity: 0.7;
}
.profile-name {
  font-size: 12.5px;
  font-weight: 600;
}
.profile-hint {
  font-size: 11px;
  color: var(--fg-muted, #71717a);
  line-height: 1.4;
}
.footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
