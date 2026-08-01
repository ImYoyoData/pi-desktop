<script setup lang="ts">
import { computed, ref } from "vue";
import { NButton, NIcon, NInput, NModal, NRadioButton, NRadioGroup, NText } from "naive-ui";
import { CheckmarkCircleOutline, CloudOutline, HardwareChipOutline } from "@vicons/ionicons5";
import type { AsrCloudConfig } from "../../../shared/asr";
import { useAsrStore } from "@renderer/stores/asr";
import { t } from "@renderer/i18n";

const asr = useAsrStore();
const show = computed(() => asr.backendPickerOpen);

const cloudConfigured = computed(() => asr.status.cloudConfigured);
const editingCloud = ref(false);
const saving = ref(false);

const cloud = ref<AsrCloudConfig>({
  providerName: "",
  baseUrl: "",
  apiKey: "",
  model: "",
  apiStyle: "openai-multipart",
  endpoint: "",
});

async function pickLocal(): Promise<void> {
  await asr.setBackend("local");
  asr.resolveBackendPick(true);
}

function startCloudConfig(): void {
  editingCloud.value = true;
  void asr.getCloudConfig().then((cfg) => {
    if (cfg.cloud) cloud.value = { ...cfg.cloud };
  });
}

async function pickCloud(): Promise<void> {
  if (!cloudConfigured.value) {
    editingCloud.value = true;
    return;
  }
  await asr.setBackend("cloud");
  asr.resolveBackendPick(true);
}

async function saveAndUseCloud(): Promise<void> {
  saving.value = true;
  try {
    await asr.setCloudConfig({ ...cloud.value });
    await asr.setBackend("cloud");
    asr.resolveBackendPick(true);
  } finally {
    saving.value = false;
  }
}

function onClose(): void {
  if (!asr.backendPickerOpen) return;
  asr.closeBackendPicker();
}
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    :title="t.asrPickBackendTitle"
    style="width: min(480px, 94vw)"
    :mask-closable="false"
    @update:show="(v: boolean) => { if (!v) onClose() }"
  >
    <NText depth="3" style="font-size: 12.5px">{{ t.asrPickBackendHint }}</NText>

    <!-- Cloud config form (shown when cloud not configured yet) -->
    <div v-if="editingCloud" class="cloud-form">
      <label class="field">
        <span>{{ t.asrCloudApiStyle }}</span>
        <NRadioGroup v-model:value="cloud.apiStyle" size="small">
          <NRadioButton value="openai-multipart">{{ t.asrCloudStyleMultipart }}</NRadioButton>
          <NRadioButton value="openai-json">{{ t.asrCloudStyleJson }}</NRadioButton>
          <NRadioButton value="custom">{{ t.asrCloudStyleCustom }}</NRadioButton>
        </NRadioGroup>
      </label>
      <label v-if="cloud.apiStyle === 'custom'" class="field">
        <span>{{ t.asrCloudEndpoint }}</span>
        <NInput v-model:value="cloud.endpoint" size="small" placeholder="https://api.example.com/audio/transcriptions" />
      </label>
      <label class="field">
        <span>{{ t.asrCloudProviderName }}</span>
        <NInput v-model:value="cloud.providerName" size="small" :placeholder="t.asrCloudProviderNamePh" />
      </label>
      <label class="field">
        <span>{{ t.asrCloudBaseUrl }}</span>
        <NInput v-model:value="cloud.baseUrl" size="small" placeholder="https://api.example.com/v1" />
      </label>
      <label class="field">
        <span>{{ t.asrCloudApiKey }}</span>
        <NInput v-model:value="cloud.apiKey" size="small" type="password" :placeholder="t.asrCloudApiKeyPh" />
      </label>
      <label class="field">
        <span>{{ t.asrCloudModel }}</span>
        <NInput v-model:value="cloud.model" size="small" :placeholder="t.asrCloudModelPh" />
      </label>
      <div class="cloud-actions">
        <NButton size="small" quaternary @click="editingCloud = false">{{ t.cancel }}</NButton>
        <NButton
          size="small"
          type="primary"
          :loading="saving"
          :disabled="!cloud.baseUrl.trim() || !cloud.apiKey.trim() || !cloud.model.trim()"
          @click="saveAndUseCloud"
        >
          {{ t.asrCloudSaveAndUse }}
        </NButton>
      </div>
      <NText depth="3" style="font-size: 11.5px">{{ t.asrCloudCompatibleNote }}</NText>
    </div>

    <!-- Backend cards -->
    <div v-else class="backend-grid">
      <button type="button" class="backend-card" @click="pickLocal">
        <NIcon :component="HardwareChipOutline" :size="22" class="bc-icon local" />
        <span class="bc-title">{{ t.asrBackendLocal }}</span>
        <span class="bc-desc">{{ t.asrBackendLocalDesc }}</span>
      </button>
      <button type="button" class="backend-card" @click="pickCloud">
        <NIcon :component="CloudOutline" :size="22" class="bc-icon cloud" />
        <span class="bc-title">
          {{ t.asrBackendCloud }}
          <NIcon v-if="cloudConfigured" :component="CheckmarkCircleOutline" :size="14" class="configured" />
        </span>
        <span class="bc-desc">
          {{ cloudConfigured ? t.asrBackendCloudConfigured : t.asrBackendCloudUnconfigured }}
        </span>
      </button>
    </div>

    <template #footer>
      <div class="modal-foot">
        <NButton size="small" quaternary @click="onClose">{{ t.cancel }}</NButton>
        <NButton v-if="!editingCloud" size="small" quaternary @click="startCloudConfig">
          {{ t.asrCloudConfigSettings }}
        </NButton>
      </div>
    </template>
  </NModal>
</template>

<style scoped>
.backend-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-top: 12px;
}

.backend-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--bg-elevated);
  color: var(--fg);
  text-align: left;
  cursor: pointer;
  font: inherit;
  transition:
    border-color var(--duration-fast, 140ms) var(--ease-out, ease),
    background var(--duration-fast, 140ms) var(--ease-out, ease);
}

.backend-card:hover {
  border-color: var(--accent-border);
  background: var(--accent-soft);
}

.bc-icon.local {
  color: var(--accent);
}

.bc-icon.cloud {
  color: var(--green, #16a34a);
}

.bc-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 650;
}

.configured {
  color: var(--success, var(--green, #16a34a));
}

.bc-desc {
  font-size: 11.5px;
  color: var(--fg-muted);
  line-height: 1.4;
}

.cloud-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 12px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.field span {
  font-size: 11.5px;
  color: var(--fg-muted);
}

.cloud-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.modal-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
</style>
