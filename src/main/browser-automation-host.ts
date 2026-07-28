import { webContents, BrowserWindow } from "electron";
import { IpcChannels } from "../shared/protocol";
import type {
  BrowserElementInfo,
  BrowserLocator,
  BrowserRpcMethod,
  BrowserRpcRequest,
} from "../shared/browser-automation";
import type { BrowserTabRegistry } from "./browser-tab-registry";

function getGuest(webContentsId: number) {
  try {
    return webContents.fromId(webContentsId);
  } catch {
    return null;
  }
}

function assertHttpUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) throw new Error("url is required");
  let parsed: URL;
  try {
    parsed = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
  } catch {
    throw new Error(`invalid url: ${url}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`only http(s) URLs are allowed: ${parsed.protocol}`);
  }
  return parsed.toString();
}

async function runJs<T>(wc: Electron.WebContents, script: string): Promise<T> {
  return (await wc.executeJavaScript(script, true)) as T;
}

function asLocator(params: Record<string, unknown>): BrowserLocator {
  const nested =
    params.locator && typeof params.locator === "object"
      ? (params.locator as Record<string, unknown>)
      : null;
  const src = nested ?? params;
  const pick = (key: string): string | undefined => {
    const v = src[key];
    return typeof v === "string" && v.trim() ? v.trim() : undefined;
  };
  const nthRaw = src.nth ?? params.nth;
  const nth =
    typeof nthRaw === "number" && Number.isFinite(nthRaw)
      ? Math.max(0, Math.floor(nthRaw))
      : undefined;
  return {
    css: pick("css") ?? pick("selector"),
    selector: pick("selector"),
    id: pick("id"),
    testId: pick("testId") ?? pick("testid"),
    text: pick("text"),
    exact: src.exact === true || params.exact === true,
    role: pick("role"),
    name: pick("name"),
    placeholder: pick("placeholder"),
    label: pick("label"),
    title: pick("title"),
    xpath: pick("xpath"),
    nth,
  };
}

function hasLocator(loc: BrowserLocator): boolean {
  return Boolean(
    loc.css ||
      loc.selector ||
      loc.id ||
      loc.testId ||
      loc.text ||
      loc.role ||
      loc.name ||
      loc.placeholder ||
      loc.label ||
      loc.title ||
      loc.xpath,
  );
}

/** Injected into the guest page — keep self-contained (no outer closures). */
const PAGE_HELPERS = `(() => {
  function cssEscape(value) {
    if (window.CSS && CSS.escape) return CSS.escape(String(value));
    return String(value).replace(/[^a-zA-Z0-9_-]/g, (ch) => '\\\\' + ch);
  }
  function visibleText(el) {
    if (!el) return '';
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
      return String(el.value || el.getAttribute('aria-label') || el.placeholder || '').trim();
    }
    return String(el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
  }
  function accessibleName(el) {
    const aria = el.getAttribute('aria-label');
    if (aria && aria.trim()) return aria.trim();
    if (el.id) {
      const lab = document.querySelector('label[for=\"' + cssEscape(el.id) + '\"]');
      if (lab) return visibleText(lab);
    }
    const wrapped = el.closest('label');
    if (wrapped) return visibleText(wrapped);
    return (el.getAttribute('name') || el.getAttribute('title') || el.getAttribute('placeholder') || '').trim();
  }
  function describe(el, index) {
    const rect = el.getBoundingClientRect();
    const tag = el.tagName.toLowerCase();
    let selector = tag;
    if (el.id) selector += '#' + cssEscape(el.id);
    else if (el.getAttribute('data-testid')) selector += '[data-testid=\"' + cssEscape(el.getAttribute('data-testid')) + '\"]';
    else if (el.classList && el.classList.length) selector += '.' + Array.from(el.classList).slice(0, 2).map(cssEscape).join('.');
    else selector += ':nth-of-type(' + (index + 1) + ')';
    const info = {
      selector,
      tag,
      id: el.id || undefined,
      className: typeof el.className === 'string' ? el.className : undefined,
      name: accessibleName(el) || undefined,
      text: visibleText(el).slice(0, 200) || undefined,
      href: el.href || undefined,
      role: el.getAttribute('role') || undefined,
      placeholder: el.getAttribute('placeholder') || undefined,
      type: el.getAttribute('type') || undefined,
      bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    };
    if ('value' in el) info.value = String(el.value ?? '').slice(0, 500);
    if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
      info.checked = Boolean(el.checked);
    }
    return info;
  }
  function unique(nodes) {
    return Array.from(new Set(nodes.filter(Boolean)));
  }
  function byXPath(expr) {
    const out = [];
    const snap = document.evaluate(expr, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    for (let i = 0; i < snap.snapshotLength; i++) out.push(snap.snapshotItem(i));
    return out;
  }
  function labelControl(labelText, exact) {
    const labels = Array.from(document.querySelectorAll('label'));
    const hit = labels.find((lab) => {
      const t = visibleText(lab);
      return exact ? t === labelText : t.toLowerCase().includes(labelText.toLowerCase());
    });
    if (!hit) return [];
    if (hit.control) return [hit.control];
    const nested = hit.querySelector('input,textarea,select,button,[contenteditable=\"true\"]');
    return nested ? [nested] : [hit];
  }
  function findAll(locator) {
    const loc = locator || {};
    let nodes = [];
    if (loc.css || loc.selector) {
      nodes = Array.from(document.querySelectorAll(String(loc.css || loc.selector)));
    } else if (loc.id) {
      const el = document.getElementById(String(loc.id));
      nodes = el ? [el] : [];
    } else if (loc.testId) {
      const id = String(loc.testId);
      nodes = Array.from(document.querySelectorAll('[data-testid=\"' + cssEscape(id) + '\"],[data-test-id=\"' + cssEscape(id) + '\"]'));
    } else if (loc.xpath) {
      nodes = byXPath(String(loc.xpath));
    } else if (loc.label) {
      nodes = labelControl(String(loc.label), Boolean(loc.exact));
    } else if (loc.placeholder) {
      const ph = String(loc.placeholder);
      nodes = Array.from(document.querySelectorAll('input[placeholder],textarea[placeholder]')).filter((el) => {
        const v = el.getAttribute('placeholder') || '';
        return loc.exact ? v === ph : v.toLowerCase().includes(ph.toLowerCase());
      });
    } else if (loc.title) {
      const title = String(loc.title);
      nodes = Array.from(document.querySelectorAll('[title]')).filter((el) => {
        const v = el.getAttribute('title') || '';
        return loc.exact ? v === title : v.toLowerCase().includes(title.toLowerCase());
      });
    } else if (loc.role || loc.name || loc.text) {
      const role = loc.role ? String(loc.role).toLowerCase() : null;
      const name = loc.name ? String(loc.name) : null;
      const text = loc.text ? String(loc.text) : null;
      const candidates = Array.from(document.querySelectorAll('a,button,input,textarea,select,summary,[role],h1,h2,h3,h4,h5,h6,label,[contenteditable=\"true\"],div,span,li,p'));
      nodes = candidates.filter((el) => {
        if (role) {
          const r = (el.getAttribute('role') || el.tagName.toLowerCase()).toLowerCase();
          const mapped = el.tagName === 'A' ? 'link' : el.tagName === 'BUTTON' ? 'button' : r;
          if (mapped !== role && r !== role) return false;
        }
        if (name) {
          const n = accessibleName(el);
          if (loc.exact ? n !== name : !n.toLowerCase().includes(name.toLowerCase())) return false;
        }
        if (text) {
          const t = visibleText(el);
          if (loc.exact ? t !== text : !t.toLowerCase().includes(text.toLowerCase())) return false;
        }
        return true;
      });
    }
    return unique(nodes);
  }
  function pickOne(locator) {
    const all = findAll(locator);
    const nth = Math.max(0, Number(locator && locator.nth) || 0);
    return all[nth] || null;
  }
  function toInfos(nodes, limit) {
    return nodes.slice(0, limit || 20).map((el, i) => describe(el, i));
  }
  return { findAll, pickOne, toInfos, describe, visibleText, accessibleName };
})()`;

function callHelper(expr: string): string {
  return `(function(){ const api = ${PAGE_HELPERS}; return (${expr})(api); })()`;
}

export function createBrowserAutomationHost(deps: {
  tabs: BrowserTabRegistry;
  defaultWorkspaceRoot?: () => string | null;
  openTab?: (opts: {
    url?: string;
  }) => Promise<{ tabId: string; url: string; webContentsId?: number }>;
}) {
  async function handle(
    request: BrowserRpcRequest,
    ctx?: { workspaceRoot?: string | null },
  ): Promise<unknown> {
    const method = request.method as BrowserRpcMethod;
    const params = request.params ?? {};
    const workspaceRoot =
      (typeof params.workspaceRoot === "string" ? params.workspaceRoot : null) ??
      ctx?.workspaceRoot ??
      deps.defaultWorkspaceRoot?.() ??
      null;

    if (method === "browser.tabs") {
      return deps.tabs.list(workspaceRoot);
    }

    if (method === "browser.open_tab") {
      if (!deps.openTab) throw new Error("Opening browser tabs is not available");
      const rawUrl = typeof params.url === "string" ? params.url.trim() : "";
      const url = rawUrl ? assertHttpUrl(rawUrl) : undefined;
      return deps.openTab({ url });
    }

    if (method === "browser.close_tab") {
      const closeId = typeof params.tabId === "string" ? params.tabId.trim() : "";
      if (!closeId) throw new Error("tabId is required");
      deps.tabs.remove(closeId);
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send(IpcChannels.browser.closeTab, { tabId: closeId });
      }
      return { tabId: closeId, closed: true };
    }

    const tabId = typeof params.tabId === "string" ? params.tabId : null;
    const target = deps.tabs.resolveTarget({ tabId, workspaceRoot });
    if (!target) {
      throw new Error(
        "No built-in browser tab available. Use browser_open_tab first, or open a Browser tab in the right pane.",
      );
    }
    const wc = getGuest(target.webContentsId);
    if (!wc || wc.isDestroyed()) {
      throw new Error(`Browser tab webContents is gone (tabId=${target.tabId})`);
    }

    const loc = asLocator(params);

    switch (method) {
      case "browser.navigate": {
        const url = assertHttpUrl(String(params.url ?? ""));
        await wc.loadURL(url);
        return { tabId: target.tabId, url: wc.getURL() };
      }
      case "browser.back": {
        const before = wc.getURL();
        if (wc.canGoBack()) wc.goBack();
        return { tabId: target.tabId, url: wc.getURL(), previousUrl: before };
      }
      case "browser.forward": {
        if (wc.canGoForward()) wc.goForward();
        return { tabId: target.tabId, url: wc.getURL() };
      }
      case "browser.reload": {
        wc.reload();
        return { tabId: target.tabId, url: wc.getURL() };
      }
      case "browser.url": {
        const title = await runJs<string>(wc, "document.title || ''");
        return { tabId: target.tabId, url: wc.getURL(), title };
      }
      case "browser.find":
      case "browser.query": {
        if (!hasLocator(loc) && method === "browser.find") {
          throw new Error(
            "Provide at least one locator field: css/selector, id, testId, text, role, name, placeholder, label, title, or xpath",
          );
        }
        if (method === "browser.query" && !loc.css && !loc.selector) {
          // Back-compat: query still accepts bare selector param
          const selector = String(params.selector ?? "");
          if (!selector) throw new Error("selector is required");
          loc.css = selector;
        }
        const limit = Math.min(50, Math.max(1, Number(params.limit) || 20));
        const elements = await runJs<BrowserElementInfo[]>(
          wc,
          callHelper(
            `api => api.toInfos(api.findAll(${JSON.stringify(loc)}), ${limit})`,
          ),
        );
        return { tabId: target.tabId, url: wc.getURL(), count: elements.length, elements };
      }
      case "browser.snapshot": {
        const limit = Math.min(80, Math.max(1, Number(params.limit) || 40));
        const snap = await runJs<{
          url: string;
          title: string;
          elements: BrowserElementInfo[];
        }>(
          wc,
          callHelper(`api => {
            const nodes = api.findAll({ css: 'a,button,input,textarea,select,summary,[role="button"],[role="link"],[contenteditable="true"],h1,h2,h3' });
            return { url: location.href, title: document.title, elements: api.toInfos(nodes, ${limit}) };
          }`),
        );
        return { tabId: target.tabId, ...snap };
      }
      case "browser.click":
      case "browser.hover": {
        if (!hasLocator(loc)) throw new Error("locator is required");
        const result = await runJs<{ ok: boolean; selector?: string }>(
          wc,
          callHelper(`api => {
            const el = api.pickOne(${JSON.stringify(loc)});
            if (!el) return { ok: false };
            el.scrollIntoView({ block: 'center', inline: 'nearest' });
            if (${method === "browser.hover" ? "true" : "false"}) {
              el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
              el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
            } else {
              el.click();
            }
            return { ok: true, selector: api.describe(el, 0).selector };
          }`),
        );
        if (!result?.ok) throw new Error(`element not found for locator ${JSON.stringify(loc)}`);
        return { tabId: target.tabId, action: method === "browser.hover" ? "hover" : "click", selector: result.selector };
      }
      case "browser.type":
      case "browser.fill": {
        const content = String(params.value ?? params.input ?? params.typeText ?? params.text ?? "");
        if (method === "browser.type" && !content && params.value == null && params.input == null && params.typeText == null && params.text == null) {
          throw new Error("value is required");
        }
        // Content belongs in value; only keep text as a text-locator when value was provided separately.
        const locatorForFind: BrowserLocator = { ...loc };
        if (params.value != null || params.input != null || params.typeText != null) {
          // fine — text may still be a locator
        } else if (
          locatorForFind.text &&
          (locatorForFind.css ||
            locatorForFind.id ||
            locatorForFind.testId ||
            locatorForFind.role ||
            locatorForFind.name ||
            locatorForFind.placeholder ||
            locatorForFind.label ||
            locatorForFind.title ||
            locatorForFind.xpath)
        ) {
          delete locatorForFind.text;
        } else if (
          locatorForFind.css ||
          locatorForFind.id ||
          locatorForFind.testId ||
          locatorForFind.role ||
          locatorForFind.name ||
          locatorForFind.placeholder ||
          locatorForFind.label ||
          locatorForFind.title ||
          locatorForFind.xpath
        ) {
          delete locatorForFind.text;
        } else if (params.text != null && params.value == null) {
          // Ambiguous legacy: text-only without other locator → treat as content, require another locator.
          throw new Error("locator is required (css/id/label/placeholder/role/name/...); put content in value");
        }
        if (!hasLocator(locatorForFind)) {
          throw new Error("locator is required (css/id/label/placeholder/role/name/text/...)");
        }
        const clear = method === "browser.fill" ? true : params.clear !== false;
        const pressEnter = params.pressEnter === true;
        const result = await runJs<{ ok: boolean; selector?: string }>(
          wc,
          callHelper(`api => {
            const el = api.pickOne(${JSON.stringify(locatorForFind)});
            if (!el) return { ok: false };
            el.scrollIntoView({ block: 'center', inline: 'nearest' });
            el.focus();
            const value = ${JSON.stringify(content)};
            const clearFirst = ${clear ? "true" : "false"};
            if (clearFirst && 'value' in el) el.value = '';
            if ('value' in el) {
              el.value = (clearFirst ? '' : (el.value || '')) + value;
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            } else if (el.isContentEditable) {
              if (clearFirst) el.textContent = '';
              el.textContent = (el.textContent || '') + value;
              el.dispatchEvent(new InputEvent('input', { bubbles: true }));
            } else {
              return { ok: false };
            }
            if (${pressEnter ? "true" : "false"}) {
              el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
              el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
            }
            return { ok: true, selector: api.describe(el, 0).selector };
          }`),
        );
        if (!result?.ok) {
          throw new Error(`element not found or not editable for locator ${JSON.stringify(locatorForFind)}`);
        }
        return { tabId: target.tabId, typed: content.length, selector: result.selector };
      }
      case "browser.press": {
        const key = String(params.key ?? "").trim();
        if (!key) throw new Error("key is required (e.g. Enter, Escape, Tab, ArrowDown)");
        if (hasLocator(loc)) {
          const ok = await runJs<boolean>(
            wc,
            callHelper(`api => {
              const el = api.pickOne(${JSON.stringify(loc)});
              if (!el) return false;
              el.focus();
              el.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true }));
              el.dispatchEvent(new KeyboardEvent('keyup', { key: ${JSON.stringify(key)}, bubbles: true }));
              return true;
            }`),
          );
          if (!ok) throw new Error(`element not found for locator ${JSON.stringify(loc)}`);
        } else {
          await runJs(
            wc,
            `document.activeElement && document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true }));
             document.activeElement && document.activeElement.dispatchEvent(new KeyboardEvent('keyup', { key: ${JSON.stringify(key)}, bubbles: true }));
             true`,
          );
        }
        return { tabId: target.tabId, key };
      }
      case "browser.select": {
        if (!hasLocator(loc)) throw new Error("locator is required");
        const value = params.value != null ? String(params.value) : undefined;
        const label = params.optionLabel != null ? String(params.optionLabel) : undefined;
        if (!value && !label) throw new Error("value or optionLabel is required");
        const result = await runJs<{ ok: boolean; selected?: string }>(
          wc,
          callHelper(`api => {
            const el = api.pickOne(${JSON.stringify(loc)});
            if (!el || el.tagName !== 'SELECT') return { ok: false };
            const wantValue = ${JSON.stringify(value ?? null)};
            const wantLabel = ${JSON.stringify(label ?? null)};
            let opt = null;
            for (const o of Array.from(el.options)) {
              if (wantValue != null && o.value === wantValue) { opt = o; break; }
              if (wantLabel != null && o.text.trim() === wantLabel) { opt = o; break; }
              if (wantLabel != null && o.text.trim().toLowerCase().includes(wantLabel.toLowerCase())) { opt = o; break; }
            }
            if (!opt) return { ok: false };
            el.value = opt.value;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return { ok: true, selected: opt.value };
          }`),
        );
        if (!result?.ok) throw new Error("select element/option not found");
        return { tabId: target.tabId, selected: result.selected };
      }
      case "browser.check": {
        if (!hasLocator(loc)) throw new Error("locator is required");
        const checked = params.checked !== false;
        const result = await runJs<{ ok: boolean; checked?: boolean }>(
          wc,
          callHelper(`api => {
            const el = api.pickOne(${JSON.stringify(loc)});
            if (!el || !('checked' in el)) return { ok: false };
            el.checked = ${checked ? "true" : "false"};
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return { ok: true, checked: Boolean(el.checked) };
          }`),
        );
        if (!result?.ok) throw new Error("checkbox/radio not found");
        return { tabId: target.tabId, checked: result.checked };
      }
      case "browser.scroll": {
        if (hasLocator(loc)) {
          const ok = await runJs<boolean>(
            wc,
            callHelper(`api => {
              const el = api.pickOne(${JSON.stringify(loc)});
              if (!el) return false;
              el.scrollIntoView({ block: 'center', inline: 'nearest' });
              return true;
            }`),
          );
          if (!ok) throw new Error(`element not found for locator ${JSON.stringify(loc)}`);
          return { tabId: target.tabId, scrolledTo: "element" };
        }
        const x = Number(params.x) || 0;
        const y = Number(params.y) || 0;
        await runJs(wc, `window.scrollBy(${x}, ${y}); true`);
        return { tabId: target.tabId, scrolledBy: { x, y } };
      }
      case "browser.wait_for": {
        if (!hasLocator(loc)) throw new Error("locator is required");
        const timeoutMs = Math.min(60_000, Math.max(100, Number(params.timeoutMs) || 10_000));
        const state = String(params.state || "visible"); // visible | hidden | attached
        const started = Date.now();
        while (Date.now() - started < timeoutMs) {
          const found = await runJs<boolean>(
            wc,
            callHelper(`api => {
              const el = api.pickOne(${JSON.stringify(loc)});
              if (${JSON.stringify(state)} === 'attached') return Boolean(el);
              if (${JSON.stringify(state)} === 'hidden') {
                if (!el) return true;
                const r = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return style.display === 'none' || style.visibility === 'hidden' || r.width === 0 || r.height === 0;
              }
              if (!el) return false;
              const r = el.getBoundingClientRect();
              const style = window.getComputedStyle(el);
              return style.display !== 'none' && style.visibility !== 'hidden' && r.width > 0 && r.height > 0;
            }`),
          );
          if (found) return { tabId: target.tabId, ready: true, waitedMs: Date.now() - started };
          await new Promise<void>((r) => setTimeout(r, 200));
        }
        throw new Error(`wait_for timed out after ${timeoutMs}ms for ${JSON.stringify(loc)}`);
      }
      case "browser.get_text": {
        if (!hasLocator(loc)) {
          const text = await runJs<string>(
            wc,
            `document.body ? (document.body.innerText || '') : ''`,
          );
          return { tabId: target.tabId, text: text.slice(0, 50_000) };
        }
        const text = await runJs<string | null>(
          wc,
          callHelper(`api => {
            const el = api.pickOne(${JSON.stringify(loc)});
            return el ? api.visibleText(el) : null;
          }`),
        );
        if (text == null) throw new Error(`element not found for locator ${JSON.stringify(loc)}`);
        return { tabId: target.tabId, text: text.slice(0, 50_000) };
      }
      case "browser.get_html": {
        if (!hasLocator(loc)) {
          const html = await runJs<string>(wc, `document.documentElement.outerHTML`);
          return { tabId: target.tabId, html: html.slice(0, 80_000) };
        }
        const html = await runJs<string | null>(
          wc,
          callHelper(`api => {
            const el = api.pickOne(${JSON.stringify(loc)});
            return el ? el.outerHTML : null;
          }`),
        );
        if (html == null) throw new Error(`element not found for locator ${JSON.stringify(loc)}`);
        return { tabId: target.tabId, html: html.slice(0, 80_000) };
      }
      case "browser.get_attribute": {
        if (!hasLocator(loc)) throw new Error("locator is required");
        const name = String(params.attribute ?? params.attr ?? "").trim();
        if (!name) throw new Error("attribute is required");
        const value = await runJs<string | null>(
          wc,
          callHelper(`api => {
            const el = api.pickOne(${JSON.stringify(loc)});
            if (!el) return null;
            return el.getAttribute(${JSON.stringify(name)});
          }`),
        );
        const exists = await runJs<boolean>(
          wc,
          callHelper(`api => Boolean(api.pickOne(${JSON.stringify(loc)}))`),
        );
        if (!exists) throw new Error(`element not found for locator ${JSON.stringify(loc)}`);
        return { tabId: target.tabId, attribute: name, value };
      }
      case "browser.get_value": {
        if (!hasLocator(loc)) throw new Error("locator is required");
        const value = await runJs<string | null>(
          wc,
          callHelper(`api => {
            const el = api.pickOne(${JSON.stringify(loc)});
            if (!el) return null;
            if ('value' in el) return String(el.value ?? '');
            return api.visibleText(el);
          }`),
        );
        if (value == null) throw new Error(`element not found for locator ${JSON.stringify(loc)}`);
        return { tabId: target.tabId, value };
      }
      case "browser.evaluate": {
        const expression = String(params.expression ?? "").trim();
        if (!expression) throw new Error("expression is required");
        if (expression.length > 8_000) throw new Error("expression too long");
        const result = await runJs<unknown>(
          wc,
          `(function(){ return (${expression}); })()`,
        );
        let serialized: string;
        try {
          serialized = JSON.stringify(result, null, 2) ?? String(result);
        } catch {
          serialized = String(result);
        }
        return { tabId: target.tabId, result: serialized.slice(0, 80_000) };
      }
      case "browser.tabs":
      case "browser.open_tab":
      case "browser.close_tab":
        return null;
      default: {
        const _exhaustive: never = method;
        throw new Error(`unknown browser method: ${String(_exhaustive)}`);
      }
    }
  }

  return { handle };
}
