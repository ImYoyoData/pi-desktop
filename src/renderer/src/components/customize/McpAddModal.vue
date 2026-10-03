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
import type { McpEditTarget } from "../../../../shared/customizations";

const props = defineProps<{
  show: boolean;
  workspaces: string[];
  edit?: McpEditTarget | null;
}>();

const emit = defineEmits<{
  close: [];
  added: [];
}>();

type Method = "form" | "json";
type Transport = "command" | "url";
type Exposure = "codemode" | "deferred" | "direct" | "hidden";

const FORM_KEYS = [
  "type",
  "command",
  "args",
  "env",
  "cwd",
  "url",
  "headers",
  "oauth",
  "auth",
  "description",
  "exposure",
  "timeout",
] as const;

const OAUTH_KEYS = [
  "clientId",
  "clientSecret",
  "clientName",
  "scope",
  "callbackPort",
  "callbackUrl",
  "authServerMetadataUrl",
] as const;

const scope = ref<string>("user");
const method = ref<Method>("form");
const transport = ref<Transport>("command");
const name = ref("");
const description = ref("");
const exposure = ref<Exposure>("codemode");
const timeout = ref("");
const command = ref("");
const args = ref("");
const env = ref("");
const cwd = ref("");
const url = ref("");
const headers = ref("");
const headersOpen = ref(false);
const oauthOpen = ref(false);
const oauthClientId = ref("");
const oauthClientSecret = ref("");
const oauthClientName = ref("");
const oauthScope = ref("");
const oauthCallbackPort = ref("");
const oauthCallbackUrl = ref("");
const oauthAuthServerMetadataUrl = ref("");
const authProvider = ref("");
const json = ref("");
const error = ref("");
const saving = ref(false);
const loading = ref(false);
const originalEntry = ref<Record<string, unknown> | null>(null);

const editing = computed(() => Boolean(props.edit));
const projectScoped = computed(() =>
  props.edit ? props.edit.scope === "project" : scope.value !== "user",
);
const hasStoredAuth = computed(() => authProvider.value.trim().length > 0);

watch(
  () => props.show,
  (open) => {
    if (!open) return;
    resetForm();
    if (props.edit) void loadEntry(props.edit);
  },
);

function resetForm(): void {
  scope.value = "user";
  method.value = "form";
  transport.value = "command";
  name.value = "";
  description.value = "";
  exposure.value = "codemode";
  timeout.value = "";
  command.value = "";
  args.value = "";
  env.value = "";
  cwd.value = "";
  url.value = "";
  headers.value = "";
  headersOpen.value = false;
  oauthOpen.value = false;
  oauthClientId.value = "";
  oauthClientSecret.value = "";
  oauthClientName.value = "";
  oauthScope.value = "";
  oauthCallbackPort.value = "";
  oauthCallbackUrl.value = "";
  oauthAuthServerMetadataUrl.value = "";
  authProvider.value = "";
  json.value = "";
  error.value = "";
  saving.value = false;
  loading.value = false;
  originalEntry.value = null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isExposure(value: unknown): value is Exposure {
  return value === "codemode" || value === "deferred" || value === "direct" || value === "hidden";
}

function formatKeyValues(value: unknown, separator: string): string {
  if (!isRecord(value)) return "";
  return Object.entries(value)
    .map(([key, item]) => `${key}${separator}${typeof item === "string" ? item : ""}`)
    .join("\n");
}

/** 编辑已有服务器：读取配置回填表单，未在表单暴露的字段保留在 originalEntry 中。 */
async function loadEntry(target: McpEditTarget): Promise<void> {
  loading.value = true;
  try {
    const entry = await window.api.customizations.readMcpServer(
      target.name,
      target.scope,
      target.workspace ?? undefined,
    );
    if (!entry) {
      error.value = t.customizeMcpLoadFailed;
      return;
    }
    originalEntry.value = entry;
    name.value = target.name;
    json.value = JSON.stringify(entry, null, 2);
    description.value = stringOf(entry.description);
    if (isExposure(entry.exposure)) exposure.value = entry.exposure;
    if (typeof entry.timeout === "number") timeout.value = String(entry.timeout);
    if (typeof entry.url === "string") {
      transport.value = "url";
      url.value = entry.url;
      headers.value = formatKeyValues(entry.headers, ": ");
      headersOpen.value = Boolean(headers.value);
      const oauth = entry.oauth;
      if (isRecord(oauth)) {
        oauthOpen.value = true;
        oauthClientId.value = stringOf(oauth.clientId);
        oauthClientSecret.value = stringOf(oauth.clientSecret);
        oauthClientName.value = stringOf(oauth.clientName);
        oauthScope.value = stringOf(oauth.scope);
        oauthCallbackPort.value =
          typeof oauth.callbackPort === "number" ? String(oauth.callbackPort) : "";
        oauthCallbackUrl.value = stringOf(oauth.callbackUrl);
        oauthAuthServerMetadataUrl.value = stringOf(oauth.authServerMetadataUrl);
      }
      const auth = entry.auth;
      authProvider.value = isRecord(auth) ? stringOf(auth.provider) : "";
    } else {
      transport.value = "command";
      command.value = stringOf(entry.command);
      args.value = Array.isArray(entry.args)
        ? entry.args.filter((item): item is string => typeof item === "string").join(" ")
        : "";
      env.value = formatKeyValues(entry.env, "=");
      cwd.value = stringOf(entry.cwd);
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

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
]);

const exposureOptions = computed(() => [
  { label: t.customizeMcpExposureCodemode, value: "codemode" },
  { label: t.customizeMcpExposureDeferred, value: "deferred" },
  { label: t.customizeMcpExposureDirect, value: "direct" },
  { label: t.customizeMcpExposureHidden, value: "hidden" },
]);

function parseKeyValues(
  text: string,
  separator: string,
  message: string,
  trimValue: boolean,
): Record<string, string> | undefined {
  const entries = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const index = line.indexOf(separator);
      if (index <= 0) throw new Error(message);
      const key = line.slice(0, index).trim();
      const raw = line.slice(index + separator.length);
      return [key, trimValue ? raw.trim() : raw] as const;
    });
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function parseEnv(text: string): Record<string, string> | undefined {
  return parseKeyValues(text, "=", t.customizeMcpEnvInvalid, false);
}

function parseHeaders(text: string): Record<string, string> | undefined {
  return parseKeyValues(text, ":", t.customizeMcpHeadersInvalid, true);
}

/** OAuth 子字段与表单合并；原配置里未暴露的子字段保留。 */
function buildOauth(): Record<string, unknown> | undefined {
  const base = originalEntry.value?.oauth;
  const oauth: Record<string, unknown> = isRecord(base) ? { ...base } : {};
  for (const key of OAUTH_KEYS) delete oauth[key];
  const clientId = oauthClientId.value.trim();
  if (clientId) oauth.clientId = clientId;
  const clientSecret = oauthClientSecret.value.trim();
  if (clientSecret) oauth.clientSecret = clientSecret;
  const clientName = oauthClientName.value.trim();
  if (clientName) oauth.clientName = clientName;
  const scopeText = oauthScope.value.trim();
  if (scopeText) oauth.scope = scopeText;
  const portText = oauthCallbackPort.value.trim();
  if (portText) {
    const port = Number(portText);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(t.customizeMcpOauthPortInvalid);
    }
    oauth.callbackPort = port;
  }
  const callbackUrl = oauthCallbackUrl.value.trim();
  if (callbackUrl) oauth.callbackUrl = callbackUrl;
  const metadataUrl = oauthAuthServerMetadataUrl.value.trim();
  if (metadataUrl) oauth.authServerMetadataUrl = metadataUrl;
  return Object.keys(oauth).length ? oauth : undefined;
}

function buildEntry(): Record<string, unknown> {
  const entry: Record<string, unknown> = originalEntry.value ? { ...originalEntry.value } : {};
  for (const key of FORM_KEYS) delete entry[key];
  const descriptionText = description.value.trim();
  if (descriptionText) entry.description = descriptionText;
  if (exposure.value !== "codemode") entry.exposure = exposure.value;
  const timeoutText = timeout.value.trim();
  if (timeoutText) {
    const seconds = Number(timeoutText);
    if (!Number.isFinite(seconds) || seconds <= 0) throw new Error(t.customizeMcpTimeoutInvalid);
    entry.timeout = seconds;
  }
  if (transport.value === "command") {
    entry.command = command.value.trim();
    const list = args.value.trim() ? args.value.trim().split(/\s+/) : [];
    if (list.length) entry.args = list;
    const envMap = parseEnv(env.value);
    if (envMap) entry.env = envMap;
    const cwdText = cwd.value.trim();
    if (cwdText) entry.cwd = cwdText;
    return entry;
  }
  entry.url = url.value.trim();
  const headerMap = parseHeaders(headers.value);
  if (headerMap) entry.headers = headerMap;
  const oauth = buildOauth();
  if (oauth) entry.oauth = oauth;
  const provider = authProvider.value.trim();
  if (provider) entry.auth = { provider };
  else if (isRecord(originalEntry.value?.auth)) entry.auth = originalEntry.value.auth;
  return entry;
}

function looksLikeEntry(value: Record<string, unknown>): boolean {
  return value.command !== undefined || value.url !== undefined || value.socket !== undefined;
}

/** 归一化外部格式：VS Code/Cursor 的 type、opencode 的数组 command 与 environment；pi 0.99.2 不认 SSE 与 httpTransport。 */
function normalizeEntry(entry: Record<string, unknown>): Record<string, unknown> {
  const next = { ...entry };
  delete next.type;
  delete next.httpTransport;
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
  if (transport.value === "url" && !url.value.trim()) {
    throw new Error(t.customizeMcpTargetRequired);
  }
  return { [serverName]: buildEntry() };
}

function saveTarget(): { scope: "user" | "project"; cwd?: string } {
  if (props.edit) {
    return props.edit.scope === "project"
      ? { scope: "project", cwd: props.edit.workspace ?? undefined }
      : { scope: "user" };
  }
  return scope.value === "user" ? { scope: "user" } : { scope: "project", cwd: scope.value };
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
  const target = saveTarget();
  if (target.scope === "project" && !target.cwd) {
    error.value = t.slashNeedWorkspace;
    return;
  }
  saving.value = true;
  try {
    await window.api.customizations.addMcpServers(target.scope, servers, target.cwd);
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
    style="width: min(640px, 94vw)"
    :bordered="false"
    :mask-closable="false"
    @close="emit('close')"
    @update:show="(value: boolean) => !value && emit('close')"
  >
    <template #header>
      <div class="modal-title-block">
        <div class="modal-title">{{ editing ? t.customizeMcpEditTitle : t.customizeMcpAddTitle }}</div>
        <div class="modal-subtitle">
          {{ editing ? t.customizeMcpEditSubtitle : t.customizeMcpAddSubtitle }}
        </div>
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
            :disabled="editing"
            :placeholder="method === 'form' ? t.customizeMcpNameExample : t.customizeMcpJsonNameHint"
          />
        </div>
        <div class="scope-field">
          <span class="field-label">{{ t.customizeMcpAddScope }}</span>
          <NSelect
            v-model:value="scope"
            size="small"
            class="scope-select"
            :disabled="editing"
            :options="scopeOptions"
          />
        </div>
      </div>

      <template v-if="method === 'form'">
        <div class="field">
          <span class="field-label">{{ t.customizeMcpDescription }}</span>
          <NInput
            v-model:value="description"
            size="small"
            :placeholder="t.customizeMcpDescriptionPlaceholder"
          />
        </div>

        <div class="field-row">
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
            <span class="field-label">{{ t.customizeMcpExposure }}</span>
            <NSelect
              v-model:value="exposure"
              size="small"
              class="narrow-select"
              :options="exposureOptions"
            />
          </div>
          <div class="field">
            <span class="field-label">{{ t.customizeMcpTimeout }}</span>
            <NInput v-model:value="timeout" size="small" class="narrow-input" placeholder="60" />
          </div>
        </div>

        <template v-if="transport === 'url'">
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

          <div class="field">
            <button type="button" class="collapse-toggle" @click="oauthOpen = !oauthOpen">
              <CodiconIcon :name="oauthOpen ? 'chevronDown' : 'chevronRight'" :size="14" />
              <span>{{ t.customizeMcpOauth }}</span>
            </button>
            <div v-if="oauthOpen" class="sub-fields">
              <div class="field">
                <span class="field-label">{{ t.customizeMcpOauthClientId }}</span>
                <NInput
                  v-model:value="oauthClientId"
                  size="small"
                  :placeholder="t.customizeMcpOauthAuto"
                />
              </div>
              <div class="field">
                <span class="field-label">{{ t.customizeMcpOauthClientSecret }}</span>
                <NInput v-model:value="oauthClientSecret" size="small" type="password" />
              </div>
              <div class="field">
                <span class="field-label">{{ t.customizeMcpOauthClientName }}</span>
                <NInput
                  v-model:value="oauthClientName"
                  size="small"
                  :placeholder="t.customizeMcpOauthAuto"
                />
              </div>
              <div class="field">
                <span class="field-label">{{ t.customizeMcpOauthScope }}</span>
                <NInput
                  v-model:value="oauthScope"
                  size="small"
                  :placeholder="t.customizeMcpOauthAuto"
                />
              </div>
              <div class="field">
                <span class="field-label">{{ t.customizeMcpOauthCallbackPort }}</span>
                <NInput v-model:value="oauthCallbackPort" size="small" class="narrow-input" />
              </div>
              <div class="field">
                <span class="field-label">{{ t.customizeMcpOauthCallbackUrl }}</span>
                <NInput
                  v-model:value="oauthCallbackUrl"
                  size="small"
                  placeholder="http://localhost:8080/oauth/callback"
                />
              </div>
              <div class="field">
                <span class="field-label">{{ t.customizeMcpOauthAuthServerMetadataUrl }}</span>
                <NInput
                  v-model:value="oauthAuthServerMetadataUrl"
                  size="small"
                  placeholder="https://auth.example.com/.well-known/oauth-authorization-server"
                />
              </div>
            </div>
          </div>

          <div v-if="!projectScoped || hasStoredAuth" class="field">
            <span class="field-label">{{ t.customizeMcpAuthProvider }}</span>
            <NInput
              v-model:value="authProvider"
              size="small"
              :placeholder="t.customizeMcpAuthProviderPlaceholder"
            />
            <NText depth="3" class="field-hint">
              {{
                projectScoped
                  ? t.customizeMcpAuthProviderProjectUnsupported
                  : t.customizeMcpAuthProviderHint
              }}
            </NText>
          </div>
        </template>

        <template v-else>
          <div class="field">
            <span class="field-label">{{ t.customizeMcpCommand }}</span>
            <NInput v-model:value="command" size="small" :placeholder="t.customizeMcpCommandExample" />
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
          <div class="field">
            <span class="field-label">{{ t.customizeMcpCwd }}</span>
            <NInput v-model:value="cwd" size="small" :placeholder="t.customizeMcpCwdPlaceholder" />
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
        <NButton
          type="primary"
          :loading="saving || loading"
          :disabled="loading"
          @click="submit"
        >
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

.sub-fields {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
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
