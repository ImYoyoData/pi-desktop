/* pi-desktop UI driver: launch built app, screenshot the right pane. */
import { _electron as electron } from "file:///C:/Users/MIAN/AppData/Local/Temp/pw/node_modules/playwright-core/index.mjs";
import fs from "node:fs";

const SHOTS = "F:/Code/Work/pi-desktop/.tmp-shots";
fs.mkdirSync(SHOTS, { recursive: true });

const app = await electron.launch({
  executablePath: "F:/Code/Work/pi-desktop/node_modules/electron/dist/electron.exe",
  args: ["."],
  cwd: "F:/Code/Work/pi-desktop",
  timeout: 60000,
});

const page = await app.firstWindow();
page.on("console", (m) => {
  const t = m.text();
  if (/error|Error/.test(t)) console.log("[console]", t.slice(0, 200));
});
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 300)));

// Wait for the workspace to load (right pane renders tabs/dock).
await page.waitForTimeout(9000);
await page.screenshot({ path: `${SHOTS}/01-initial.png` });
console.log("shot 01-initial");

// Log what the right pane looks like structurally.
const info = await page.evaluate(() => {
  const pane = document.querySelector(".right-pane");
  const panels = document.querySelector(".tab-panels");
  const active = document.querySelector(".tab-item.active");
  return {
    hasRightPane: Boolean(pane),
    paneBox: pane ? JSON.parse(JSON.stringify(pane.getBoundingClientRect())) : null,
    panelsBox: panels ? JSON.parse(JSON.stringify(panels.getBoundingClientRect())) : null,
    activeTab: active ? active.textContent : null,
    tabCount: document.querySelectorAll(".tab-item").length,
    dockCol: Boolean(document.querySelector(".dock-col")),
    bodyText: (pane?.textContent || "").slice(0, 200),
  };
});
console.log(JSON.stringify(info, null, 2));

// Open a file preview from the Files dock: switch dock to files, click a row.
await page.evaluate(() => {
  const tabs = [...document.querySelectorAll(".dock-col-head .dock-tab")];
  tabs.find((b) => b.textContent.trim() === "文件")?.click();
});
await page.waitForTimeout(1200);
await page.screenshot({ path: `${SHOTS}/02-files-dock.png` });
console.log("shot 02-files-dock");

// Dbl-click (or click) the index.ts row in the files tree.
const clicked = await page.evaluate(() => {
  const rows = [...document.querySelectorAll(".files-tab [title]")];
  const row = rows.find((r) => (r.getAttribute("title") || "").endsWith("index.ts"));
  if (!row) return "row not found: " + rows.map((r) => r.getAttribute("title")).join(",");
  row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  return "clicked " + row.getAttribute("title");
});
console.log(clicked);
await page.waitForTimeout(2500);
await page.screenshot({ path: `${SHOTS}/03-preview.png` });
console.log("shot 03-preview");

const previewInfo = await page.evaluate(() => {
  const panel = document.querySelector(".tab-panel");
  const monaco = document.querySelector(".tab-panel .monaco-editor");
  const inner = document.querySelector(".preview-inner, .preview-host, .editor-host");
  const r = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { w: Math.round(b.width), h: Math.round(b.height) };
  };
  return {
    panelBox: r(panel),
    monacoBox: r(monaco),
    hostBox: r(inner),
    tabLabels: [...document.querySelectorAll(".tab-label")].map((e) => e.textContent),
  };
});
console.log(JSON.stringify(previewInfo, null, 2));

await app.close();
console.log("done");
