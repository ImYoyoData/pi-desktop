<script setup lang="ts">
import { onMounted, ref } from "vue";
import { NButton, NSpin } from "naive-ui";
import type { ModelsGetResult } from "../../../../shared/models-settings";
import { t } from "@renderer/i18n";

const emit = defineEmits<{ configure: [] }>();

const loading = ref(false);
const error = ref("");
const providers = ref<ModelsGetResult["providers"]>([]);
const available = ref<ModelsGetResult["available"]>([]);

onMounted(() => {
  void load();
});

async function load(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    const data = await window.api.models.get();
    providers.value = data.providers;
    available.value = data.available;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

function modelsOf(providerId: string, limit = 6): string[] {
  return available.value
    .filter((model) => model.provider === providerId)
    .map((model) => model.name)
    .slice(0, limit);
}
</script>

<template>
  <div class="customize-models">
    <div class="list-toolbar">
      <NButton size="small" @click="emit('configure')">
        {{ t.customizeModelsConfigure }}
      </NButton>
    </div>

    <NSpin v-if="loading" size="small" class="content-spin" />
    <p v-else-if="error" class="content-error">{{ t.customizeLoadFailed }}: {{ error }}</p>

    <div v-else class="list-container">
      <div v-for="provider in providers" :key="provider.id" class="ai-customization-list-item">
        <div class="item-left">
          <div class="item-text">
            <div class="item-name-row">
              <span class="item-name">{{ provider.displayName }}</span>
              <span class="inline-badge item-badge">
                {{ provider.configured ? t.customizeModelsConfigured : t.customizeModelsUnconfigured }}
              </span>
            </div>
            <div v-if="modelsOf(provider.id).length" class="item-description">
              {{ modelsOf(provider.id).join(" · ") }}
            </div>
          </div>
        </div>
        <div class="item-right">
          <span class="provider-count">{{ t.customizeModelsCount(provider.modelCount) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.customize-models {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.list-toolbar {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  padding-top: 16px;
  margin-bottom: 16px;
}

.list-container {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.ai-customization-list-item {
  display: flex;
  align-items: center;
  min-height: 32px;
  padding: 6px 12px 6px 16px;
  border-radius: 4px;
}

.ai-customization-list-item:hover {
  background-color: var(--bg-hover);
}

.item-left {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
}

.item-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
}

.item-name-row {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
}

.item-name {
  color: var(--fg);
  font-size: 13px;
  line-height: 18px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.inline-badge {
  flex-shrink: 0;
  padding: 0 6px;
  border-radius: 8px;
  background: var(--bg-active);
  color: var(--fg-muted);
  font-size: 10px;
  line-height: 16px;
}

.item-description {
  color: var(--fg-muted);
  font-size: 11px;
  line-height: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-right {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: 4px;
  margin-left: 16px;
  opacity: 0;
  transition: opacity 0.1s ease;
}

.ai-customization-list-item:hover .item-right {
  opacity: 1;
}

.provider-count {
  color: var(--fg-muted);
  font-size: 11px;
}

.content-error {
  margin: 0;
  color: #e5484d;
  font-size: 12px;
}

.content-spin {
  display: flex;
  justify-content: center;
  padding: 48px 0;
}
</style>
