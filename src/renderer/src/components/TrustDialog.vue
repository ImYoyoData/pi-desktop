<script setup lang="ts">
import { NModal, NText, NButton, NSpace } from "naive-ui";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import { t } from "@renderer/i18n";

const workspace = useWorkspaceStore();

async function onTrust(): Promise<void> {
  await workspace.answerTrustPrompt("trust");
}

async function onDontTrust(): Promise<void> {
  await workspace.answerTrustPrompt("dont_trust");
}
</script>

<template>
  <NModal
    :show="workspace.trustDialogOpen"
    preset="card"
    class="pi-settings-modal"
    style="width: min(440px, 92vw)"
    :title="t.trustDialogTitle"
    :bordered="false"
    :mask-closable="false"
    :close-on-esc="false"
    :closable="false"
    size="medium"
  >
    <NText depth="3" class="body">
      {{ t.trustDialogBody }}
    </NText>
    <NText
      v-if="workspace.pendingTrustPrompt"
      depth="3"
      class="path"
    >
      {{ workspace.pendingTrustPrompt }}
    </NText>

    <template #footer>
      <div class="footer">
        <NSpace :size="8">
          <NButton size="small" @click="onDontTrust">{{ t.trustDialogDontTrust }}</NButton>
          <NButton size="small" type="primary" @click="onTrust">{{ t.trustDialogTrust }}</NButton>
        </NSpace>
      </div>
    </template>
  </NModal>
</template>

<style scoped>
.body {
  font-size: 12px;
  line-height: 1.45;
  display: block;
}
.path {
  font-size: 11px;
  display: block;
  margin-top: 8px;
  word-break: break-all;
}
.footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
}
</style>
