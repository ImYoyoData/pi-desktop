<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  NButton,
  NInput,
  NModal,
  NRadioButton,
  NRadioGroup,
  NSelect,
  NSpace,
  NText,
} from "naive-ui";
import CodiconIcon from "@renderer/components/icons/CodiconIcon.vue";
import { t } from "@renderer/i18n";

const props = defineProps<{
  show: boolean;
  workspaces: string[];
}>();

const emit = defineEmits<{
  close: [];
  added: [];
}>();

type Method = "form" | "json";
type Transport = "command" | "url" | "sse";
type Protocol = "auto" | "2026-07-28" | "legacy";

const scope = ref<string>("user");
const method = ref<Method>("form");
const transport = ref<Transport>("command");
const name = ref("");
const command = ref("");
const args = ref("");
const url = ref("");
const env = ref("");
const timeout = ref("");
const protocol = ref<Protocol>("auto");
const headers = ref("");
const headersOpen = ref(false);
const json = ref("");
const error = ref("");
const saving = ref(false);

watch(
  () => props.show,
  (open) => {
    if (!open) return;
    scope.value = "user";
    method.value = "form";
    transport.value = "command";
    name.value = "";
    command.value = "";
    args.value = "";
    url.value = "";
    env.value = "";
    timeout.value = "";
    protocol.value = "auto";
    headers.value = "";
    headersOpen.value = false;
    json.value = "";
    error.value = "";
    saving.value = false;
  },
);

function baseName(target: string): string {
  return target.split(/[\\/]/).filter(Boolean).pop() ?? target;
}

/** 工作区重名时显示完整路径以便区分。 */
function workspaceLabel(target: string): string {
  const base = baseName(target);
  const duplicated = props.workspaces.filter((p) => baseName(p) === base).length > 1;
  return duplicated ? target : base;
}

const scopeOptions = computed(() => [
  { label: t.customizeGroupUser, value: "user" },
  ...props.workspaces.map((target) => ({ label: workspaceLabel(target), value: target })),
]);

const transportOptions = computed(() => [
  { label: t.customizeMcpTransportCommand, value: "command" },
  { label: t.customizeMcpTransportUrl, value: "url" },
  { label: t.customizeMcpTransportSse, value: "sse" },
]);

const protocolOptions = computed(() => [
  { label: t.customizeMcpProtocolAuto, value: "auto" },
  { label: t.customizeMcpProtocolNew, value: "2026-07-28" },
  { label: t.customizeMcpProtocolLegacy, value: "legacy" },
]);

function parseEnv(text: string): Record<string, string> | undefined {
  const entries = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const index = line.indexOf("=");
      if (index <= 0) throw new Error(t.customizeMcpEnvInvalid);
      return [line.slice(0, index).trim(), line.slice(index + 1)] as const;
    });
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function parseHeaders(text: string): Record<string, string> | undefined {
  const entries = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const index = line.indexOf(":");
      if (index <= 0) throw new Error(t.customizeMcpHeadersInvalid);
      return [line.slice(0, index).trim(), line.slice(index + 1).trim()] as const;
    });
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function buildEntry(): Record<string, unknown> {
  const entry: Record<string, unknown> = {};
  if (transport.value === "command") {
    entry.command = command.value.trim();
    const list = args.value.trim() ? args.value.trim().split(/\s+/) : [];
    if (list.length) entry.args = list;
    const envMap = parseEnv(env.value);
    if (envMap) entry.env = envMap;
  } else {
    entry.url = url.value.trim();
    if (transport.value === "sse") entry.httpTransport = "sse";
    entry.protocolVersion = protocol.value;
    const headerMap = parseHeaders(headers.value);
    if (headerMap) entry.headers = headerMap;
  }
  const rawTimeout = timeout.value.trim();
  if (rawTimeout) {
    const ms = Number(rawTimeout);
    if (!Number.isInteger(ms) || ms <= 0) throw new Error(t.customizeMcpTimeoutInvalid);
    entry.requestTimeoutMs = ms;
  }
  return entry;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function looksLikeEntry(value: Record<string, unknown>): boolean {
  return value.command !== undefined || value.url !== undefined || value.socket !== undefined;
}

/** 归一化外部格式：VS Code/Cursor 的 type、opencode 的数组 command 与 environment。 */
function normalizeEntry(entry: Record<string, unknown>): Record<string, unknown> {
  const next = { ...entry };
  const type = next.type;
  delete next.type;
  if (type === "sse" && next.httpTransport === undefined) next.httpTransport = "sse";
  if (next.env === undefined && isRecord(next.environment)) {
    next.env = next.environment;
    delete next.environment;
  }
  if (
    Array.isArray(next.command) &&
    next.command.length > 0 &&
    next.command.every((part) => typeof part === "string")
  ) {
    const [command, ...args] = next.command as string[];
    next.command = command;
    if (next.args === undefined && args.length) next.args = args;
  }
  return next;
}

/** 名称 → 服务器定义的映射；不是映射时返回 null。 */
function mapServers(source: Record<string, unknown>): Record<string, unknown> | null {
  const entries = Object.entries(source);
  if (entries.length === 0) return null;
  if (!entries.every(([, value]) => isRecord(value))) return null;
  return Object.fromEntries(
    entries.map(([key, value]) => [key, normalizeEntry(value as Record<string, unknown>)]),
  );
}

/** 剥离行注释与块注释，保护字符串字面量。 */
function stripJsonComments(text: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text.charAt(i);
    if (inString) {
      out += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }
    if (char === "/" && text.charAt(i + 1) === "/") {
      while (i < text.length && text.charAt(i) !== "\n") i += 1;
      out += "\n";
      continue;
    }
    if (char === "/" && text.charAt(i + 1) === "*") {
      i += 2;
      while (i < text.length && !(text.charAt(i) === "*" && text.charAt(i + 1) === "/")) i += 1;
      i += 1;
      continue;
    }
    out += char;
  }
  return out;
}

/** 去掉对象/数组末尾多余的逗号，保护字符串字面量。 */
function stripTrailingCommas(text: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text.charAt(i);
    if (inString) {
      out += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }
    if (char === ",") {
      let j = i + 1;
      while (j < text.length && /\s/.test(text.charAt(j))) j += 1;
      if (text.charAt(j) === "}" || text.charAt(j) === "]") continue;
    }
    out += char;
  }
  return out;
}

/** 容忍从编辑器复制的 JSONC（注释与尾逗号）。 */
function parseLooseJson(text: string): unknown {
  return JSON.parse(stripTrailingCommas(stripJsonComments(text)));
}

/** 拆分「名称 + JSON 对象」片段，如 `playwright { ... }` 或 `"playwright": { ... }`。 */
function splitNamedEntry(text: string): { name: string; json: string } | null {
  const start = text.indexOf("{");
  if (start <= 0) return null;
  const name = text
    .slice(0, start)
    .trim()
    .replace(/[:=]\s*$/, "")
    .trim()
    .replace(/^["']+/, "")
    .replace(/["']+$/, "")
    .trim();
  if (!name || /[\s{}[\]]/.test(name)) return null;
  return { name, json: text.slice(start).replace(/,\s*$/, "") };
}

function parseJsonServers(text: string, fallbackName: string): Record<string, unknown> {
  const trimmed = text.trim();
  let parsed: unknown;
  try {
    parsed = parseLooseJson(trimmed);
  } catch {
    const named = splitNamedEntry(trimmed);
    if (!named) throw new Error(t.customizeMcpJsonInvalid);
    let entry: unknown;
    try {
      entry = parseLooseJson(named.json);
    } catch {
      throw new Error(t.customizeMcpJsonInvalid);
    }
    if (!isRecord(entry) || !looksLikeEntry(entry)) throw new Error(t.customizeMcpJsonInvalid);
    return { [named.name]: normalizeEntry(entry) };
  }
  if (!isRecord(parsed)) throw new Error(t.customizeMcpJsonInvalid);

  const nested =
    parsed.mcpServers ?? parsed["mcp-servers"] ?? parsed.mcp_servers ?? parsed.servers;
  if (nested !== undefined) {
    const servers = isRecord(nested) ? mapServers(nested) : null;
    if (!servers) throw new Error(t.customizeMcpJsonInvalid);
    return servers;
  }

  const servers = mapServers(parsed);
  if (servers) return servers;

  if (looksLikeEntry(parsed)) {
    const serverName = fallbackName.trim();
    if (!serverName) throw new Error(t.customizeMcpNameRequired);
    return { [serverName]: normalizeEntry(parsed) };
  }

  throw new Error(t.customizeMcpJsonInvalid);
}

function buildServers(): Record<string, unknown> {
  if (method.value === "json") return parseJsonServers(json.value, name.value);
  const serverName = name.value.trim();
  if (!serverName) throw new Error(t.customizeMcpNameRequired);
  if (transport.value === "command" && !command.value.trim()) {
    throw new Error(t.customizeMcpTargetRequired);
  }
  if (transport.value !== "command" && !url.value.trim()) {
    throw new Error(t.customizeMcpTargetRequired);
  }
  return { [serverName]: buildEntry() };
}

async function submit(): Promise<void> {
  error.value = "";
  let servers: Record<string, unknown>;
  try {
    servers = buildServers();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
    return;
  }
  saving.value = true;
  try {
    const userScope = scope.value === "user";
    await window.api.customizations.addMcpServers(
      userScope ? "user" : "project",
      servers,
      userScope ? undefined : scope.value,
    );
    emit("added");
    emit("close");
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    class="pi-settings-modal mcp-add-modal"
    style="width: min(600px, 92vw)"
    :bordered="false"
    :mask-closable="false"
    @close="emit('close')"
    @update:show="(value: boolean) => !value && emit('close')"
  >
    <template #header>
      <div class="modal-title-block">
        <div class="modal-title">{{ t.customizeMcpAddTitle }}</div>
        <div class="modal-subtitle">{{ t.customizeMcpAddSubtitle }}</div>
      </div>
    </template>

    <template #header-extra>
      <NRadioGroup v-model:value="method" size="small" name="mcp-add-method">
        <NRadioButton value="form">{{ t.customizeMcpAddForm }}</NRadioButton>
        <NRadioButton value="json">{{ t.customizeMcpAddJson }}</NRadioButton>
      </NRadioGroup>
    </template>

    <div class="section mcp-form-card">
      <div class="field-row">
        <div class="field name-field">
          <span class="field-label">{{ t.customizeMcpName }}</span>
          <NInput
            v-model:value="name"
            size="small"
            :placeholder="method === 'form' ? t.customizeMcpNameExample : t.customizeMcpJsonNameHint"
          />
        </div>
        <div class="scope-field">
          <span class="field-label">{{ t.customizeMcpAddScope }}</span>
          <NSelect
            v-model:value="scope"
            size="small"
            class="scope-select"
            :options="scopeOptions"
          />
        </div>
      </div>

      <template v-if="method === 'form'">
        <div class="field">
          <span class="field-label">{{ t.customizeMcpTransport }}</span>
          <NSelect
            v-model:value="transport"
            size="small"
            class="narrow-select"
            :options="transportOptions"
          />
        </div>

        <div class="field">
          <span class="field-label">{{ t.customizeMcpTimeout }}</span>
          <NInput v-model:value="timeout" size="small" class="narrow-input" placeholder="30000" />
        </div>

        <template v-if="transport !== 'command'">
          <div class="field">
            <span class="field-label">{{ t.customizeMcpProtocol }}</span>
            <NSelect
              v-model:value="protocol"
              size="small"
              class="narrow-select"
              :options="protocolOptions"
            />
          </div>

          <div class="field">
            <span class="field-label">{{ t.customizeMcpUrl }}</span>
            <NInput v-model:value="url" size="small" :placeholder="t.customizeMcpUrlExample" />
          </div>

          <div class="field">
            <button type="button" class="collapse-toggle" @click="headersOpen = !headersOpen">
              <CodiconIcon :name="headersOpen ? 'chevronDown' : 'chevronRight'" :size="14" />
              <span>{{ t.customizeMcpHeaders }}</span>
            </button>
            <NInput
              v-if="headersOpen"
              v-model:value="headers"
              type="textarea"
              :autosize="{ minRows: 2, maxRows: 5 }"
              :placeholder="t.customizeMcpHeadersHint"
            />
          </div>
        </template>

        <template v-else>
          <div class="field">
            <span class="field-label">{{ t.customizeMcpCommand }}</span>
            <NInput
              v-model:value="command"
              size="small"
              :placeholder="t.customizeMcpCommandExample"
            />
          </div>
          <div class="field">
            <span class="field-label">{{ t.customizeMcpArgs }}</span>
            <NInput v-model:value="args" size="small" :placeholder="t.customizeMcpArgsExample" />
          </div>
          <div class="field">
            <span class="field-label">{{ t.customizeMcpEnv }}</span>
            <NInput
              v-model:value="env"
              type="textarea"
              :autosize="{ minRows: 2, maxRows: 4 }"
              :placeholder="t.customizeMcpEnvExample"
            />
          </div>
        </template>
      </template>

      <template v-else>
        <div class="field">
          <span class="field-label">JSON</span>
          <NInput
            v-model:value="json"
            type="textarea"
            :autosize="{ minRows: 8, maxRows: 14 }"
            placeholder='{"mcpServers": { "name": { "command": "npx", "args": ["-y", "pkg"] } }}'
          />
          <NText depth="3" class="field-hint">{{ t.customizeMcpJsonHint }}</NText>
        </div>
      </template>
    </div>

    <NText v-if="error" class="form-error">{{ error }}</NText>

    <template #footer>
      <NSpace justify="end">
        <NButton type="primary" :loading="saving" @click="submit">
          {{ t.customizeMcpSave }}
        </NButton>
        <NButton :disabled="saving" @click="emit('close')">{{ t.cancel }}</NButton>
      </NSpace>
    </template>
  </NModal>
</template>

<style scoped>
.mcp-add-modal :deep(.n-card-header) {
  align-items: flex-start;
}

.modal-title-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.modal-title {
  font-size: 15px;
  font-weight: 650;
  color: var(--fg-strong);
}

.modal-subtitle {
  font-size: 12px;
  color: var(--fg-muted);
}

.mcp-form-card {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-row {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
}

.name-field {
  flex: 0 1 280px;
  min-width: 0;
}

.scope-field {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.scope-select {
  width: 150px;
}

.field-label {
  font-size: 12px;
  color: var(--fg-muted);
}

.narrow-select,
.narrow-input {
  width: 220px;
}

.collapse-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--fg-muted);
  font-size: 12.5px;
  cursor: pointer;
}

.collapse-toggle:hover {
  color: var(--fg-strong);
}

.field-hint {
  font-size: 11.5px;
  line-height: 1.45;
}

.form-error {
  color: var(--error);
  font-size: 12px;
  margin-top: 10px;
}
</style>
