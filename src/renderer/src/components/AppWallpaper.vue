<script setup lang="ts">
import { computed } from "vue";
import { useAppearanceStore } from "@renderer/stores/appearance";
import { wallpaperMediaSrc } from "../../../shared/appearance";

/** 全局背景层：图片/动图/视频壁纸 + 遮罩；样式见 assets/wallpaper.css。 */
const appearance = useAppearanceStore();

const kind = computed(() => appearance.wallpaper.kind);
const mediaSrc = computed(() =>
  appearance.wallpaper.path ? wallpaperMediaSrc(appearance.wallpaper.path) : "",
);
</script>

<template>
  <div
    v-if="kind !== 'none' && !appearance.wallpaperBroken"
    class="app-wallpaper"
    aria-hidden="true"
  >
    <div
      v-if="kind === 'color'"
      class="app-wallpaper-solid"
      :style="{ background: appearance.wallpaper.color }"
    />
    <template v-else>
      <div class="app-wallpaper-media">
        <img
          v-if="kind === 'image'"
          :src="mediaSrc"
          alt=""
          draggable="false"
          @error="appearance.setWallpaperBroken(true)"
        />
        <video
          v-else
          :src="mediaSrc"
          autoplay
          loop
          muted
          playsinline
          preload="auto"
          @error="appearance.setWallpaperBroken(true)"
        />
      </div>
      <div class="app-wallpaper-veil" />
    </template>
  </div>
</template>

<style scoped>
.app-wallpaper {
  position: fixed;
  inset: 0;
  z-index: -1;
  overflow: hidden;
  pointer-events: none;
  --pi-wallpaper-veil-color: #ffffff;
}

html[data-theme="dark"] .app-wallpaper {
  --pi-wallpaper-veil-color: #121314;
}

.app-wallpaper-solid {
  position: absolute;
  inset: 0;
}

/* 外扩避免模糊后边缘透出底色 */
.app-wallpaper-media {
  position: absolute;
  inset: calc(var(--pi-veil-blur, 0px) * -3);
  filter: blur(var(--pi-veil-blur, 0px));
}

.app-wallpaper-media img,
.app-wallpaper-media video {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.app-wallpaper-veil {
  position: absolute;
  inset: 0;
  background: color-mix(
    in srgb,
    var(--pi-wallpaper-veil-color) var(--pi-veil-opacity, 0%),
    transparent
  );
}
</style>
