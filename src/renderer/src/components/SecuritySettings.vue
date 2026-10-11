<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { NButton, NDivider, NText, useMessage } from "naive-ui";
import {
  PERMISSION_PROFILES,
  type PermissionProfile,
} from "../../../shared/desktop-security";
import { useSecurityStore } from "@renderer/stores/security";
import { t } from "@renderer/i18n";

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

onMounted(() => void refresh());

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
  <section class="settings-group">
    <div class="group-title">{{ t.securityTitle }}</div>

    <div class="row">
      <div class="labels">
        <NText strong>{{ t.securityPermissionMode }}</NText>
        <NText depth="3" class="hint">{{ t.securityPermissionModeHint }}</NText>
      </div>
    </div>

    <div class="profile-list" role="radiogroup" :aria-label="t.securityPermissionMode">
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

    <NDivider class="div" />

    <div class="row">
      <div class="labels">
        <NText strong>{{ t.securityOpenDevTools }}</NText>
        <NText depth="3" class="hint">{{ t.securityOpenDevToolsHint }}</NText>
      </div>
      <NButton size="small" secondary :disabled="saving" @click="onOpenDevTools">
        {{ t.open }}
      </NButton>
    </div>
  </section>
</template>

<style scoped>
.settings-group {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.group-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--fg-muted);
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.labels {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.hint {
  font-size: 12px;
}

.div {
  margin: 2px 0 !important;
}

.profile-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
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

.profile-option:focus-visible {
  outline: 1px solid var(--accent);
  outline-offset: -1px;
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
</style>
