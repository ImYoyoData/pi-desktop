<script setup lang="ts">
import { ref } from "vue";
import { NButton, NInput } from "naive-ui";
import CodiconIcon from "@renderer/components/icons/CodiconIcon.vue";
import { useAppearanceStore } from "@renderer/stores/appearance";
import { t } from "@renderer/i18n";

/** 外观预设：保存当前外观、应用或删除已有预设。 */
const appearance = useAppearanceStore();
const creating = ref(false);
const draftName = ref("");

function startCreate(): void {
  creating.value = true;
  draftName.value = `${t.appearancePresetDefault} ${appearance.presets.length + 1}`;
}

function cancelCreate(): void {
  creating.value = false;
  draftName.value = "";
}

function commitCreate(): void {
  const name = draftName.value.trim();
  if (name) appearance.savePreset(name);
  cancelCreate();
}
</script>

<template>
  <div class="preset-pane">
    <div class="preset-head">
      <span class="preset-title">{{ t.appearancePresets }}</span>
      <NButton
        quaternary
        size="tiny"
        :title="t.appearancePresetNew"
        @click="startCreate"
      >
        <template #icon><CodiconIcon name="add" :size="14" /></template>
      </NButton>
    </div>

    <NInput
      v-if="creating"
      v-model:value="draftName"
      size="tiny"
      autofocus
      :placeholder="t.appearancePresetName"
      @keyup.enter="commitCreate"
      @keyup.esc="cancelCreate"
      @blur="cancelCreate"
    />

    <p v-if="!appearance.presets.length && !creating" class="preset-empty">
      {{ t.appearancePresetEmpty }}
    </p>

    <ul v-else class="preset-items">
      <li
        v-for="preset in appearance.presets"
        :key="preset.id"
        class="preset-row"
      >
        <button
          type="button"
          class="preset-item"
          :class="{ active: appearance.activePresetId === preset.id }"
          :title="preset.name"
          @click="appearance.applyPreset(preset.id)"
        >
          <span class="preset-name">{{ preset.name }}</span>
        </button>
        <NButton
          quaternary
          size="tiny"
          class="preset-remove"
          :title="t.appearancePresetRemove"
          @click="appearance.removePreset(preset.id)"
        >
          <template #icon><CodiconIcon name="remove" :size="13" /></template>
        </NButton>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.preset-pane {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding: 12px 12px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md, 6px);
  background: var(--bg-elevated, var(--bg));
}

.preset-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.preset-title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--fg-strong);
}

.preset-empty {
  margin: 0;
  color: var(--fg-muted);
  font-size: 12px;
}

.preset-items {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
  max-height: 260px;
  overflow-y: auto;
}

.preset-row {
  display: flex;
  align-items: center;
  gap: 2px;
}

.preset-item {
  flex: 1;
  min-width: 0;
  padding: 4px 8px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--fg);
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.preset-item:hover {
  background: var(--bg-hover);
}

.preset-item.active {
  background: var(--bg-active);
  font-weight: 600;
}

.preset-name {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preset-remove {
  flex-shrink: 0;
  opacity: 0;
}

.preset-row:hover .preset-remove {
  opacity: 1;
}
</style>
