<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { NButton, NInput, NTooltip } from "naive-ui";
import CodiconIcon from "@renderer/components/icons/CodiconIcon.vue";
import AppearanceSliderRow from "@renderer/components/customize/AppearanceSliderRow.vue";
import { useAppearanceStore } from "@renderer/stores/appearance";
import {
  WALLPAPER_SOLID_COLORS,
  normalizeHexColor,
  wallpaperMediaSrc,
} from "../../../../shared/appearance";
import { t } from "@renderer/i18n";

/** 背景图卡片：预览、纯色色板、更换/移除壁纸，以及遮罩透明度与模糊。 */
const appearance = useAppearanceStore();

const kind = computed(() => appearance.wallpaper.kind);
const isMedia = computed(() => kind.value === "image" || kind.value === "video");
const mediaSrc = computed(() =>
  appearance.wallpaper.path ? wallpaperMediaSrc(appearance.wallpaper.path) : "",
);

const hexDraft = ref(appearance.wallpaper.color);
watch(
  () => appearance.wallpaper.color,
  (color) => {
    hexDraft.value = color;
  },
);

async function pickWallpaper(): Promise<void> {
  const path = await window.api.appearance.pickWallpaper();
  if (path) appearance.setWallpaperFile(path);
}

function applyHex(): void {
  const hex = normalizeHexColor(hexDraft.value);
  if (!hex) {
    hexDraft.value = appearance.wallpaper.color;
    return;
  }
  appearance.setWallpaperColor(hex);
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
      <div class="wallpaper-preview" :class="{ empty: kind === 'none' }">
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
        <div
          v-else-if="kind === 'color'"
          class="preview-solid"
          :style="{ background: appearance.wallpaper.color }"
        />
        <span v-else class="preview-hint">{{ t.appearanceWallpaperNone }}</span>
        <span v-if="isMedia && appearance.wallpaperBroken" class="preview-missing">
          {{ t.appearanceWallpaperMissing }}
        </span>
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
        <span class="controls-label">{{ t.appearanceSolidColor }}</span>
        <div class="solid-swatches">
          <button
            v-for="color in WALLPAPER_SOLID_COLORS"
            :key="color"
            type="button"
            class="solid-swatch"
            :class="{
              active: kind === 'color' && appearance.wallpaper.color === color,
            }"
            :style="{ background: color }"
            :title="color"
            @click="appearance.setWallpaperColor(color)"
          />
        </div>
        <NInput
          v-model:value="hexDraft"
          size="small"
          :placeholder="t.appearanceSolidColorPlaceholder"
          @keyup.enter="applyHex"
          @change="applyHex"
        >
          <template #prefix><CodiconIcon name="appearance" :size="14" /></template>
        </NInput>
        <NButton size="small" block @click="pickWallpaper">
          <template #icon><CodiconIcon name="file" :size="14" /></template>
          {{ kind === "none" ? t.appearanceWallpaperPick : t.appearanceWallpaperChange }}
        </NButton>
      </div>
    </div>

    <div class="wallpaper-sliders">
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
  grid-template-columns: minmax(0, 1fr) minmax(150px, 190px);
  gap: 12px;
  align-items: start;
}

.wallpaper-preview {
  position: relative;
  overflow: hidden;
  aspect-ratio: 16 / 9;
  border: 1px solid var(--border);
  border-radius: var(--radius-md, 6px);
  background: var(--bg-input);
}

.wallpaper-preview.empty {
  display: flex;
  align-items: center;
  justify-content: center;
  border-style: dashed;
}

.wallpaper-preview img,
.wallpaper-preview video,
.preview-solid {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.preview-hint {
  color: var(--fg-muted);
  font-size: 12px;
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
  gap: 8px;
  min-width: 0;
}

.controls-label {
  color: var(--fg);
  font-size: 12.5px;
}

.solid-swatches {
  display: grid;
  grid-template-columns: repeat(4, 22px);
  gap: 8px;
}

.solid-swatch {
  width: 22px;
  height: 22px;
  padding: 0;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 50%;
  cursor: pointer;
}

.solid-swatch.active {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.wallpaper-sliders {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 20px;
}

@container (max-width: 560px) {
  .wallpaper-body,
  .wallpaper-sliders {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
