import { app, BrowserWindow, Menu, shell } from "electron";
import { APP_GITHUB_URL } from "../shared/app-meta";
import { IpcChannels, type MenuCommand } from "../shared/protocol";

/** 菜单命令交给渲染进程执行，缩放与设置页共用同一份字号偏好。 */
function sendMenuCommand(win: Electron.BaseWindow | undefined, command: MenuCommand): void {
  if (!(win instanceof BrowserWindow)) return;
  win.webContents.send(IpcChannels.window.menuCommand, command);
}

/** Native app menu — especially important on macOS for Edit/Copy/Paste shortcuts. */
export function installApplicationMenu(): void {
  const isMac = process.platform === "darwin";

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" as const },
              { type: "separator" as const },
              { role: "services" as const },
              { type: "separator" as const },
              { role: "hide" as const },
              { role: "hideOthers" as const },
              { role: "unhide" as const },
              { type: "separator" as const },
              { role: "quit" as const },
            ],
          },
        ]
      : []),
    {
      label: "File",
      submenu: [isMac ? { role: "close" } : { role: "quit" }],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        ...(isMac
          ? [
              { role: "pasteAndMatchStyle" as const },
              { role: "delete" as const },
              { role: "selectAll" as const },
            ]
          : [
              { role: "delete" as const },
              { type: "separator" as const },
              { role: "selectAll" as const },
            ]),
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { type: "separator" },
        {
          /** 不用 zoomIn role：它自带的 Ctrl+= 会抢走应用快捷键，改为仅菜单点击。 */
          label: "Zoom In",
          click: (_item, win) => sendMenuCommand(win, "zoom-in"),
        },
        {
          label: "Zoom Out",
          accelerator: "CmdOrCtrl+-",
          click: (_item, win) => sendMenuCommand(win, "zoom-out"),
        },
        {
          label: "Reset Zoom",
          accelerator: "CmdOrCtrl+0",
          click: (_item, win) => sendMenuCommand(win, "zoom-reset"),
        },
        { type: "separator" },
        {
          label: "Pull Requests",
          click: (_item, win) => sendMenuCommand(win, "open-pull-requests"),
        },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        ...(isMac
          ? [
              { type: "separator" as const },
              { role: "front" as const },
              { type: "separator" as const },
              { role: "window" as const },
            ]
          : [{ role: "close" as const }]),
      ],
    },
    {
      role: "help",
      submenu: [
        {
          label: "Pi Desktop on GitHub",
          click: () => {
            void shell.openExternal(APP_GITHUB_URL);
          },
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
