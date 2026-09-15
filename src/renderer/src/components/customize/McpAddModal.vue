<script setup lang="ts">
import { ref, watch } from "vue";
import { NButton, NInput, NModal, NRadio, NRadioGroup, NSpace, NText } from "naive-ui";
import { t } from "@renderer/i18n";

const props = defineProps<{
  show: boolean;
  projectRoot: string | null;
}>();

const emit = defineEmits<{
  close: [];
  added: [];
}>();

type Scope = "user" | "project";
type Method = "form" | "json";
type Transport = "command" | "url";

const scope = ref<Scope>("user");
const method = ref<Method>("form");
const transport = ref<Transport>("command");
const name = ref("");
const command = ref("");
const args = ref("");
const url = ref("");
const env = ref("");
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
    json.value = "";
    error.value = "";
    saving.value = false;
  },
);

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

function buildEntry(): Record<string, unknown> {
  if (transport.value === "url") return { url: url.value.trim() };
  const entry: Record<string, unknown> = { command: command.value.trim() };
  const list = args.value.trim() ? args.value.trim().split(/\s+/) : [];
  if (list.length) entry.args = list;
  const envMap = parseEnv(env.value);
  if (envMap) entry.env = envMap;
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
  if (transport.value === "url" && !url.value.trim()) {
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
    await window.api.customizations.addMcpServers(
      scope.value,
      servers,
      props.projectRoot ?? undefined,
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
    class="pi-settings-modal"
    style="width: min(520px, 92vw)"
    :title="t.customizeMcpAddTitle"
    :bordered="false"
    :mask-closable="false"
    @close="emit('close')"
    @update:show="(value: boolean) => !value && emit('close')"
  >
    <div class="mcp-add-form">
      <div class="field">
        <NText strong class="field-label">{{ t.customizeMcpAddScope }}</NText>
        <NRadioGroup v-model:value="scope" name="mcp-add-scope">
          <NSpace :size="16">
            <NRadio value="user">{{ t.customizeGroupUser }}</NRadio>
            <NRadio value="project" :disabled="!projectRoot">
              {{ t.customizeGroupProject }}
            </NRadio>
          </NSpace>
        </NRadioGroup>
      </div>

      <div class="field">
        <NText strong class="field-label">{{ t.customizeMcpAddMethod }}</NText>
        <NRadioGroup v-model:value="method" name="mcp-add-method">
          <NSpace :size="16">
            <NRadio value="form">{{ t.customizeMcpAddForm }}</NRadio>
            <NRadio value="json">{{ t.customizeMcpAddJson }}</NRadio>
          </NSpace>
        </NRadioGroup>
      </div>

      <template v-if="method === 'form'">
        <div class="field">
          <NText strong class="field-label">{{ t.customizeMcpName }}</NText>
          <NInput v-model:value="name" size="small" :placeholder="t.customizeMcpNameExample" />
        </div>

        <div class="field">
          <NText strong class="field-label">{{ t.customizeMcpTransport }}</NText>
          <NRadioGroup v-model:value="transport" name="mcp-add-transport">
            <NSpace :size="16">
              <NRadio value="command">{{ t.customizeMcpTransportCommand }}</NRadio>
              <NRadio value="url">{{ t.customizeMcpTransportUrl }}</NRadio>
            </NSpace>
          </NRadioGroup>
        </div>

        <template v-if="transport === 'command'">
          <div class="field">
            <NText strong class="field-label">{{ t.customizeMcpCommand }}</NText>
            <NInput
              v-model:value="command"
              size="small"
              :placeholder="t.customizeMcpCommandExample"
            />
          </div>
          <div class="field">
            <NText strong class="field-label">{{ t.customizeMcpArgs }}</NText>
            <NInput v-model:value="args" size="small" :placeholder="t.customizeMcpArgsExample" />
          </div>
          <div class="field">
            <NText strong class="field-label">{{ t.customizeMcpEnv }}</NText>
            <NInput
              v-model:value="env"
              type="textarea"
              :autosize="{ minRows: 2, maxRows: 4 }"
              :placeholder="t.customizeMcpEnvExample"
            />
          </div>
        </template>

        <div v-else class="field">
          <NText strong class="field-label">{{ t.customizeMcpUrl }}</NText>
          <NInput v-model:value="url" size="small" :placeholder="t.customizeMcpUrlExample" />
        </div>
      </template>

      <div v-else class="field">
        <NText strong class="field-label">{{ t.customizeMcpName }}</NText>
        <NInput v-model:value="name" size="small" :placeholder="t.customizeMcpJsonNameHint" />
        <NText depth="3" class="field-hint">{{ t.customizeMcpJsonHint }}</NText>
        <NInput
          v-model:value="json"
          type="textarea"
          :autosize="{ minRows: 5, maxRows: 10 }"
          placeholder='{"mcpServers": { "name": { "command": "npx", "args": ["-y", "pkg"] } }}'
        />
      </div>

      <NText v-if="error" class="form-error">{{ error }}</NText>
    </div>

    <template #footer>
      <NSpace justify="end">
        <NButton :disabled="saving" @click="emit('close')">{{ t.cancel }}</NButton>
        <NButton type="primary" :loading="saving" @click="submit">
          {{ t.customizeMcpAddConfirm }}
        </NButton>
      </NSpace>
    </template>
  </NModal>
</template>

<style scoped>
.mcp-add-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-label {
  font-size: 12px;
}

.field-hint {
  font-size: 11.5px;
  line-height: 1.45;
}

.form-error {
  color: var(--error);
  font-size: 12px;
}
</style>
