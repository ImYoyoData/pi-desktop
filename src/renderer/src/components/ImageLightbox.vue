<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import { useMessage } from "naive-ui";
import { t } from "@renderer/i18n";

/**
 * 图片灯箱：点击放大，右键复制 / 保存。naive-ui 自带的预览没有剪贴板集成，
 * 所以自己实现一份。
 */

const props = defineProps<{
  /** null 表示不显示。 */
  dataUrl: string | null;
  mimeType: string;
}>();

const emit = defineEmits<{ close: [] }>();

const messageApi = useMessage();
const menuOpen = ref(false);
const menuPos = ref({ x: 0, y: 0 });

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") emit("close");
}

watch(
  () => props.dataUrl,
  (url) => {
    menuOpen.value = false;
    if (url) window.addEventListener("keydown", onKeydown);
    else window.removeEventListener("keydown", onKeydown);
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
});

/** 右键菜单贴边收口，避免超出视口。 */
function openMenu(event: MouseEvent): void {
  const menuW = 160;
  const menuH = 76;
  menuPos.value = {
    x: Math.max(4, Math.min(event.clientX, window.innerWidth - menuW - 4)),
    y: Math.max(4, Math.min(event.clientY, window.innerHeight - menuH - 4)),
  };
  menuOpen.value = true;
}

async function copyImage(): Promise<void> {
  if (!props.dataUrl) return;
  try {
    await window.api.clipboard.writeImage(props.dataUrl);
    menuOpen.value = false;
    messageApi.success(t.copyImageDone);
  } catch (err) {
    menuOpen.value = false;
    messageApi.error(err instanceof Error ? err.message : String(err));
  }
}

function saveImage(): void {
  if (!props.dataUrl) return;
  menuOpen.value = false;
  const a = document.createElement("a");
  a.href = props.dataUrl;
  const ext = (props.mimeType.split("/")[1] ?? "png").replace(/[^a-z0-9]/gi, "") || "png";
  a.download = `image-${Date.now()}.${ext}`;
  a.click();
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="dataUrl"
      class="image-preview-overlay"
      tabindex="-1"
      @keydown="onKeydown"
      @click.self="emit('close')"
      @contextmenu.self.prevent="emit('close')"
    >
      <div class="preview-toolbar">
        <span class="preview-title">{{ t.imageAttachment }}</span>
        <div class="preview-actions">
          <button type="button" class="preview-btn" @click="copyImage">
            {{ t.copyImage }}
          </button>
          <button type="button" class="preview-btn" @click="saveImage">
            {{ t.saveImage }}
          </button>
          <button
            type="button"
            class="preview-btn close"
            :aria-label="t.close"
            :title="t.close"
            @click="emit('close')"
          >
            ✕
          </button>
        </div>
      </div>
      <img
        :src="dataUrl"
        class="preview-img"
        alt=""
        @contextmenu.prevent="openMenu"
      />
      <div
        v-if="menuOpen"
        class="preview-context-menu"
        :style="{ left: `${menuPos.x}px`, top: `${menuPos.y}px` }"
        @contextmenu.prevent
      >
        <button type="button" class="ctx-item" @click="copyImage">
          {{ t.copyImage }}
        </button>
        <button type="button" class="ctx-item" @click="saveImage">
          {{ t.saveImage }}
        </button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.image-preview-overlay {
  position: fixed;
  inset: 0;
  z-index: 2147483644;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(9, 9, 11, 0.82);
  backdrop-filter: blur(3px);
  cursor: zoom-out;
  animation: preview-fade 160ms var(--ease-out, ease);
  outline: none;
}

@keyframes preview-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}

.preview-toolbar {
  position: absolute;
  top: 12px;
  left: 12px;
  right: 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 10px;
  border-radius: 6px;
  background: rgba(24, 24, 27, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: #fafafa;
  user-select: none;
}

.preview-title {
  font-size: 12.5px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.85);
}

.preview-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.preview-btn {
  padding: 4px 10px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: rgba(255, 255, 255, 0.08);
  color: #fafafa;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  transition: background var(--duration-fast, 140ms) var(--ease-out, ease);
}

.preview-btn:hover {
  background: rgba(255, 255, 255, 0.18);
}

.preview-btn.close {
  border-color: transparent;
  background: transparent;
  font-size: 14px;
  padding: 4px 8px;
}

.preview-img {
  max-width: calc(100vw - 80px);
  max-height: calc(100vh - 80px);
  object-fit: contain;
  border-radius: 4px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  cursor: zoom-out;
  user-select: none;
  -webkit-user-drag: none;
}

.preview-context-menu {
  position: fixed;
  z-index: 2147483645;
  min-width: 150px;
  padding: 4px;
  border-radius: 6px;
  background: var(--bg-elevated, #1c1c22);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-lg, 0 12px 40px rgba(0, 0, 0, 0.3));
  animation: preview-fade 100ms var(--ease-out, ease);
}

.ctx-item {
  display: block;
  width: 100%;
  padding: 7px 10px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--fg);
  text-align: left;
  font: inherit;
  font-size: 12.5px;
  cursor: pointer;
}

.ctx-item:hover {
  background: var(--bg-hover);
}

@media (prefers-reduced-motion: reduce) {
  .image-preview-overlay {
    animation: none;
  }
}
</style>