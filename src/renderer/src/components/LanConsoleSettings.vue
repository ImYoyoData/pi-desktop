<script setup lang="ts">
import { onMounted, ref } from "vue";
import { NButton, NInput, NInputNumber, NSpace, NSwitch, NText, useMessage } from "naive-ui";
import QRCode from "qrcode";
import type { LanConsoleStatus } from "../../../shared/protocol";
import { t } from "@renderer/i18n";

const message = useMessage();
const status = ref<LanConsoleStatus | null>(null);
const loading = ref(false);
const savingPort = ref(false);
const savingCreds = ref(false);
const savingIp = ref(false);
const portDraft = ref(18700);
const usernameDraft = ref("");
const passwordDraft = ref("");
const qrDataUrl = ref<string | null>(null);

async function updateQr(): Promise<void> {
  const url = status.value?.url;
  if (!url || !status.value?.enabled) {
    qrDataUrl.value = null;
    return;
  }
  try {
    qrDataUrl.value = await QRCode.toDataURL(url, { margin: 1, width: 176, errorCorrectionLevel: "M" });
  } catch {
    qrDataUrl.value = null;
  }
}

async function refresh(): Promise<void> {
  loading.value = true;
  try {
    status.value = await window.api.lanConsole.getStatus();
    portDraft.value = status.value.port;
    usernameDraft.value = status.value.username;
    passwordDraft.value = "";
    await updateQr();
  } finally {
    loading.value = false;
  }
}

async function onToggle(enabled: boolean): Promise<void> {
  if (enabled && !status.value?.hasCredentials) {
    message.warning(t.lanConsoleCredsRequired);
    return;
  }
  try {
    status.value = await window.api.lanConsole.setEnabled(enabled);
    await updateQr();
    if (enabled) message.success(t.lanConsoleStarted);
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
    await refresh();
  }
}

async function onSavePort(): Promise<void> {
  const p = Math.floor(Number(portDraft.value));
  if (!p || p < 1 || p > 65535) {
    message.warning(t.lanConsolePortInvalid);
    return;
  }
  savingPort.value = true;
  try {
    status.value = await window.api.lanConsole.setPort(p);
    await updateQr();
    message.success(t.lanConsolePortSaved);
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  } finally {
    savingPort.value = false;
  }
}

async function onSaveCredentials(): Promise<void> {
  const u = usernameDraft.value.trim();
  const p = passwordDraft.value;
  if (!u || !p) {
    message.warning(t.lanConsoleCredsRequired);
    return;
  }
  savingCreds.value = true;
  try {
    status.value = await window.api.lanConsole.setCredentials(u, p);
    passwordDraft.value = "";
    message.success(t.lanConsoleCredsSaved);
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  } finally {
    savingCreds.value = false;
  }
}

async function onPickIp(ip: string): Promise<void> {
  if (!ip || ip === status.value?.preferredIp || savingIp.value) return;
  savingIp.value = true;
  try {
    status.value = await window.api.lanConsole.setPreferredIp(ip);
    await updateQr();
    message.success(t.lanConsoleIpSaved);
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  } finally {
    savingIp.value = false;
  }
}

async function onCopy(): Promise<void> {
  if (!status.value?.url) return;
  try {
    await navigator.clipboard.writeText(status.value.url);
    message.success(t.lanConsoleCopied);
  } catch {
    message.warning(t.lanConsoleCopyFailed);
  }
}

function onOpenBrowser(): void {
  if (status.value?.url) void window.api.browser.openExternal(status.value.url);
}

onMounted(() => {
  void refresh();
});
</script>

<template>
  <div class="lan-panel modal-scroll">
    <div class="head">
      <span class="title">{{ t.lanConsoleTitle }}</span>
      <NSwitch
        :value="Boolean(status?.enabled)"
        size="small"
        :loading="loading"
        @update:value="(v) => void onToggle(Boolean(v))"
      />
    </div>
    <NText depth="3" style="font-size: 12px; display: block; line-height: 1.5; margin-bottom: 10px">
      {{ t.lanConsoleEnableHint }}
    </NText>

    <!-- Credentials (username / password) -->
    <div class="block">
      <div class="label">{{ t.lanConsoleCreds }}</div>
      <div style="display: flex; gap: 6px; margin-top: 6px; flex-wrap: wrap">
        <NInput v-model:value="usernameDraft" size="small" :placeholder="t.lanConsoleUsername" style="width: 110px" />
        <NInput
          v-model:value="passwordDraft"
          size="small"
          type="password"
          show-password-on="click"
          :placeholder="t.lanConsolePassword"
          style="width: 110px"
        />
        <NButton size="small" secondary :loading="savingCreds" @click="onSaveCredentials">
          {{ t.lanConsoleSaveCreds }}
        </NButton>
      </div>
      <NText depth="3" style="font-size: 11.5px; display: block; margin-top: 6px">
        {{ t.lanConsoleCredsHint }}
      </NText>
    </div>

    <template v-if="status?.enabled">
      <div class="block">
        <div class="label">{{ t.lanConsoleUrl }}</div>
        <div class="url">{{ status.baseUrl }}</div>
        <NSpace :size="6" style="margin-top: 6px; flex-wrap: wrap">
          <NButton size="tiny" secondary @click="onCopy">{{ t.lanConsoleCopy }}</NButton>
          <NButton size="tiny" secondary @click="onOpenBrowser">{{ t.lanConsoleOpenBrowser }}</NButton>
        </NSpace>
        <NText depth="3" style="font-size: 11.5px; display: block; margin-top: 8px; line-height: 1.45">
          {{ t.lanConsoleCertHint }}
        </NText>
      </div>

      <div v-if="status.addresses.length > 1" class="block">
        <div class="label">{{ t.lanConsoleAddresses }}</div>
        <NText depth="3" style="font-size: 11.5px; display: block; margin-top: 4px; line-height: 1.45">
          {{ t.lanConsoleAddressesHint }}
        </NText>
        <div class="ip-list">
          <button
            v-for="(ip, idx) in status.addresses"
            :key="ip"
            type="button"
            class="ip-chip"
            :class="{ on: ip === status.preferredIp }"
            :disabled="savingIp"
            @click="onPickIp(ip)"
          >
            <span class="ip-addr">{{ ip }}</span>
            <span v-if="idx === 0" class="ip-tag">{{ t.lanConsoleRecommended }}</span>
          </button>
        </div>
      </div>

      <div v-if="qrDataUrl" class="qr-wrap">
        <img :src="qrDataUrl" alt="QR" class="qr" />
        <span class="qr-hint">{{ t.lanConsoleScan }}</span>
      </div>

      <div class="block">
        <div class="label">{{ t.lanConsolePort }}</div>
        <div style="display: flex; gap: 6px; margin-top: 6px">
          <NInputNumber v-model:value="portDraft" size="small" style="width: 110px" />
          <NButton size="small" secondary :loading="savingPort" @click="onSavePort">
            {{ t.lanConsoleSavePort }}
          </NButton>
        </div>
      </div>
    </template>

    <NText v-else depth="3" style="font-size: 12px; display: block">
      {{ t.lanConsoleDisabledNote }}
    </NText>
  </div>
</template>

<style scoped>
.lan-panel {
  width: 100%;
  max-width: 360px;
  max-height: min(72vh, 580px);
  overflow-x: hidden;
  overflow-y: auto;
  padding: 12px 14px 14px;
  box-sizing: border-box;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
}
.title {
  font-size: 13px;
  font-weight: 650;
  color: var(--fg, #1f2328);
}
.block {
  margin-top: 10px;
}
.label {
  font-size: 12px;
  font-weight: 600;
  color: var(--fg, #1f2328);
}
.url {
  font-size: 12px;
  color: var(--muted, #6b7280);
  word-break: break-all;
  margin-top: 3px;
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
}
.ip-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 8px;
}
.ip-chip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--border, #e6e8ec);
  background: var(--bg, #f4f6f8);
  color: var(--fg, #1f2328);
  cursor: pointer;
  text-align: left;
  font: inherit;
}
.ip-chip:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--accent, #2563eb) 45%, var(--border, #e6e8ec));
}
.ip-chip.on {
  border-color: var(--accent, #2563eb);
  background: color-mix(in srgb, var(--accent, #2563eb) 12%, transparent);
}
.ip-chip:disabled {
  opacity: 0.7;
  cursor: default;
}
.ip-addr {
  font-size: 12.5px;
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
}
.ip-tag {
  font-size: 10.5px;
  color: var(--accent, #2563eb);
  font-weight: 600;
  flex-shrink: 0;
}
.qr-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
}
.qr {
  width: 110px;
  height: 110px;
  border-radius: 8px;
  background: #fff;
  padding: 5px;
}
.qr-hint {
  font-size: 11.5px;
  color: var(--muted, #6b7280);
}
</style>
