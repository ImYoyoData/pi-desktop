import { randomUUID } from "node:crypto";
import { BrowserWindow, WebContentsView, ipcMain } from "electron";
import type { ElementCitation } from "../shared/protocol";
import { IpcChannels } from "../shared/protocol";
import { truncateHtmlSnippet } from "../shared/html-snippet";
import {
  SELECT_ELEMENT_CONSOLE_PREFIX,
  injectSelectMode,
  removeSelectMode,
} from "./select-element-script";

type BrowserInstance = {
  view: WebContentsView;
  selectActive: boolean;
  onConsoleMessage: (event: Electron.Event, details: Electron.OnConsoleMessageEventParams) => void;
};

const browsers = new Map<string, BrowserInstance>();

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "about:blank";
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

function broadcastElementSelected(citation: ElementCitation): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IpcChannels.browser.elementSelected, citation);
  }
}

function attachBrowser(id: string, win: BrowserWindow): WebContentsView {
  const view = new WebContentsView({
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const onConsoleMessage = (
    _event: Electron.Event,
    details: Electron.OnConsoleMessageEventParams,
  ) => {
    const inst = browsers.get(id);
    if (!inst?.selectActive) {
      return;
    }
    const message = details.message;
    if (!message.startsWith(SELECT_ELEMENT_CONSOLE_PREFIX)) {
      return;
    }
    const json = message.slice(SELECT_ELEMENT_CONSOLE_PREFIX.length);
    try {
      const payload = JSON.parse(json) as {
        url: string;
        selector: string;
        text: string;
        html: string;
      };
      const citation: ElementCitation = {
        url: payload.url || inst.view.webContents.getURL(),
        selector: payload.selector,
        text: payload.text,
        htmlSnippet: truncateHtmlSnippet(payload.html),
      };
      inst.selectActive = false;
      void removeSelectMode(inst.view.webContents);
      broadcastElementSelected(citation);
    } catch {
      // Ignore malformed selection payloads.
    }
  };

  view.webContents.on("console-message", onConsoleMessage);
  view.webContents.setWindowOpenHandler((details) => {
    void view.webContents.loadURL(normalizeUrl(details.url));
    return { action: "deny" };
  });

  win.contentView.addChildView(view);
  view.setBounds({ x: 0, y: 0, width: 0, height: 0 });

  browsers.set(id, { view, selectActive: false, onConsoleMessage });
  return view;
}

export function registerBrowserIpc(): void {
  ipcMain.handle(IpcChannels.browser.create, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) {
      throw new Error("browser:create requires a BrowserWindow");
    }
    const id = randomUUID();
    attachBrowser(id, win);
    return id;
  });

  ipcMain.handle(
    IpcChannels.browser.setBounds,
    (event, id: string, bounds: { x: number; y: number; width: number; height: number }) => {
      const inst = browsers.get(id);
      if (!inst || !BrowserWindow.fromWebContents(event.sender)) {
        return;
      }
      inst.view.setBounds({
        x: Math.round(bounds.x),
        y: Math.round(bounds.y),
        width: Math.max(0, Math.round(bounds.width)),
        height: Math.max(0, Math.round(bounds.height)),
      });
    },
  );

  ipcMain.handle(IpcChannels.browser.navigate, (_event, id: string, url: string) => {
    const inst = browsers.get(id);
    if (!inst) {
      return;
    }
    void inst.view.webContents.loadURL(normalizeUrl(url));
  });

  ipcMain.handle(IpcChannels.browser.back, (_event, id: string) => {
    const wc = browsers.get(id)?.view.webContents;
    if (wc?.navigationHistory.canGoBack()) {
      wc.navigationHistory.goBack();
    }
  });

  ipcMain.handle(IpcChannels.browser.forward, (_event, id: string) => {
    const wc = browsers.get(id)?.view.webContents;
    if (wc?.navigationHistory.canGoForward()) {
      wc.navigationHistory.goForward();
    }
  });

  ipcMain.handle(IpcChannels.browser.reload, (_event, id: string) => {
    browsers.get(id)?.view.webContents.reload();
  });

  ipcMain.handle(IpcChannels.browser.startSelect, async (_event, id: string) => {
    const inst = browsers.get(id);
    if (!inst) {
      return { ok: false as const, reason: "missing" as const };
    }
    try {
      await injectSelectMode(inst.view.webContents);
      inst.selectActive = true;
      return { ok: true as const };
    } catch {
      inst.selectActive = false;
      return { ok: false as const, reason: "csp" as const };
    }
  });

  ipcMain.handle(IpcChannels.browser.stopSelect, async (_event, id: string) => {
    const inst = browsers.get(id);
    if (!inst) {
      return;
    }
    inst.selectActive = false;
    await removeSelectMode(inst.view.webContents);
  });

  ipcMain.handle(IpcChannels.browser.destroy, (event, id: string) => {
    const inst = browsers.get(id);
    if (!inst) {
      return;
    }
    const win = BrowserWindow.fromWebContents(event.sender);
    inst.view.webContents.removeListener("console-message", inst.onConsoleMessage);
    if (win) {
      win.contentView.removeChildView(inst.view);
    }
    browsers.delete(id);
  });
}
