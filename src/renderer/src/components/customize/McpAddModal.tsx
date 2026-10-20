import { useEffect, useState, type ReactNode } from "react";
import { Button, Input, Modal, Radio, Select, Space, Typography } from "antd";
import CodiconIcon from "@renderer/components/icons/CodiconIcon";
import { useI18n } from "@renderer/i18n/use-i18n";
import type { McpEditTarget } from "../../../../shared/customizations";
import styles from "./McpAddModal.module.css";

type Props = {
  show: boolean;
  workspaces: string[];
  edit?: McpEditTarget | null;
  onClose?: () => void;
  onAdded?: () => void;
};

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
  "toolExposure",
  "timeout",
] as const;

const OAUTH_KEYS = [
  "clientId",
  "clientSecret",
  "clientName",
  "clientRegistration",
  "scope",
  "callbackPort",
  "callbackUrl",
  "authServerMetadataUrl",
] as const;

type FormState = {
  scope: string;
  method: Method;
  transport: Transport;
  name: string;
  description: string;
  exposure: Exposure;
  toolExposure: string;
  timeout: string;
  command: string;
  args: string;
  env: string;
  cwd: string;
  url: string;
  headers: string;
  headersOpen: boolean;
  oauthOpen: boolean;
  oauthClientId: string;
  oauthClientSecret: string;
  oauthClientName: string;
  oauthClientRegistration: "dcr" | "cimd";
  oauthScope: string;
  oauthCallbackPort: string;
  oauthCallbackUrl: string;
  oauthAuthServerMetadataUrl: string;
  authProvider: string;
  json: string;
};

const EMPTY_FORM: FormState = {
  scope: "user",
  method: "form",
  transport: "command",
  name: "",
  description: "",
  exposure: "codemode",
  toolExposure: "",
  timeout: "",
  command: "",
  args: "",
  env: "",
  cwd: "",
  url: "",
  headers: "",
  headersOpen: false,
  oauthOpen: false,
  oauthClientId: "",
  oauthClientSecret: "",
  oauthClientName: "",
  oauthClientRegistration: "dcr",
  oauthScope: "",
  oauthCallbackPort: "",
  oauthCallbackUrl: "",
  oauthAuthServerMetadataUrl: "",
  authProvider: "",
  json: "",
};

export function McpAddModal({ show, workspaces, edit, onClose, onAdded }: Props): ReactNode {
  const t = useI18n();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [originalEntry, setOriginalEntry] = useState<Record<string, unknown> | null>(null);

  const editing = Boolean(edit);
  const projectScoped = edit ? edit.scope === "project" : form.scope !== "user";
  const hasStoredAuth = form.authProvider.trim().length > 0;

  function update(patch: Partial<FormState>): void {
    setForm((prev) => ({ ...prev, ...patch }));
  }

  useEffect(() => {
    if (!show) return;
    resetForm();
    if (edit) void loadEntry(edit);
  }, [show]);

  function resetForm(): void {
    setForm(EMPTY_FORM);
    setError("");
    setSaving(false);
    setLoading(false);
    setOriginalEntry(null);
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
    setLoading(true);
    try {
      const entry = await window.api.customizations.readMcpServer(
        target.name,
        target.scope,
        target.workspace ?? undefined,
      );
      if (!entry) {
        setError(t.customizeMcpLoadFailed);
        return;
      }
      setOriginalEntry(entry);
      const patch: Partial<FormState> = {
        name: target.name,
        json: JSON.stringify(entry, null, 2),
        description: stringOf(entry.description),
        toolExposure: formatKeyValues(entry.toolExposure, ": "),
      };
      if (isExposure(entry.exposure)) patch.exposure = entry.exposure;
      if (typeof entry.timeout === "number") patch.timeout = String(entry.timeout);
      if (typeof entry.url === "string") {
        const headersText = formatKeyValues(entry.headers, ": ");
        patch.transport = "url";
        patch.url = entry.url;
        patch.headers = headersText;
        patch.headersOpen = Boolean(headersText);
        const oauth = entry.oauth;
        if (isRecord(oauth)) {
          patch.oauthOpen = true;
          patch.oauthClientId = stringOf(oauth.clientId);
          patch.oauthClientSecret = stringOf(oauth.clientSecret);
          patch.oauthClientName = stringOf(oauth.clientName);
          patch.oauthClientRegistration = stringOf(oauth.clientRegistration) === "cimd" ? "cimd" : "dcr";
          patch.oauthScope = stringOf(oauth.scope);
          patch.oauthCallbackPort =
            typeof oauth.callbackPort === "number" ? String(oauth.callbackPort) : "";
          patch.oauthCallbackUrl = stringOf(oauth.callbackUrl);
          patch.oauthAuthServerMetadataUrl = stringOf(oauth.authServerMetadataUrl);
        }
        const auth = entry.auth;
        patch.authProvider = isRecord(auth) ? stringOf(auth.provider) : "";
      } else {
        patch.transport = "command";
        patch.command = stringOf(entry.command);
        patch.args = Array.isArray(entry.args)
          ? entry.args.filter((item): item is string => typeof item === "string").join(" ")
          : "";
        patch.env = formatKeyValues(entry.env, "=");
        patch.cwd = stringOf(entry.cwd);
      }
      update(patch);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  function baseName(target: string): string {
    return target.split(/[\\/]/).filter(Boolean).pop() ?? target;
  }

  /** 工作区重名时显示完整路径以便区分。 */
  function workspaceLabel(target: string): string {
    const base = baseName(target);
    const duplicated = workspaces.filter((p) => baseName(p) === base).length > 1;
    return duplicated ? target : base;
  }

  const scopeOptions = [
    { label: t.customizeGroupUser, value: "user" },
    ...workspaces.map((target) => ({ label: workspaceLabel(target), value: target })),
  ];

  const transportOptions = [
    { label: t.customizeMcpTransportCommand, value: "command" },
    { label: t.customizeMcpTransportUrl, value: "url" },
  ];

  const exposureOptions = [
    { label: t.customizeMcpExposureCodemode, value: "codemode" },
    { label: t.customizeMcpExposureDeferred, value: "deferred" },
    { label: t.customizeMcpExposureDirect, value: "direct" },
    { label: t.customizeMcpExposureHidden, value: "hidden" },
  ];

  const clientRegistrationOptions = [
    { label: t.customizeMcpOauthClientRegistrationDcr, value: "dcr" },
    { label: t.customizeMcpOauthClientRegistrationCimd, value: "cimd" },
  ];

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
    const base = originalEntry?.oauth;
    const oauth: Record<string, unknown> = isRecord(base) ? { ...base } : {};
    for (const key of OAUTH_KEYS) delete oauth[key];
    const clientId = form.oauthClientId.trim();
    if (clientId) oauth.clientId = clientId;
    const clientSecret = form.oauthClientSecret.trim();
    if (clientSecret) oauth.clientSecret = clientSecret;
    const clientName = form.oauthClientName.trim();
    if (clientName) oauth.clientName = clientName;
    if (form.oauthClientRegistration === "cimd") oauth.clientRegistration = "cimd";
    const scopeText = form.oauthScope.trim();
    if (scopeText) oauth.scope = scopeText;
    const portText = form.oauthCallbackPort.trim();
    if (portText) {
      const port = Number(portText);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(t.customizeMcpOauthPortInvalid);
      }
      oauth.callbackPort = port;
    }
    const callbackUrl = form.oauthCallbackUrl.trim();
    if (callbackUrl) oauth.callbackUrl = callbackUrl;
    const metadataUrl = form.oauthAuthServerMetadataUrl.trim();
    if (metadataUrl) oauth.authServerMetadataUrl = metadataUrl;
    return Object.keys(oauth).length ? oauth : undefined;
  }

  function parseToolExposure(text: string): Record<string, string> | undefined {
    const map = parseKeyValues(text, ":", t.customizeMcpToolExposureInvalid, true);
    if (!map) return undefined;
    for (const value of Object.values(map)) {
      if (!isExposure(value) && value !== "codemode-deferred") {
        throw new Error(t.customizeMcpToolExposureInvalid);
      }
    }
    return map;
  }

  function buildEntry(): Record<string, unknown> {
    const entry: Record<string, unknown> = originalEntry ? { ...originalEntry } : {};
    for (const key of FORM_KEYS) delete entry[key];
    const descriptionText = form.description.trim();
    if (descriptionText) entry.description = descriptionText;
    if (form.exposure !== "codemode") entry.exposure = form.exposure;
    const toolExposureMap = parseToolExposure(form.toolExposure);
    if (toolExposureMap) entry.toolExposure = toolExposureMap;
    const timeoutText = form.timeout.trim();
    if (timeoutText) {
      const seconds = Number(timeoutText);
      if (!Number.isFinite(seconds) || seconds <= 0) throw new Error(t.customizeMcpTimeoutInvalid);
      entry.timeout = seconds;
    }
    if (form.transport === "command") {
      entry.command = form.command.trim();
      const list = form.args.trim() ? form.args.trim().split(/\s+/) : [];
      if (list.length) entry.args = list;
      const envMap = parseEnv(form.env);
      if (envMap) entry.env = envMap;
      const cwdText = form.cwd.trim();
      if (cwdText) entry.cwd = cwdText;
      return entry;
    }
    entry.url = form.url.trim();
    const headerMap = parseHeaders(form.headers);
    if (headerMap) entry.headers = headerMap;
    const oauth = buildOauth();
    if (oauth) entry.oauth = oauth;
    const provider = form.authProvider.trim();
    if (provider) entry.auth = { provider };
    else if (isRecord(originalEntry?.auth)) entry.auth = originalEntry.auth;
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
    if (form.method === "json") return parseJsonServers(form.json, form.name);
    const serverName = form.name.trim();
    if (!serverName) throw new Error(t.customizeMcpNameRequired);
    if (form.transport === "command" && !form.command.trim()) {
      throw new Error(t.customizeMcpTargetRequired);
    }
    if (form.transport === "url" && !form.url.trim()) {
      throw new Error(t.customizeMcpTargetRequired);
    }
    return { [serverName]: buildEntry() };
  }

  function saveTarget(): { scope: "user" | "project"; cwd?: string } {
    if (edit) {
      return edit.scope === "project"
        ? { scope: "project", cwd: edit.workspace ?? undefined }
        : { scope: "user" };
    }
    return form.scope === "user" ? { scope: "user" } : { scope: "project", cwd: form.scope };
  }

  async function submit(): Promise<void> {
    setError("");
    let servers: Record<string, unknown>;
    try {
      servers = buildServers();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return;
    }
    const target = saveTarget();
    if (target.scope === "project" && !target.cwd) {
      setError(t.slashNeedWorkspace);
      return;
    }
    setSaving(true);
    try {
      await window.api.customizations.addMcpServers(target.scope, servers, target.cwd);
      onAdded?.();
      onClose?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={show}
      className={`pi-settings-modal ${styles.mcpAddModal}`}
      width="min(640px, 94vw)"
      mask={{ closable: false }}
      onCancel={() => onClose?.()}
      title={
        <div className={styles.modalHeader}>
          <div className={styles.modalTitleBlock}>
            <div className={styles.modalTitle}>
              {editing ? t.customizeMcpEditTitle : t.customizeMcpAddTitle}
            </div>
            <div className={styles.modalSubtitle}>
              {editing ? t.customizeMcpEditSubtitle : t.customizeMcpAddSubtitle}
            </div>
          </div>
          <Radio.Group
            className={styles.methodGroup}
            size="small"
            value={form.method}
            onChange={(event) => update({ method: event.target.value as Method })}
          >
            <Radio.Button value="form">{t.customizeMcpAddForm}</Radio.Button>
            <Radio.Button value="json">{t.customizeMcpAddJson}</Radio.Button>
          </Radio.Group>
        </div>
      }
      footer={
        <Space style={{ justifyContent: "flex-end" }}>
          <Button
            type="primary"
            loading={saving || loading}
            disabled={loading}
            onClick={() => void submit()}
          >
            {t.customizeMcpSave}
          </Button>
          <Button disabled={saving} onClick={() => onClose?.()}>
            {t.cancel}
          </Button>
        </Space>
      }
    >
      <div className={`section ${styles.mcpFormCard}`}>
        <div className={styles.fieldRow}>
          <div className={`${styles.field} ${styles.nameField}`}>
            <span className={styles.fieldLabel}>{t.customizeMcpName}</span>
            <Input
              value={form.name}
              size="small"
              disabled={editing}
              placeholder={form.method === "form" ? t.customizeMcpNameExample : t.customizeMcpJsonNameHint}
              onChange={(event) => update({ name: event.target.value })}
            />
          </div>
          <div className={styles.scopeField}>
            <span className={styles.fieldLabel}>{t.customizeMcpAddScope}</span>
            <Select
              value={form.scope}
              size="small"
              className={styles.scopeSelect}
              disabled={editing}
              options={scopeOptions}
              onChange={(value: string) => update({ scope: value })}
            />
          </div>
        </div>

        {form.method === "form" ? (
          <>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>{t.customizeMcpDescription}</span>
              <Input
                value={form.description}
                size="small"
                placeholder={t.customizeMcpDescriptionPlaceholder}
                onChange={(event) => update({ description: event.target.value })}
              />
            </div>

            <div className={styles.fieldRow}>
              <div className={styles.field}>
                <span className={styles.fieldLabel}>{t.customizeMcpTransport}</span>
                <Select
                  value={form.transport}
                  size="small"
                  className={styles.narrowSelect}
                  options={transportOptions}
                  onChange={(value: Transport) => update({ transport: value })}
                />
              </div>
              <div className={styles.field}>
                <span className={styles.fieldLabel}>{t.customizeMcpExposure}</span>
                <Select
                  value={form.exposure}
                  size="small"
                  className={styles.narrowSelect}
                  options={exposureOptions}
                  onChange={(value: Exposure) => update({ exposure: value })}
                />
              </div>
              <div className={styles.field}>
                <span className={styles.fieldLabel}>{t.customizeMcpToolExposure}</span>
                <Input.TextArea
                  value={form.toolExposure}
                  size="small"
                  autoSize={{ minRows: 2, maxRows: 6 }}
                  placeholder={t.customizeMcpToolExposureHint}
                  onChange={(event) => update({ toolExposure: event.target.value })}
                />
              </div>
              <div className={styles.field}>
                <span className={styles.fieldLabel}>{t.customizeMcpTimeout}</span>
                <Input
                  value={form.timeout}
                  size="small"
                  className={styles.narrowInput}
                  placeholder="60"
                  onChange={(event) => update({ timeout: event.target.value })}
                />
              </div>
            </div>

            {form.transport === "url" ? (
              <>
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>{t.customizeMcpUrl}</span>
                  <Input
                    value={form.url}
                    size="small"
                    placeholder={t.customizeMcpUrlExample}
                    onChange={(event) => update({ url: event.target.value })}
                  />
                </div>

                <div className={styles.field}>
                  <button
                    type="button"
                    className={styles.collapseToggle}
                    onClick={() => update({ headersOpen: !form.headersOpen })}
                  >
                    <CodiconIcon name={form.headersOpen ? "chevronDown" : "chevronRight"} size={14} />
                    <span>{t.customizeMcpHeaders}</span>
                  </button>
                  {form.headersOpen ? (
                    <Input.TextArea
                      value={form.headers}
                      autoSize={{ minRows: 2, maxRows: 5 }}
                      placeholder={t.customizeMcpHeadersHint}
                      onChange={(event) => update({ headers: event.target.value })}
                    />
                  ) : null}
                </div>

                <div className={styles.field}>
                  <button
                    type="button"
                    className={styles.collapseToggle}
                    onClick={() => update({ oauthOpen: !form.oauthOpen })}
                  >
                    <CodiconIcon name={form.oauthOpen ? "chevronDown" : "chevronRight"} size={14} />
                    <span>{t.customizeMcpOauth}</span>
                  </button>
                  {form.oauthOpen ? (
                    <div className={styles.subFields}>
                      <div className={styles.field}>
                        <span className={styles.fieldLabel}>{t.customizeMcpOauthClientId}</span>
                        <Input
                          value={form.oauthClientId}
                          size="small"
                          placeholder={t.customizeMcpOauthAuto}
                          onChange={(event) => update({ oauthClientId: event.target.value })}
                        />
                      </div>
                      <div className={styles.field}>
                        <span className={styles.fieldLabel}>
                          {t.customizeMcpOauthClientSecret}
                        </span>
                        <Input.Password
                          value={form.oauthClientSecret}
                          size="small"
                          onChange={(event) => update({ oauthClientSecret: event.target.value })}
                        />
                      </div>
                      <div className={styles.field}>
                        <span className={styles.fieldLabel}>{t.customizeMcpOauthClientName}</span>
                        <Input
                          value={form.oauthClientName}
                          size="small"
                          placeholder={t.customizeMcpOauthAuto}
                          onChange={(event) => update({ oauthClientName: event.target.value })}
                        />
                      </div>
                      <div className={styles.field}>
                        <span className={styles.fieldLabel}>
                          {t.customizeMcpOauthClientRegistration}
                        </span>
                        <Select
                          value={form.oauthClientRegistration}
                          size="small"
                          className={styles.narrowSelect}
                          options={clientRegistrationOptions}
                          onChange={(value: "dcr" | "cimd") =>
                            update({ oauthClientRegistration: value })
                          }
                        />
                      </div>
                      <div className={styles.field}>
                        <span className={styles.fieldLabel}>{t.customizeMcpOauthScope}</span>
                        <Input
                          value={form.oauthScope}
                          size="small"
                          placeholder={t.customizeMcpOauthAuto}
                          onChange={(event) => update({ oauthScope: event.target.value })}
                        />
                      </div>
                      <div className={styles.field}>
                        <span className={styles.fieldLabel}>{t.customizeMcpOauthCallbackPort}</span>
                        <Input
                          value={form.oauthCallbackPort}
                          size="small"
                          className={styles.narrowInput}
                          onChange={(event) => update({ oauthCallbackPort: event.target.value })}
                        />
                      </div>
                      <div className={styles.field}>
                        <span className={styles.fieldLabel}>{t.customizeMcpOauthCallbackUrl}</span>
                        <Input
                          value={form.oauthCallbackUrl}
                          size="small"
                          placeholder="http://localhost:8080/oauth/callback"
                          onChange={(event) => update({ oauthCallbackUrl: event.target.value })}
                        />
                      </div>
                      <div className={styles.field}>
                        <span className={styles.fieldLabel}>
                          {t.customizeMcpOauthAuthServerMetadataUrl}
                        </span>
                        <Input
                          value={form.oauthAuthServerMetadataUrl}
                          size="small"
                          placeholder="https://auth.example.com/.well-known/oauth-authorization-server"
                          onChange={(event) =>
                            update({ oauthAuthServerMetadataUrl: event.target.value })
                          }
                        />
                      </div>
                    </div>
                  ) : null}
                </div>

                {!projectScoped || hasStoredAuth ? (
                  <div className={styles.field}>
                    <span className={styles.fieldLabel}>{t.customizeMcpAuthProvider}</span>
                    <Input
                      value={form.authProvider}
                      size="small"
                      placeholder={t.customizeMcpAuthProviderPlaceholder}
                      onChange={(event) => update({ authProvider: event.target.value })}
                    />
                    <Typography.Text type="secondary" className={styles.fieldHint}>
                      {projectScoped
                        ? t.customizeMcpAuthProviderProjectUnsupported
                        : t.customizeMcpAuthProviderHint}
                    </Typography.Text>
                  </div>
                ) : null}
              </>
            ) : (
              <>
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>{t.customizeMcpCommand}</span>
                  <Input
                    value={form.command}
                    size="small"
                    placeholder={t.customizeMcpCommandExample}
                    onChange={(event) => update({ command: event.target.value })}
                  />
                </div>
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>{t.customizeMcpArgs}</span>
                  <Input
                    value={form.args}
                    size="small"
                    placeholder={t.customizeMcpArgsExample}
                    onChange={(event) => update({ args: event.target.value })}
                  />
                </div>
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>{t.customizeMcpEnv}</span>
                  <Input.TextArea
                    value={form.env}
                    size="small"
                    autoSize={{ minRows: 2, maxRows: 4 }}
                    placeholder={t.customizeMcpEnvExample}
                    onChange={(event) => update({ env: event.target.value })}
                  />
                </div>
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>{t.customizeMcpCwd}</span>
                  <Input
                    value={form.cwd}
                    size="small"
                    placeholder={t.customizeMcpCwdPlaceholder}
                    onChange={(event) => update({ cwd: event.target.value })}
                  />
                </div>
              </>
            )}
          </>
        ) : (
          <div className={styles.field}>
            <span className={styles.fieldLabel}>JSON</span>
            <Input.TextArea
              value={form.json}
              autoSize={{ minRows: 8, maxRows: 14 }}
              placeholder={'{"mcpServers": { "name": { "command": "npx", "args": ["-y", "pkg"] } }}'}
              onChange={(event) => update({ json: event.target.value })}
            />
            <Typography.Text type="secondary" className={styles.fieldHint}>
              {t.customizeMcpJsonHint}
            </Typography.Text>
          </div>
        )}
      </div>

      {error ? <div className={styles.formError}>{error}</div> : null}
    </Modal>
  );
}

export default McpAddModal;
