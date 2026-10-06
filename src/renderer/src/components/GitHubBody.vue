<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useDialog } from "naive-ui";
import DOMPurify from "dompurify";
import { handleAppLinkClick } from "@renderer/utils/open-link";

const props = withDefaults(
  defineProps<{
    html?: string;
    /** GitHub 图片 URL 白名单（来自详情 enrichment 的 images 映射）。 */
    images?: Record<string, string>;
    empty?: string;
  }>(),
  { html: "", images: () => ({}), empty: "" },
);

const dialog = useDialog();
const root = ref<HTMLElement | null>(null);

const sanitized = computed(() =>
  DOMPurify.sanitize(props.html ?? "", {
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|#)/i,
    ADD_ATTR: ["target", "rel"],
    FORBID_TAGS: ["style", "form", "input", "button"],
  }),
);

const empty = computed(() => !props.html?.trim());

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

async function hydrateImages(): Promise<void> {
  const element = root.value;
  if (!element) return;
  const targets = Array.from(element.querySelectorAll("img"));
  await Promise.all(
    targets.map(async (img) => {
      const source = img.getAttribute("src") ?? "";
      const mapped = props.images[source] ?? source;
      if (!isHttpUrl(mapped) || img.dataset.githubImage === "1") return;
      img.dataset.githubImage = "1";
      const result = await window.api.github.image(mapped);
      if (result.success && img.isConnected) img.src = result.dataUrl;
    }),
  );
}

function onRootClick(event: MouseEvent): void {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const anchor = target.closest("a");
  if (!anchor) return;
  const href = anchor.getAttribute("href") ?? "";
  if (!isHttpUrl(href)) return;
  event.preventDefault();
  handleAppLinkClick(event, href, dialog);
}

watch(
  sanitized,
  () => {
    void nextTick(hydrateImages);
  },
  { immediate: true },
);

onMounted(() => {
  void hydrateImages();
});
</script>

<template>
  <div class="github-body">
    <p v-if="empty" class="github-body-empty">{{ empty }}</p>
    <div
      v-else
      ref="root"
      class="github-body-html"
      @click="onRootClick"
      v-html="sanitized"
    />
  </div>
</template>

<style scoped>
.github-body {
  min-width: 0;
  font-size: 13px;
  line-height: 1.62;
  color: var(--pi-text);
  overflow-wrap: anywhere;
}

.github-body-empty {
  margin: 0;
  color: var(--pi-text-weak);
  font-style: italic;
}

.github-body-html :deep(p) {
  margin: 0 0 0.6em;
}

.github-body-html :deep(p:last-child) {
  margin-bottom: 0;
}

.github-body-html :deep(a) {
  color: var(--pi-accent);
  text-decoration: none;
}

.github-body-html :deep(a:hover) {
  text-decoration: underline;
}

.github-body-html :deep(img) {
  max-width: 100%;
  border-radius: 6px;
  background: rgba(127, 127, 127, 0.08);
}

.github-body-html :deep(pre) {
  margin: 0.6em 0;
  padding: 10px 12px;
  overflow-x: auto;
  border-radius: 6px;
  background: rgba(127, 127, 127, 0.12);
  font-family: var(--pi-font-mono, ui-monospace, monospace);
  font-size: 12px;
}

.github-body-html :deep(code) {
  padding: 1px 4px;
  border-radius: 4px;
  background: rgba(127, 127, 127, 0.14);
  font-family: var(--pi-font-mono, ui-monospace, monospace);
  font-size: 12px;
}

.github-body-html :deep(pre code) {
  padding: 0;
  background: transparent;
}

.github-body-html :deep(blockquote) {
  margin: 0.6em 0;
  padding-left: 12px;
  border-left: 3px solid rgba(127, 127, 127, 0.3);
  color: var(--pi-text-weak);
}

.github-body-html :deep(ul),
.github-body-html :deep(ol) {
  margin: 0.4em 0;
  padding-left: 1.4em;
}

.github-body-html :deep(table) {
  border-collapse: collapse;
  margin: 0.6em 0;
}

.github-body-html :deep(th),
.github-body-html :deep(td) {
  border: 1px solid rgba(127, 127, 127, 0.3);
  padding: 4px 8px;
}

.github-body-html :deep(h1),
.github-body-html :deep(h2),
.github-body-html :deep(h3),
.github-body-html :deep(h4) {
  margin: 0.8em 0 0.4em;
  font-size: 14px;
}

.github-body-html :deep(details) {
  margin: 0.5em 0;
}
</style>
