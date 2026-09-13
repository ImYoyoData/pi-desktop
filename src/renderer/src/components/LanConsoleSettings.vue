<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { NButton, NInputNumber, NSpace, NSwitch, NText, useMessage } from "naive-ui";
import QRCode from "qrcode";
import type { CloudflareTunnelStatus, LanConsoleStatus } from "../../../shared/protocol";
import { t } from "@renderer/i18n";

const message = useMessage();
const status = ref<LanConsoleStatus | null>(null);
const tunnel = ref<CloudflareTunnelStatus | null>(null);
const loading = ref(false);
const togglingPublic = ref(false);
const rotatingPin = ref(false);
const savingPort = ref(false);
const savingIp = ref(false);
const portDraft = ref(18700);
const qrDataUrl = ref<string | null>(null);
let offTunnelStatus: (() => void) | null = null;

/** Public URL when the tunnel is up, else the LAN one. */
const publicUrl = computed(() => status.value?.tunnel.url ?? status.value?.publicUrl ?? null);
const tunnelBusy = computed(() =>
  ["downloading", "starting"].includes(String(status.value?.tunnel.phase ?? "off")),
);
const tunnelError = computed(() => status.value?.tunnel.error ?? null);
const lanBroken = computed(() => Boolean(status.value?.enabled) && !status.value?.listening);

async function updateQr(): Promise<void> {
  const url = status.value?.listening ? status.value?.url : null;
  if (!url) {
    qrDataUrl.value = null;
    return;
  }
  try {
    qrDataUrl.value = await QRCode.toDataURL(url, { margin: 1, width: 176, errorCorrectionLevel: "M" });
  } catch {
    qrDataUrl.value = null;
  }
}

function applyStatus(next: LanConsoleStatus): void {
  status.value = next;
  tunnel.value = next.tunnel;
  portDraft.value = next.port;
}

async function refresh(): Promise<void> {
  loading.value = true;
  try {
    applyStatus(await window.api.lanConsole.getStatus());
    await updateQr();
  } finally {
    loading.value = false;
  }
}

async function onToggleLan(enabled: boolean): Promise<void> {
  try {
    applyStatus(await window.api.lanConsole.setEnabled(enabled));
    await updateQr();
    message.success(enabled ? t.lanConsoleStarted : t.lanConsoleStopped);
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
    await refresh();
  }
}

async function onTogglePublic(enabled: boolean): Promise<void> {
  togglingPublic.value = true;
  try {
    applyStatus(await window.api.lanConsole.setPublicAccess(enabled));
    await updateQr();
    if (!enabled) message.success(t.lanPublicOff);
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
    await refresh();
  } finally {
    togglingPublic.value = false;
  }
}

async function onRotatePin(): Promise<void> {
  rotatingPin.value = true;
  try {
    applyStatus(await window.api.lanConsole.rotatePin());
    message.success(t.lanConsolePinRotated);
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  } finally {
    rotatingPin.value = false;
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
    applyStatus(await window.api.lanConsole.setPort(p));
    await updateQr();
    message.success(t.lanConsolePortSaved);
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  } finally {
    savingPort.value = false;
  }
}

async function onPickIp(ip: string): Promise<void> {
  if (!ip || ip === status.value?.preferredIp || savingIp.value) return;
  savingIp.value = true;
  try {
    applyStatus(await window.api.lanConsole.setPreferredIp(ip));
    await updateQr();
    message.success(t.lanConsoleIpSaved);
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  } finally {
    savingIp.value = false;
  }
}

async function copyUrl(which: "lan" | "public"): Promise<void> {
  const url = which === "public" ? publicUrl.value : status.value?.url;
  if (!url) return;
  try {
    await navigator.clipboard.writeText(url);
    message.success(t.lanConsoleCopied);
  } catch {
    message.warning(t.lanConsoleCopyFailed);
  }
}

async function onRetryPublic(): Promise<void> {
  await onTogglePublic(false);
  await onTogglePublic(true);
}

function openBrowser(): void {
  const url = publicUrl.value ?? status.value?.url;
  if (url) void window.api.browser.openExternal(url);
}

onMounted(() => {
  void refresh();
  offTunnelStatus = window.api.lanConsole.onTunnelStatus((next) => {
    tunnel.value = next;
    if (status.value) status.value = { ...status.value, tunnel: next, publicUrl: next.url };
  });
});

onUnmounted(() => {
  offTunnelStatus?.();
  offTunnelStatus = null;
});
</script>

<template>
  <div class="lan-panel modal-scroll">
    <div class="head">
      <div class="head-text">
        <span class="title">{{ t.lanConsoleTitle }}</span>
        <span class="state" :class="{ on: Boolean(status?.listening) }">
          {{ status?.listening ? t.lanConsoleOn : "" }}
        </span>
      </div>
      <NSwitch
        :value="Boolean(status?.enabled)"
        size="small"
        :loading="loading"
        @update:value="(v) => void onToggleLan(Boolean(v))"
      />
    </div>
    <NText depth="3" class="hint">{{ t.lanConsoleEnableHint }}</NText>

    <!-- Access PIN (single 9-digit numeric code) -->
    <div class="block">
      <div class="label">{{ t.lanConsolePin }}</div>
      <div class="pin-row">
        <span class="pin">{{ status?.pin ?? "---------" }}</span>
        <NButton size="tiny" secondary :loading="rotatingPin" @click="onRotatePin">
          {{ t.lanConsolePinRotate }}
        </NButton>
      </div>
      <NText depth="3" class="hint tight">{{ t.lanConsolePinHint }}</NText>
    </div>

    <template v-if="status?.enabled">
      <div v-if="lanBroken" class="block">
        <NText class="warn tight">{{ t.lanConsolePortBusy }}</NText>
      </div>

      <template v-else>
        <div class="block">
          <div class="label">{{ t.lanConsoleUrl }}</div>
          <div class="url">{{ status.baseUrl }}</div>
          <NSpace :size="6" class="row">
            <NButton size="tiny" secondary @click="copyUrl('lan')">{{ t.lanConsoleCopy }}</NButton>
            <NButton size="tiny" secondary @click="openBrowser">{{ t.lanConsoleOpenBrowser }}</NButton>
          </NSpace>
          <NText depth="3" class="hint tight">{{ t.lanConsoleCertHint }}</NText>
        </div>

        <div v-if="status.addresses.length > 1" class="block">
          <div class="label">{{ t.lanConsoleAddresses }}</div>
          <NText depth="3" class="hint tight">{{ t.lanConsoleAddressesHint }}</NText>
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
      </template>

      <!-- Public access: Cloudflare quick tunnel -->
      <div class="block public">
        <div class="head">
          <span class="label">{{ t.lanPublicTitle }}</span>
          <NSwitch
            :value="Boolean(status.publicAccess)"
            size="small"
            :loading="togglingPublic"
            @update:value="(v) => void onTogglePublic(Boolean(v))"
          />
        </div>
        <NText depth="3" class="hint tight">{{ t.lanPublicHint }}</NText>

        <template v-if="status.publicAccess">
          <div v-if="tunnelBusy" class="hint tight pending">
            {{ status.tunnel.phase === "downloading" ? t.lanPublicDownloading : t.lanPublicStarting }}
          </div>
          <template v-else-if="publicUrl">
            <div class="url">{{ publicUrl }}</div>
            <NSpace :size="6" class="row">
              <NButton size="tiny" secondary @click="copyUrl('public')">{{ t.lanConsoleCopy }}</NButton>
              <NButton size="tiny" secondary @click="openBrowser">{{ t.lanConsoleOpenBrowser }}</NButton>
            </NSpace>
            <NText depth="3" class="hint tight">{{ t.lanPublicTemporary }}</NText>
          </template>
          <div v-else-if="tunnelError" class="hint tight err">
            {{ t.lanPublicFailed }}：{{ tunnelError }}
            <NButton size="tiny" secondary class="retry" @click="onRetryPublic">
              {{ t.lanPublicRetry }}
            </NButton>
          </div>
          <NText v-if="!status.tunnel.installed" depth="3" class="hint tight">
            {{ t.lanPublicNotInstalled }}
          </NText>
          <NText class="warn tight">{{ t.lanPublicWarning }}</NText>
        </template>
      </div>

      <div class="block">
        <div class="label">{{ t.lanConsolePort }}</div>
        <div class="row">
          <NInputNumber v-model:value="portDraft" size="small" style="width: 110px" />
          <NButton size="small" secondary :loading="savingPort" @click="onSavePort">
            {{ t.lanConsoleSavePort }}
          </NButton>
        </div>
      </div>
    </template>

    <NText v-else depth="3" class="hint">{{ t.lanConsoleDisabledNote }}</NText>
  </div>
</template>

<style scoped>
.lan-panel {
  width: 100%;
  max-width: 364px;
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
.head-text {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}
.title {
  font-size: 13px;
  font-weight: 650;
  color: var(--fg, #1f2328);
}
.state {
  font-size: 10.5px;
  font-weight: 600;
  color: var(--muted, #6b7280);
}
.state.on {
  color: var(--accent, #2563eb);
}
.hint {
  font-size: 12px;
  display: block;
  line-height: 1.5;
  margin-bottom: 10px;
}
.hint.tight {
  font-size: 11.5px;
  margin-top: 6px;
  margin-bottom: 0;
  line-height: 1.45;
}
.hint.pending {
  margin-top: 8px;
  color: var(--accent, #2563eb);
}
.hint.err {
  margin-top: 8px;
  color: #d03050;
  word-break: break-word;
}
.warn {
  font-size: 11.5px;
  line-height: 1.45;
  color: #d97706;
  display: block;
  margin-top: 6px;
}
.warn.tight {
  margin-top: 8px;
}
.block {
  margin-top: 10px;
}
.block.public {
  margin-top: 14px;
  padding-top: 10px;
  border-top: 1px solid var(--border, #e6e8ec);
}
.label {
  font-size: 12px;
  font-weight: 600;
  color: var(--fg, #1f2328);
}
.row {
  display: flex;
  gap: 6px;
  margin-top: 6px;
  flex-wrap: wrap;
  align-items: center;
}
.retry {
  margin-left: 6px;
}
.pin-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 6px;
}
.pin {
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  font-size: 21px;
  font-weight: 650;
  letter-spacing: 0.16em;
  color: var(--fg, #1f2328);
  user-select: all;
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
