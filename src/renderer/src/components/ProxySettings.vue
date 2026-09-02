<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  NModal,
  NRadioGroup,
  NRadioButton,
  NInput,
  NText,
  NButton,
  useMessage,
} from "naive-ui";
import {
  normalizeProxyUrl,
  type ProxyMode,
} from "../../../shared/proxy";
import { t } from "@renderer/i18n";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const message = useMessage();

const mode = ref<ProxyMode>("off");
const url = ref("");
let loaded = false;

watch(
  () => props.open,
  async (open) => {
    if (!open) {
      loaded = false;
      return;
    }
    try {
      const current = await window.api.proxy.get();
      mode.value = current.mode;
      url.value = current.url;
    } catch {
    } finally {
      loaded = true;
    }
  },
);

let applyChain: Promise<void> = Promise.resolve();

function apply(showSuccess = false): void {
  applyChain = applyChain.then(async () => {
    try {
      const applied = await window.api.proxy.set({
        mode: mode.value,
        url: url.value.trim(),
      });
      mode.value = applied.mode;
      url.value = applied.url;
      if (showSuccess) message.success(t.proxyApplied);
    } catch {
      message.error(t.proxyInvalidUrl);
    }
  });
}

watch(mode, (next, prev) => {
  if (!loaded || next === prev) return;
  if (next === "custom" && !normalizeProxyUrl(url.value)) return;
  apply(true);
});

let urlTimer: ReturnType<typeof setTimeout> | undefined;
watch(url, () => {
  if (!loaded || mode.value !== "custom") return;
  clearTimeout(urlTimer);
  urlTimer = setTimeout(() => {
    if (normalizeProxyUrl(url.value)) apply();
  }, 600);
});

const urlInvalid = computed(
  () =>
    mode.value === "custom" &&
    url.value.trim().length > 0 &&
    normalizeProxyUrl(url.value) === null,
);
</script>

<template>
  <NModal
    :show="props.open"
    preset="card"
    class="pi-settings-modal"
    style="width: min(520px, 92vw)"
    :title="t.proxyTitle"
    :bordered="false"
    size="huge"
    @update:show="(v) => !v && emit('close')"
  >
    <div class="modal-scroll">
      <div class="section">
        <NRadioGroup v-model:value="mode" size="small">
          <NRadioButton value="off">{{ t.proxyModeOff }}</NRadioButton>
          <NRadioButton value="system">{{ t.proxyModeSystem }}</NRadioButton>
          <NRadioButton value="custom">{{ t.proxyModeCustom }}</NRadioButton>
        </NRadioGroup>
      </div>

      <div v-if="mode === 'custom'" class="section" style="margin-top: 16px">
        <NText strong style="font-size: 13px; display: block; margin-bottom: 6px">
          {{ t.proxyUrlLabel }}
        </NText>
        <NInput
          v-model:value="url"
          size="small"
          :status="urlInvalid ? 'error' : undefined"
          :placeholder="t.proxyUrlPlaceholder"
        />
      </div>
    </div>
    <template #footer>
      <div class="footer">
        <NButton @click="emit('close')">{{ t.close }}</NButton>
      </div>
    </template>
  </NModal>
</template>

<style scoped>
.section {
  display: flex;
  flex-direction: column;
}
.footer {
  display: flex;
  justify-content: flex-end;
}
</style>
