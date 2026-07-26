<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from "vue";
import type { ElementCitation } from "../../../shared/protocol";
import { useComposerStore } from "@renderer/stores/composer";

const composer = useComposerStore();

const props = defineProps<{
  visible?: boolean;
}>();

const browserId = ref<string | null>(null);
const urlInput = ref("https://example.com");
const selectMode = ref(false);
const toast = ref<string | null>(null);

const viewport = ref<HTMLElement | null>(null);
let resizeObserver: ResizeObserver | null = null;
let toastTimer: ReturnType<typeof setTimeout> | null = null;
let offElementSelected: (() => void) | null = null;

function showToast(message: string): void {
  toast.value = message;
  if (toastTimer) {
    clearTimeout(toastTimer);
  }
  toastTimer = setTimeout(() => {
    toast.value = null;
    toastTimer = null;
  }, 3500);
}

async function syncBounds(): Promise<void> {
  const id = browserId.value;
  const el = viewport.value;
  if (!id || !el) {
    return;
  }
  if (props.visible === false) {
    await window.api.browser.setBounds(id, { x: 0, y: 0, width: 0, height: 0 });
    return;
  }
  const rect = el.getBoundingClientRect();
  await window.api.browser.setBounds(id, {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  });
}

async function navigate(): Promise<void> {
  const id = browserId.value;
  if (!id) {
    return;
  }
  await window.api.browser.navigate(id, urlInput.value);
}

async function goBack(): Promise<void> {
  const id = browserId.value;
  if (id) {
    await window.api.browser.back(id);
  }
}

async function goForward(): Promise<void> {
  const id = browserId.value;
  if (id) {
    await window.api.browser.forward(id);
  }
}

async function reload(): Promise<void> {
  const id = browserId.value;
  if (id) {
    await window.api.browser.reload(id);
  }
}

async function setSelectMode(next: boolean): Promise<void> {
  const id = browserId.value;
  if (!id) {
    return;
  }
  if (next) {
    const result = await window.api.browser.startSelect(id);
    if (!result.ok) {
      selectMode.value = false;
      showToast("此页不支持选元素");
      return;
    }
    selectMode.value = true;
    return;
  }
  selectMode.value = false;
  await window.api.browser.stopSelect(id);
}

function onCitation(citation: ElementCitation): void {
  composer.addCitation(citation);
  selectMode.value = false;
  const id = browserId.value;
  if (id) {
    void window.api.browser.stopSelect(id);
  }
  showToast("已添加到引用");
}

onMounted(async () => {
  browserId.value = await window.api.browser.create();
  offElementSelected = window.api.browser.onElementSelected(onCitation);
  await navigate();

  resizeObserver = new ResizeObserver(() => {
    void syncBounds();
  });
  if (viewport.value) {
    resizeObserver.observe(viewport.value);
    void syncBounds();
  }
});

onUnmounted(() => {
  offElementSelected?.();
  resizeObserver?.disconnect();
  if (toastTimer) {
    clearTimeout(toastTimer);
  }
  const id = browserId.value;
  if (id) {
    void window.api.browser.destroy(id);
  }
  browserId.value = null;
});

watch(viewport, (el, prev) => {
  if (prev && resizeObserver) {
    resizeObserver.unobserve(prev);
  }
  if (el && resizeObserver) {
    resizeObserver.observe(el);
    void syncBounds();
  }
});

watch(
  () => props.visible,
  () => {
    void syncBounds();
  },
);
</script>

<template>
  <div class="browser-tab">
    <div class="toolbar">
      <button type="button" class="btn" title="Back" @click="goBack">←</button>
      <button type="button" class="btn" title="Forward" @click="goForward">→</button>
      <button type="button" class="btn" title="Reload" @click="reload">↻</button>
      <input
        v-model="urlInput"
        class="url"
        type="text"
        spellcheck="false"
        @keydown.enter.prevent="navigate"
      />
      <button type="button" class="btn primary" @click="navigate">Go</button>
      <button
        type="button"
        class="btn"
        :class="{ active: selectMode }"
        @click="setSelectMode(!selectMode)"
      >
        {{ selectMode ? "Cancel select" : "Select element" }}
      </button>
    </div>
    <div ref="viewport" class="viewport" />
    <div v-if="toast" class="toast">{{ toast }}</div>
  </div>
</template>

<style scoped>
.browser-tab {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  position: relative;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;
  padding: 0.35rem 0.5rem;
  border-bottom: 1px solid #e5e7eb;
}

.btn {
  padding: 0.25rem 0.45rem;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  background: #fff;
  font-size: 0.75rem;
  cursor: pointer;
}

.btn.primary {
  background: #111827;
  color: #fff;
  border-color: #111827;
}

.btn.active {
  border-color: #2563eb;
  color: #1d4ed8;
}

.url {
  flex: 1;
  min-width: 8rem;
  font-size: 0.75rem;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  padding: 0.25rem 0.45rem;
}

.viewport {
  flex: 1;
  min-height: 12rem;
  background: #fff;
}

.toast {
  position: absolute;
  left: 50%;
  bottom: 1rem;
  transform: translateX(-50%);
  background: #111827;
  color: #fff;
  font-size: 0.75rem;
  padding: 0.45rem 0.75rem;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  pointer-events: none;
  z-index: 10;
}
</style>
