<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { NRadioButton, NRadioGroup, NText, useMessage } from "naive-ui";
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

const currentHint = computed(() => profileHint(security.profile));

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
</script>

<template>
  <section class="settings-group">
    <div class="section-head">
      <NText strong>{{ t.securityTitle }}</NText>
    </div>

    <div class="switch-row">
      <div class="switch-labels">
        <NText strong>{{ t.securityPermissionMode }}</NText>
        <NText depth="3" class="row-hint">{{ currentHint }}</NText>
      </div>
      <NRadioGroup
        :value="security.profile"
        size="small"
        :disabled="saving"
        class="setting-radio-group"
        @update:value="pick"
      >
        <NRadioButton
          v-for="opt in profileOptions"
          :key="opt.value"
          :value="opt.value"
        >
          {{ opt.label }}
        </NRadioButton>
      </NRadioGroup>
    </div>
  </section>
</template>

<style scoped>
.settings-group {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.section-head {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.row-hint {
  font-size: 12px;
  line-height: 16px;
}

.switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.switch-labels {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.setting-radio-group {
  flex-shrink: 0;
  display: inline-flex;
}
</style>
