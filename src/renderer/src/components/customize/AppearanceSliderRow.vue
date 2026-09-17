<script setup lang="ts">
import { computed } from "vue";
import { NSlider, NTooltip } from "naive-ui";

/** 外观设置里的百分比滑杆行：标签 + 提示 + 数值 + 滑杆。 */
const props = withDefaults(
  defineProps<{
    label: string;
    value: number;
    min?: number;
    tip?: string;
    disabled?: boolean;
  }>(),
  { min: 0, tip: "", disabled: false },
);

const emit = defineEmits<{ "update:value": [value: number] }>();

const percentValue = computed(() => Math.round(props.value * 100));

function onUpdate(next: number): void {
  emit("update:value", next / 100);
}
</script>

<template>
  <div class="slider-row">
    <div class="slider-head">
      <span class="slider-label">{{ props.label }}</span>
      <NTooltip v-if="props.tip" trigger="hover" :delay="150">
        <template #trigger>
          <span class="slider-tip">?</span>
        </template>
        {{ props.tip }}
      </NTooltip>
      <span class="slider-value">{{ percentValue }}%</span>
    </div>
    <NSlider
      :value="percentValue"
      :min="props.min"
      :max="100"
      :step="1"
      :tooltip="false"
      :disabled="props.disabled"
      @update:value="onUpdate"
    />
  </div>
</template>

<style scoped>
.slider-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.slider-head {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.slider-label {
  font-size: 12.5px;
  color: var(--fg);
  white-space: nowrap;
}

.slider-tip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 13px;
  height: 13px;
  border: 1px solid var(--border-strong);
  border-radius: 50%;
  color: var(--fg-muted);
  font-size: 9px;
  line-height: 1;
  cursor: default;
}

.slider-value {
  margin-left: auto;
  color: var(--fg-muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
</style>
