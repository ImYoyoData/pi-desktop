<script setup lang="ts">
/**
 * Diff tab — the read-only diff surface behind the right-dock Changes view.
 * Clicking a file in the dock reveals it here (VS Code opens the diff in an
 * editor beside the chat); no git panel chrome.
 */
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { NEmpty, NSpin } from "naive-ui";
import ChangesDiffEditor from "@renderer/components/ChangesDiffEditor.vue";
import { t } from "@renderer/i18n";

const props = defineProps<{
  filePath?: string | null;
  visible?: boolean;
}>();

const loading = ref(false);
const supported = ref(true);
const errorText = ref("");
const oldContent = ref("");
const newContent = ref("");
let loadGen = 0;
let fsTimer: ReturnType<typeof setTimeout> | null = null;

async function load(path: string): Promise<void> {
  const gen = ++loadGen;
  loading.value = true;
  errorText.value = "";
  try {
    const result = await window.api.git.diff(path);
    if (gen !== loadGen) return;
    supported.value = result.supported;
    if (result.supported) {
      oldContent.value = result.oldContent ?? "";
      newContent.value = result.newContent ?? "";
    }
  } catch (err) {
    if (gen !== loadGen) return;
    supported.value = false;
    errorText.value = err instanceof Error ? err.message : String(err);
  } finally {
    if (gen === loadGen) loading.value = false;
  }
}

watch(
  () => props.filePath,
  (path) => {
    if (path) void load(path);
  },
  { immediate: true },
);

function onFsChanged(): void {
  if (!props.visible || !props.filePath) return;
  if (fsTimer) clearTimeout(fsTimer);
  fsTimer = setTimeout(() => {
    fsTimer = null;
    if (props.filePath) void load(props.filePath);
  }, 400);
}

onMounted(() => window.addEventListener("pi-fs-changed", onFsChanged));

onBeforeUnmount(() => {
  window.removeEventListener("pi-fs-changed", onFsChanged);
  if (fsTimer) clearTimeout(fsTimer);
  loadGen += 1;
});
</script>

<template>
  <NSpin :show="loading" size="small" class="diff-tab">
    <div v-if="!filePath || !supported" class="empty-wrap">
      <NEmpty :description="errorText || t.changesNoDiff" size="small" />
    </div>
    <ChangesDiffEditor
      v-else
      :file-path="filePath"
      :old-content="oldContent"
      :new-content="newContent"
    />
  </NSpin>
</template>

<style scoped>
.diff-tab {
  height: 100%;
  min-height: 0;
}

.diff-tab :deep(.n-spin-content) {
  height: 100%;
}

.empty-wrap {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
