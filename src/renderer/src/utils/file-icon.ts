/**
 * VS Code 同款文件图标 —— 直接移植 vscode 默认的 Seti 文件图标主题
 * （同目录 assets/ 下的 seti.woff + vs-seti-icon-theme.json，与
 * microsoft/vscode extensions/theme-seti 完全一致），查找顺序与
 * vscode 的 getIconClasses 相同：fileNames → languageIds →
 * fileExtensions → 默认图标。languageIds 一档需要“文件名/扩展名 →
 * 语言 id”的映射，此处内置常见语言（语言 id 与 vscode 内置语言一致）。
 * 仅使用深色默认映射（pi-desktop 为深色界面），light 变体不取。
 */
import setiWoffUrl from "@renderer/assets/seti.woff?url";
import setiThemeJson from "@renderer/assets/vs-seti-icon-theme.json?raw";

interface SetiIconDef {
  fontCharacter: string;
  fontColor?: string;
}

interface SetiTheme {
  iconDefinitions: Record<string, SetiIconDef>;
  file?: string;
  fileExtensions?: Record<string, string>;
  fileNames?: Record<string, string>;
  languageIds?: Record<string, string>;
}

const theme = JSON.parse(
  setiThemeJson.replace(/^\s*\/\/.*$/gm, ""),
) as SetiTheme;

const fileNames = new Map(
  Object.entries(theme.fileNames ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
);
const fileExtensions = new Map(
  Object.entries(theme.fileExtensions ?? {}).map(([k, v]) => [
    k.toLowerCase(),
    v,
  ]),
);
const languageIds = theme.languageIds ?? {};

/** 文件名（小写）→ vscode 语言 id */
const LANG_BY_FILENAME: Record<string, string> = {
  dockerfile: "dockerfile",
  "docker-compose.yml": "dockercompose",
  "docker-compose.yaml": "dockercompose",
  makefile: "makefile",
  ".gitignore": "ignore",
  ".gitattributes": "ignore",
  ".gitmodules": "ignore",
  ".dockerignore": "ignore",
  ".npmignore": "ignore",
  ".eslintignore": "ignore",
  ".prettierignore": "ignore",
  ".env": "dotenv",
};

/** 扩展名（小写）→ vscode 语言 id */
const LANG_BY_EXTENSION: Record<string, string> = {
  ts: "typescript",
  cts: "typescript",
  mts: "typescript",
  tsx: "typescriptreact",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascriptreact",
  json: "json",
  jsonc: "jsonc",
  jsonl: "jsonl",
  md: "markdown",
  mdown: "markdown",
  markdown: "markdown",
  css: "css",
  scss: "scss",
  sass: "sass",
  less: "less",
  styl: "stylus",
  stylus: "stylus",
  html: "html",
  htm: "html",
  py: "python",
  pyw: "python",
  pyi: "python",
  rs: "rust",
  go: "go",
  sh: "shellscript",
  bash: "shellscript",
  zsh: "shellscript",
  ksh: "shellscript",
  yml: "yaml",
  yaml: "yaml",
  xml: "xml",
  xsl: "xml",
  xslt: "xml",
  c: "c",
  h: "cpp",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  hh: "cpp",
  hxx: "cpp",
  cs: "csharp",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  swift: "swift",
  lua: "lua",
  php: "php",
  phtml: "php",
  rb: "ruby",
  rake: "ruby",
  gemspec: "ruby",
  sql: "sql",
  r: "r",
  jl: "julia",
  ex: "elixir",
  exs: "elixir",
  elm: "elm",
  hs: "haskell",
  lhs: "haskell",
  fs: "fsharp",
  fsx: "fsharp",
  fsi: "fsharp",
  clj: "clojure",
  cljs: "clojure",
  cljc: "clojure",
  edn: "clojure",
  coffee: "coffeescript",
  dart: "dart",
  ps1: "powershell",
  psm1: "powershell",
  psd1: "powershell",
  bat: "bat",
  cmd: "bat",
  tf: "terraform",
  tfvars: "terraform",
  haml: "haml",
  jinja: "jinja",
  jinja2: "jinja",
  jade: "jade",
  pug: "jade",
  mustache: "mustache",
  hbs: "handlebars",
  handlebars: "handlebars",
  njk: "nunjucks",
  nunjucks: "nunjucks",
  tex: "latex",
  latex: "latex",
};

export interface FileIcon {
  /** 字体字形对应的 Unicode 码位字符 */
  glyph: string;
  color?: string;
}

let fontReady = false;
function ensureFont(): void {
  if (fontReady) return;
  fontReady = true;
  const style = document.createElement("style");
  style.textContent =
    '@font-face{font-family:"seti";src:url("' +
    setiWoffUrl +
    '") format("woff");font-weight:normal;font-style:normal;}';
  document.head.appendChild(style);
}

/** 从最右侧的点向左逐段尝试后缀匹配（与 vscode 文件图标的扩展名匹配一致）。 */
function extMatch(
  name: string,
  lookup: (ext: string) => string | undefined,
): string | undefined {
  for (let i = name.length - 1; i >= 0; i--) {
    if (name.charCodeAt(i) !== 46) continue; // '.'
    const hit = lookup(name.slice(i + 1));
    if (hit) return hit;
  }
  return undefined;
}

export function fileIcon(path: string): FileIcon {
  ensureFont();
  const name = (path.split(/[/\\]/).pop() ?? path).toLowerCase();
  let defId = fileNames.get(name);
  if (!defId) {
    const lang =
      LANG_BY_FILENAME[name] ?? extMatch(name, (ext) => LANG_BY_EXTENSION[ext]);
    defId = (lang ? languageIds[lang] : undefined) || undefined;
  }
  defId ??= extMatch(name, (ext) => fileExtensions.get(ext)) ?? theme.file;
  const def =
    theme.iconDefinitions[defId ?? ""] ??
    theme.iconDefinitions[theme.file ?? ""];
  if (!def) return { glyph: "" };
  return {
    glyph: String.fromCharCode(parseInt(def.fontCharacter.slice(1), 16)),
    color: def.fontColor,
  };
}
