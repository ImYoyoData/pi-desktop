import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { rpcToMain } from "./main-rpc";

function textResult(data: unknown) {
  const body = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return {
    content: [{ type: "text" as const, text: body.slice(0, 100_000) }],
  };
}

const tabIdProp = Type.Optional(
  Type.String({
    description: "Built-in browser tab id (from browser_tabs / browser_open_tab). Defaults to the visible tab.",
  }),
);

/** Shared locator fields — use any one (or combine role+name / text). */
const locatorFields = {
  css: Type.Optional(Type.String({ description: "CSS selector" })),
  selector: Type.Optional(Type.String({ description: "Alias of css" })),
  id: Type.Optional(Type.String({ description: "Element id (without #)" })),
  testId: Type.Optional(Type.String({ description: "data-testid / data-test-id value" })),
  text: Type.Optional(
    Type.String({ description: "Visible text (contains match unless exact=true)" }),
  ),
  exact: Type.Optional(Type.Boolean({ description: "Exact match for text/name/label/placeholder" })),
  role: Type.Optional(Type.String({ description: "ARIA role, e.g. button, link, textbox" })),
  name: Type.Optional(
    Type.String({ description: "Accessible name / aria-label / associated label text" }),
  ),
  placeholder: Type.Optional(Type.String({ description: "input/textarea placeholder" })),
  label: Type.Optional(Type.String({ description: "Label text associated with a control" })),
  title: Type.Optional(Type.String({ description: "title attribute" })),
  xpath: Type.Optional(Type.String({ description: "XPath expression" })),
  nth: Type.Optional(Type.Number({ description: "0-based index among matches (default 0)" })),
  tabId: tabIdProp,
};

const locatorObject = Type.Object(locatorFields);

export function createBrowserToolDefinitions() {
  return [
    defineTool({
      name: "browser_tabs",
      label: "Browser tabs",
      description: "List Pi Desktop built-in browser tabs. Use tabId with other browser_* tools. Only for the embedded right-pane browser — not general web fetch.",
      promptSnippet: "List built-in browser tabs",
      promptGuidelines: [
        "Use browser_* only when the user asks for the embedded browser or selected page elements.",
        "For ordinary network/fetch/research, prefer MCP servers and extension tools.",
        "Use browser_open_tab when you need a new tab / no tab exists.",
      ],
      parameters: Type.Object({}),
      async execute() {
        return textResult(await rpcToMain("browser.tabs", {}));
      },
    }),
    defineTool({
      name: "browser_open_tab",
      label: "Browser open tab",
      description: "Open a new built-in browser tab. Optional url loads immediately. Returns tabId.",
      promptSnippet: "Open a new built-in browser tab",
      parameters: Type.Object({
        url: Type.Optional(Type.String({ description: "Optional http(s) URL" })),
      }),
      async execute(_id, params) {
        return textResult(await rpcToMain("browser.open_tab", { url: params.url }));
      },
    }),
    defineTool({
      name: "browser_close_tab",
      label: "Browser close tab",
      description:
        "Close a built-in browser tab. Pass tabId from browser_tabs, or omit tabId to close the visible/active browser tab.",
      promptSnippet: "Close a built-in browser tab",
      promptGuidelines: [
        "Use browser_tabs first if you need a specific tabId.",
        "Omit tabId to close whichever browser tab is currently visible.",
      ],
      parameters: Type.Object({
        tabId: Type.Optional(
          Type.String({
            description: "Tab id from browser_tabs. Omit to close the visible browser tab.",
          }),
        ),
      }),
      async execute(_id, params) {
        return textResult(await rpcToMain("browser.close_tab", { tabId: params.tabId }));
      },
    }),
    defineTool({
      name: "browser_navigate",
      label: "Browser navigate",
      description: "Navigate a built-in browser tab to an http(s) URL.",
      promptSnippet: "Navigate the built-in browser",
      parameters: Type.Object({
        url: Type.String({ description: "http(s) URL" }),
        tabId: tabIdProp,
      }),
      async execute(_id, params) {
        return textResult(
          await rpcToMain("browser.navigate", { url: params.url, tabId: params.tabId }),
        );
      },
    }),
    defineTool({
      name: "browser_back",
      label: "Browser back",
      description: "History back in the built-in browser tab.",
      promptSnippet: "Browser history back",
      parameters: Type.Object({ tabId: tabIdProp }),
      async execute(_id, params) {
        return textResult(await rpcToMain("browser.back", { tabId: params.tabId }));
      },
    }),
    defineTool({
      name: "browser_forward",
      label: "Browser forward",
      description: "History forward in the built-in browser tab.",
      promptSnippet: "Browser history forward",
      parameters: Type.Object({ tabId: tabIdProp }),
      async execute(_id, params) {
        return textResult(await rpcToMain("browser.forward", { tabId: params.tabId }));
      },
    }),
    defineTool({
      name: "browser_reload",
      label: "Browser reload",
      description: "Reload the built-in browser tab.",
      promptSnippet: "Reload built-in browser",
      parameters: Type.Object({ tabId: tabIdProp }),
      async execute(_id, params) {
        return textResult(await rpcToMain("browser.reload", { tabId: params.tabId }));
      },
    }),
    defineTool({
      name: "browser_url",
      label: "Browser URL",
      description: "Get current URL and document title of a built-in browser tab.",
      promptSnippet: "Get built-in browser URL/title",
      parameters: Type.Object({ tabId: tabIdProp }),
      async execute(_id, params) {
        return textResult(await rpcToMain("browser.url", { tabId: params.tabId }));
      },
    }),
    defineTool({
      name: "browser_snapshot",
      label: "Browser snapshot",
      description: "Compact snapshot of interactive elements (links, buttons, inputs, headings).",
      promptSnippet: "Snapshot interactive DOM elements",
      parameters: Type.Object({
        tabId: tabIdProp,
        limit: Type.Optional(Type.Number({ description: "Max elements (default 40)" })),
      }),
      async execute(_id, params) {
        return textResult(
          await rpcToMain("browser.snapshot", { tabId: params.tabId, limit: params.limit }),
        );
      },
    }),
    defineTool({
      name: "browser_find",
      label: "Browser find",
      description:
        "Find DOM elements by css/id/text/role/name/placeholder/label/title/testId/xpath. Returns matching element descriptors (selector, text, bounds).",
      promptSnippet: "Find elements by text, id, role, css, etc.",
      promptGuidelines: [
        "Prefer browser_find with text/role/name/id over brittle long CSS when possible.",
        "Use exact=true for exact text/name matches.",
        "Use nth to pick among multiple matches (0-based).",
      ],
      parameters: locatorObject,
      async execute(_id, params) {
        return textResult(await rpcToMain("browser.find", { ...params }));
      },
    }),
    defineTool({
      name: "browser_query",
      label: "Browser query (CSS)",
      description: "Query DOM elements with a CSS selector (shorthand for browser_find with css).",
      promptSnippet: "Query DOM via CSS selector",
      parameters: Type.Object({
        selector: Type.String({ description: "CSS selector" }),
        tabId: tabIdProp,
        limit: Type.Optional(Type.Number({ description: "Max matches (default 20)" })),
      }),
      async execute(_id, params) {
        return textResult(
          await rpcToMain("browser.query", {
            selector: params.selector,
            tabId: params.tabId,
            limit: params.limit,
          }),
        );
      },
    }),
    defineTool({
      name: "browser_click",
      label: "Browser click",
      description: "Click an element located by css/id/text/role/name/label/testId/xpath/etc.",
      promptSnippet: "Click a DOM element (flexible locator)",
      parameters: locatorObject,
      async execute(_id, params) {
        return textResult(await rpcToMain("browser.click", { ...params }));
      },
    }),
    defineTool({
      name: "browser_hover",
      label: "Browser hover",
      description: "Hover an element located by css/id/text/role/name/etc.",
      promptSnippet: "Hover a DOM element",
      parameters: locatorObject,
      async execute(_id, params) {
        return textResult(await rpcToMain("browser.hover", { ...params }));
      },
    }),
    defineTool({
      name: "browser_type",
      label: "Browser type",
      description:
        "Type into an input/textarea/contenteditable. Locate with css/id/label/placeholder/role/name/...; put the content in value.",
      promptSnippet: "Type into a DOM element",
      parameters: Type.Object({
        ...locatorFields,
        value: Type.String({ description: "Text to type into the field" }),
        clear: Type.Optional(Type.Boolean({ description: "Clear first (default true)" })),
        pressEnter: Type.Optional(Type.Boolean({ description: "Press Enter after typing" })),
      }),
      async execute(_id, params) {
        return textResult(await rpcToMain("browser.type", { ...params }));
      },
    }),
    defineTool({
      name: "browser_fill",
      label: "Browser fill",
      description: "Clear and fill a field. Locate with css/id/label/placeholder/...; content in value.",
      promptSnippet: "Fill a form field",
      parameters: Type.Object({
        ...locatorFields,
        value: Type.String({ description: "Text to fill" }),
        pressEnter: Type.Optional(Type.Boolean({ description: "Press Enter after fill" })),
      }),
      async execute(_id, params) {
        return textResult(await rpcToMain("browser.fill", { ...params }));
      },
    }),
    defineTool({
      name: "browser_press",
      label: "Browser press key",
      description: "Press a keyboard key (optionally on a located element, else active element).",
      promptSnippet: "Press a key in the built-in browser",
      parameters: Type.Object({
        ...locatorFields,
        key: Type.String({ description: "Key name, e.g. Enter, Escape, Tab, ArrowDown" }),
      }),
      async execute(_id, params) {
        return textResult(await rpcToMain("browser.press", { ...params }));
      },
    }),
    defineTool({
      name: "browser_select",
      label: "Browser select option",
      description: "Select an option in a <select> by value or visible label.",
      promptSnippet: "Select a dropdown option",
      parameters: Type.Object({
        ...locatorFields,
        value: Type.Optional(Type.String({ description: "option value" })),
        optionLabel: Type.Optional(Type.String({ description: "option visible text" })),
      }),
      async execute(_id, params) {
        return textResult(await rpcToMain("browser.select", { ...params }));
      },
    }),
    defineTool({
      name: "browser_check",
      label: "Browser check",
      description: "Check/uncheck a checkbox or radio.",
      promptSnippet: "Toggle checkbox/radio",
      parameters: Type.Object({
        ...locatorFields,
        checked: Type.Optional(Type.Boolean({ description: "Desired checked state (default true)" })),
      }),
      async execute(_id, params) {
        return textResult(await rpcToMain("browser.check", { ...params }));
      },
    }),
    defineTool({
      name: "browser_scroll",
      label: "Browser scroll",
      description: "Scroll to an element (locator) or by pixel offsets x/y.",
      promptSnippet: "Scroll the built-in browser",
      parameters: Type.Object({
        ...locatorFields,
        x: Type.Optional(Type.Number({ description: "scrollBy x when no locator" })),
        y: Type.Optional(Type.Number({ description: "scrollBy y when no locator" })),
      }),
      async execute(_id, params) {
        return textResult(await rpcToMain("browser.scroll", { ...params }));
      },
    }),
    defineTool({
      name: "browser_wait_for",
      label: "Browser wait for",
      description: "Wait until an element is visible, hidden, or attached.",
      promptSnippet: "Wait for a DOM element",
      parameters: Type.Object({
        ...locatorFields,
        state: Type.Optional(
          Type.String({ description: "visible | hidden | attached (default visible)" }),
        ),
        timeoutMs: Type.Optional(Type.Number({ description: "Timeout ms (default 10000)" })),
      }),
      async execute(_id, params) {
        return textResult(await rpcToMain("browser.wait_for", { ...params }));
      },
    }),
    defineTool({
      name: "browser_get_text",
      label: "Browser get text",
      description: "Get visible text from body or a located element.",
      promptSnippet: "Read text from the built-in browser",
      parameters: locatorObject,
      async execute(_id, params) {
        return textResult(await rpcToMain("browser.get_text", { ...params }));
      },
    }),
    defineTool({
      name: "browser_get_html",
      label: "Browser get HTML",
      description: "Get outer HTML for document or a located element (size-capped).",
      promptSnippet: "Read HTML from the built-in browser",
      parameters: locatorObject,
      async execute(_id, params) {
        return textResult(await rpcToMain("browser.get_html", { ...params }));
      },
    }),
    defineTool({
      name: "browser_get_attribute",
      label: "Browser get attribute",
      description: "Get an attribute value from a located element.",
      promptSnippet: "Read a DOM attribute",
      parameters: Type.Object({
        ...locatorFields,
        attribute: Type.String({ description: "Attribute name, e.g. href, aria-label, src" }),
      }),
      async execute(_id, params) {
        return textResult(await rpcToMain("browser.get_attribute", { ...params }));
      },
    }),
    defineTool({
      name: "browser_get_value",
      label: "Browser get value",
      description: "Get the value of an input/textarea/select (or text content fallback).",
      promptSnippet: "Read input value",
      parameters: locatorObject,
      async execute(_id, params) {
        return textResult(await rpcToMain("browser.get_value", { ...params }));
      },
    }),
    defineTool({
      name: "browser_evaluate",
      label: "Browser evaluate",
      description: "Evaluate a short JS expression in the page. Prefer find/get_* tools first.",
      promptSnippet: "Evaluate JS in the built-in browser",
      parameters: Type.Object({
        expression: Type.String({ description: "JS expression, e.g. document.title" }),
        tabId: tabIdProp,
      }),
      async execute(_id, params) {
        return textResult(
          await rpcToMain("browser.evaluate", {
            expression: params.expression,
            tabId: params.tabId,
          }),
        );
      },
    }),
  ];
}
