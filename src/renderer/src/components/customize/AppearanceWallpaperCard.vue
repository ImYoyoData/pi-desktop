<script setup lang="ts">
import { computed } from "vue";
import { NTooltip } from "naive-ui";
import AppearanceSliderRow from "@renderer/components/customize/AppearanceSliderRow.vue";
import { useAppearanceStore } from "@renderer/stores/appearance";
import {
  SURFACE_ALPHA_FLOOR,
  wallpaperMediaSrc,
} from "../../../../shared/appearance";
import { t } from "@renderer/i18n";

/** 背景图卡片：点击预览选择/更换壁纸；右侧调整遮罩与界面透明度。 */
const appearance = useAppearanceStore();

const kind = computed(() => appearance.wallpaper.kind);
const isMedia = computed(() => kind.value === "image" || kind.value === "video");
const mediaSrc = computed(() =>
  appearance.wallpaper.path ? wallpaperMediaSrc(appearance.wallpaper.path) : "",
);
const floorPercent = Math.round(SURFACE_ALPHA_FLOOR * 100);

async function pickWallpaper(): Promise<void> {
  const path = await window.api.appearance.pickWallpaper();
  if (path) appearance.setWallpaperFile(path);
}
</script>

<template>
  <section class="card">
    <div class="card-head">
      <span class="card-title">{{ t.appearanceWallpaper }}</span>
      <NTooltip trigger="hover" :delay="150">
        <template #trigger><span class="card-tip">?</span></template>
        {{ t.appearanceWallpaperTip }}
      </NTooltip>
    </div>

    <div class="wallpaper-body">
      <div class="preview-wrap">
        <button
          type="button"
          class="preview-hit"
          :class="{ empty: kind === 'none' }"
          :title="
            kind === 'none' ? t.appearanceWallpaperPick : t.appearanceWallpaperChange
          "
          @click="pickWallpaper"
        >
          <img
            v-if="kind === 'image'"
            :src="mediaSrc"
            alt=""
            draggable="false"
            @error="appearance.setWallpaperBroken(true)"
          />
          <video
            v-else-if="kind === 'video'"
            :src="mediaSrc"
            autoplay
            loop
            muted
            playsinline
            @error="appearance.setWallpaperBroken(true)"
          />
          <span v-else class="preview-hint">{{ t.appearanceWallpaperPick }}</span>
          <span v-if="isMedia && appearance.wallpaperBroken" class="preview-missing">
            {{ t.appearanceWallpaperMissing }}
          </span>
          <span v-if="kind !== 'none'" class="preview-action">
            {{ t.appearanceWallpaperChange }}
          </span>
        </button>
        <button
          v-if="kind !== 'none'"
          type="button"
          class="preview-remove"
          @click="appearance.clearWallpaper()"
        >
          {{ t.appearanceWallpaperRemove }}
        </button>
      </div>

      <div class="wallpaper-controls">
        <AppearanceSliderRow
          :label="t.appearanceVeilOpacity"
          :value="appearance.wallpaper.veilOpacity"
          :tip="t.appearanceVeilOpacityTip"
          :disabled="!isMedia"
          @update:value="appearance.setVeilOpacity"
        />
        <AppearanceSliderRow
          :label="t.appearanceVeilBlur"
          :value="appearance.wallpaper.veilBlur"
          :tip="t.appearanceVeilBlurTip"
          :disabled="!isMedia"
          @update:value="appearance.setVeilBlur"
        />

        <AppearanceSliderRow
          :label="t.appearanceSurfaceInput"
          :value="appearance.surfaces.input"
          :disabled="!isMedia"
          @update:value="(value) => appearance.setSurfaceAlpha('input', value)"
        />
        <AppearanceSliderRow
          :label="t.appearanceSurfaceCard"
          :value="appearance.surfaces.card"
          :min="floorPercent"
          :tip="t.appearanceSurfaceCardTip"
          :disabled="!isMedia"
          @update:value="(value) => appearance.setSurfaceAlpha('card', value)"
        />
        <AppearanceSliderRow
          :label="t.appearanceSurfaceSettings"
          :value="appearance.surfaces.settings"
          :min="floorPercent"
          :disabled="!isMedia"
          @update:value="(value) => appearance.setSurfaceAlpha('settings', value)"
        />
        <AppearanceSliderRow
          :label="t.appearanceSurfaceTool"
          :value="appearance.surfaces.tool"
          :min="floorPercent"
          :tip="t.appearanceSurfaceToolTip"
          :disabled="!isMedia"
          @update:value="(value) => appearance.setSurfaceAlpha('tool', value)"
        />
      </div>
    </div>
  </section>
</template>

<style scoped>
.card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md, 6px);
  background: var(--bg-elevated, var(--bg));
}

.card-head {
  display: flex;
  align-items: center;
  gap: 6px;
}

.card-title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--fg-strong);
}

.card-tip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 13px;
  height: 13px;
  border: 1px solid var(--border-strong);
  border-radius: 50%;
  color: var(--fg-muted);
  font-size: 9px;
  line-height: 1;
  cursor: default;
}

.wallpaper-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(220px, 300px);
  gap: 12px;
  align-items: stretch;
}

.preview-wrap {
  position: relative;
  display: flex;
  min-width: 0;
}

.preview-hit {
  display: block;
  width: 100%;
  min-height: 220px;
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius-md, 6px);
  background: var(--bg-input);
  color: inherit;
  cursor: pointer;
}

.preview-hit.empty {
  display: flex;
  align-items: center;
  justify-content: center;
  border-style: dashed;
}

.preview-hit img,
.preview-hit video {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.preview-hint {
  color: var(--fg-muted);
  font-size: 12px;
}

.preview-action {
  position: absolute;
  left: 50%;
  top: 50%;
  translate: -50% -50%;
  padding: 3px 10px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 12px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 120ms ease;
}

.preview-hit:hover .preview-action {
  opacity: 1;
}

.preview-missing {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
  box-sizing: border-box;
  background: color-mix(in srgb, var(--bg) 72%, transparent);
  color: var(--fg-muted);
  font-size: 12px;
  text-align: center;
}

.preview-remove {
  position: absolute;
  top: 8px;
  right: 8px;
  padding: 3px 10px;
  border: none;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.preview-remove:hover {
  background: rgba(0, 0, 0, 0.72);
}

.wallpaper-controls {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}

@container (max-width: 560px) {
  .wallpaper-body {
    grid-template-columns: minmax(0, 1fr);
  }

  .preview-hit {
    aspect-ratio: 16 / 9;
    min-height: 0;
  }
}
</style>
