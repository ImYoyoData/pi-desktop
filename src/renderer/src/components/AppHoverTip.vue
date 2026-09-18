<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { NTooltip } from "naive-ui";

/** 提示延迟，接近系统原生 title 的节奏，避免指针扫过时乱跳 */
const SHOW_DELAY_MS = 350;

const text = ref("");
const show = ref(false);
const x = ref(0);
const y = ref(0);

let target: HTMLElement | null = null;
let timer = 0;

/** 临时摘除的 title 必须还原：Vue 重设过 title 时以新值为准 */
function restoreTitle(el: HTMLElement): void {
  const saved = el.dataset.piTip;
  if (saved === undefined) return;
  delete el.dataset.piTip;
  if (!el.hasAttribute("title")) el.setAttribute("title", saved);
}

function hide(): void {
  window.clearTimeout(timer);
  show.value = false;
  if (target) {
    restoreTitle(target);
    target = null;
  }
}

function showFor(el: HTMLElement): void {
  if (target === el) return;
  hide();
  const title = el.getAttribute("title");
  if (!title) return;
  target = el;
  el.dataset.piTip = title;
  el.removeAttribute("title");
  const rect = el.getBoundingClientRect();
  text.value = title;
  x.value = rect.left + rect.width / 2;
  y.value = rect.top;
  timer = window.setTimeout(() => {
    show.value = true;
  }, SHOW_DELAY_MS);
}

function onPointerOver(event: PointerEvent): void {
  const node = event.target as HTMLElement | null;
  const el = node?.closest?.("[title]") as HTMLElement | null;
  if (el) {
    showFor(el);
    return;
  }
  if (target && node && !target.contains(node)) hide();
}

function onPointerOut(event: PointerEvent): void {
  if (!target) return;
  const next = event.relatedTarget as Node | null;
  if (next && target.contains(next)) return;
  hide();
}

onMounted(() => {
  document.addEventListener("pointerover", onPointerOver, true);
  document.addEventListener("pointerout", onPointerOut, true);
  document.addEventListener("pointerdown", hide, true);
  window.addEventListener("scroll", hide, true);
  window.addEventListener("blur", hide);
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerover", onPointerOver, true);
  document.removeEventListener("pointerout", onPointerOut, true);
  document.removeEventListener("pointerdown", hide, true);
  window.removeEventListener("scroll", hide, true);
  window.removeEventListener("blur", hide);
  hide();
});
</script>

<template>
  <NTooltip
    trigger="manual"
    placement="top"
    :show="show"
    :x="x"
    :y="y"
    :animated="false"
    :style="{ maxWidth: '340px' }"
  >
    {{ text }}
  </NTooltip>
</template>
