<script setup lang="ts">
import { computed } from "vue";
import AppearanceSliderRow from "@renderer/components/customize/AppearanceSliderRow.vue";
import { useAppearanceStore } from "@renderer/stores/appearance";
import { SURFACE_ALPHA_FLOOR } from "../../../../shared/appearance";
import { t } from "@renderer/i18n";

/** 界面透明度：输入框、卡片、设置页三档独立滑杆。 */
const appearance = useAppearanceStore();

const enabled = computed(() => appearance.wallpaper.kind !== "none");
const floorPercent = Math.round(SURFACE_ALPHA_FLOOR * 100);
</script>

<template>
  <section class="card">
    <span class="card-title">{{ t.appearanceSurfaces }}</span>
    <p class="card-desc">
      {{ enabled ? t.appearanceSurfacesDesc : t.appearanceSurfacesDisabled }}
    </p>
    <div class="surface-sliders">
      <AppearanceSliderRow
        :label="t.appearanceSurfaceInput"
        :value="appearance.surfaces.input"
        :disabled="!enabled"
        @update:value="(value) => appearance.setSurfaceAlpha('input', value)"
      />
      <AppearanceSliderRow
        :label="t.appearanceSurfaceCard"
        :value="appearance.surfaces.card"
        :min="floorPercent"
        :tip="t.appearanceSurfaceCardTip"
        :disabled="!enabled"
        @update:value="(value) => appearance.setSurfaceAlpha('card', value)"
      />
      <AppearanceSliderRow
        :label="t.appearanceSurfaceSettings"
        :value="appearance.surfaces.settings"
        :min="floorPercent"
        :disabled="!enabled"
        @update:value="(value) => appearance.setSurfaceAlpha('settings', value)"
      />
    </div>
  </section>
</template>

<style scoped>
.card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md, 6px);
  background: var(--bg-elevated, var(--bg));
}

.card-title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--fg-strong);
}

.card-desc {
  margin: 0;
  color: var(--fg-muted);
  font-size: 12px;
  line-height: 1.5;
}

.surface-sliders {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 20px;
  margin-top: 4px;
}

@container (max-width: 560px) {
  .surface-sliders {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
