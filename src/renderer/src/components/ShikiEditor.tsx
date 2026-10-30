import { useEffect, useMemo, useState, type ReactNode } from "react";
import { EditProvider, File as DiffFile, type EditorFactory } from "@pierre/diffs/react";
import type { SupportedLanguages } from "@pierre/diffs";
import { Editor } from "@pierre/diffs/edit";
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
};

const SURFACE_CSS = `:host,[data-file],[data-diff],pre,code{--diffs-bg:transparent!important}`;

const createEditor: EditorFactory<undefined, undefined> = (editorType, options, editStateKey) =>
  new Editor(editorType, options, editStateKey);

function toShikiLanguage(language: string): SupportedLanguages {
  const mapped = LANGUAGE_ALIASES[language] ?? language;
  return (mapped || "text") as SupportedLanguages;
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
      unsafeCSS: SURFACE_CSS,
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
