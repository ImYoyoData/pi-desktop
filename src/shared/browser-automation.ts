/** Shared types for built-in browser automation (worker ↔ main RPC). */

export type BrowserTabInfo = {
  tabId: string;
  webContentsId: number;
  url: string;
  title: string;
  visible: boolean;
  workspaceRoot: string | null;
};

export type BrowserRpcMethod =
  | "browser.tabs"
  | "browser.open_tab"
  | "browser.close_tab"
  | "browser.navigate"
  | "browser.back"
  | "browser.forward"
  | "browser.reload"
  | "browser.url"
  | "browser.find"
  | "browser.query"
  | "browser.snapshot"
  | "browser.click"
  | "browser.hover"
  | "browser.type"
  | "browser.fill"
  | "browser.press"
  | "browser.select"
  | "browser.check"
  | "browser.scroll"
  | "browser.wait_for"
  | "browser.get_text"
  | "browser.get_html"
  | "browser.get_attribute"
  | "browser.get_value"
  | "browser.evaluate";

export type BrowserRpcRequest = {
  method: BrowserRpcMethod;
  params: Record<string, unknown>;
};

/** How to locate a DOM element. Prefer the most specific field available. */
export type BrowserLocator = {
  /** CSS selector */
  css?: string;
  /** Alias of css */
  selector?: string;
  /** Element id (without #) */
  id?: string;
  /** data-testid / data-test-id */
  testId?: string;
  /** Visible text (contains by default; exact with exact:true) */
  text?: string;
  /** Exact text match when using text */
  exact?: boolean;
  /** ARIA role */
  role?: string;
  /** Accessible name / aria-label / associated label */
  name?: string;
  /** input placeholder */
  placeholder?: string;
  /** label text associated with a control */
  label?: string;
  /** title attribute */
  title?: string;
  /** XPath expression */
  xpath?: string;
  /** 0-based index among matches (default 0) */
  nth?: number;
};

export type BrowserElementInfo = {
  selector: string;
  tag: string;
  id?: string;
  className?: string;
  name?: string;
  text?: string;
  value?: string;
  href?: string;
  role?: string;
  placeholder?: string;
  type?: string;
  checked?: boolean;
  bounds?: { x: number; y: number; width: number; height: number };
};

export const BROWSER_RPC_TIMEOUT_MS = 30_000;
