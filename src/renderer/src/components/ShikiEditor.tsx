import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  EditProvider,
  File as DiffFile,
  WorkerPoolContextProvider,
  type EditorFactory,
} from "@pierre/diffs/react";
import type { SupportedLanguages } from "@pierre/diffs";
import { Editor } from "@pierre/diffs/edit";
import DiffsWorker from "@pierre/diffs/worker/worker-portable.js?worker&inline";
import { useAppearanceStore } from "@renderer/stores/appearance";

type Props = {
  name: string;
  value: string;
  language: string;
  onChange: (value: string) => void;
  className?: string;
};

/** 文件语言 id → shiki 语言名（同名直接沿用）。 */
const LANGUAGE_ALIASES: Record<string, string> = {
  json5: "json",
  dotenv: "ini",
  // @pierre/diffs 只把 "text"/"ansi" 当纯文本，plaintext 会抛 resolveLanguage 错误。
  plaintext: "text",
  plain: "text",
  txt: "text",
};

// 编辑器底色由外层容器提供，内容区因此透明。
// 查找面板是浮层：用主题浮层色实底，与下拉菜单/设置页一致，不用透明度。
// 壁纸模式下 --bg-elevated/--bg-input 是半透明玻璃，故优先取 --w-solid-* 实色。
// 浮层内不用 backdrop-filter：.right-pane 的 transform/backdrop-filter 会建 backdrop root，模糊取不到背景。
// diffs 的 :host 自带 color-scheme:light dark，light-dark() 会按系统偏好取值而不是应用主题，这里钉死。
const PANEL_SURFACE = "var(--w-solid-elevated,var(--bg-elevated,#202122))";
const INPUT_SURFACE = "var(--w-solid-bg,var(--bg-input,#1a1a19))";

function surfaceCss(theme: "light" | "dark"): string {
  return `:host{color-scheme:${theme}}:host,[data-file],[data-diff],pre,code{--diffs-bg:transparent!important}` +
    `[data-search-panel]{--diffs-bg:${INPUT_SURFACE}!important}` +
    `[data-search-panel] [data-editor-widget]{background-color:${PANEL_SURFACE}}`;
}

const createEditor: EditorFactory<undefined, undefined> = (editorType, options, editStateKey) =>
  new Editor(editorType, options, editStateKey);

function toShikiLanguage(language: string): SupportedLanguages {
  const mapped = LANGUAGE_ALIASES[language] ?? language;
  return (mapped || "text") as SupportedLanguages;
}

/**
 * 文件预览的高亮 worker 池：shiki tokenize 在主线程会卡住界面，
 * 大文件切换时尤其明显。worker 打包进内联 blob，file:// 下也能启动。
 */
const HIGHLIGHT_POOL = {
  poolOptions: { workerFactory: () => new DiffsWorker(), poolSize: 2 },
  highlighterOptions: {},
};

/** 池要跨编辑器卸载存活，所以由页面层（文件页 / 智能体设置页）持有。 */
export function HighlightWorkerPool({ children }: { children: ReactNode }): ReactNode {
  return (
    <WorkerPoolContextProvider {...HIGHLIGHT_POOL}>{children}</WorkerPoolContextProvider>
  );
}

/** 可编辑的 shiki 编辑器：@pierre/diffs 的 File 编辑模式，与 codex 同款。 */
export function ShikiEditor({ name, value, language, onChange, className }: Props): ReactNode {
  const theme = useAppearanceStore((state) => state.resolvedTheme);
  const shikiLanguage = toShikiLanguage(language);
  const [file, setFile] = useState(() => ({
    name,
    contents: value,
    lang: shikiLanguage,
  }));

  useEffect(() => {
    setFile((current) =>
      current.name === name && current.contents === value && current.lang === shikiLanguage
        ? current
        : { name, contents: value, lang: shikiLanguage },
    );
  }, [name, value, shikiLanguage]);

  const options = useMemo(
    () => ({
      themeType: theme === "dark" ? ("dark" as const) : ("light" as const),
      disableFileHeader: true,
      overflow: "wrap" as const,
      unsafeCSS: surfaceCss(theme === "dark" ? "dark" : "light"),
    }),
    [theme],
  );

  return (
    <EditProvider createEditor={createEditor}>
      <DiffFile
        className={className}
        file={file}
        options={options}
        edit
        editStateKey={`${name}:${shikiLanguage}`}
        onEditChange={(event) => onChange(event.file.contents)}
      />
    </EditProvider>
  );
}

export default ShikiEditor;
