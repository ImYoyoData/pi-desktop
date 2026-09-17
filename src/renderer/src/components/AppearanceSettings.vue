<script setup lang="ts">
import { NButton, NModal } from "naive-ui";
import AppearancePanel from "@renderer/components/AppearancePanel.vue";
import { t } from "@renderer/i18n";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();
</script>

<template>
  <NModal
    :show="props.open"
    preset="card"
    class="pi-settings-modal"
    style="width: min(520px, 92vw)"
    :title="t.appearance"
    :bordered="false"
    size="huge"
    @update:show="(v) => !v && emit('close')"
  >
    <div class="modal-scroll">
      <AppearancePanel />
    </div>
    <template #footer>
      <div class="footer">
        <NButton @click="emit('close')">{{ t.close }}</NButton>
      </div>
    </template>
  </NModal>
</template>

<style scoped>
.footer {
  display: flex;
  justify-content: flex-end;
}
</style>
