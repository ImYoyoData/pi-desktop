import type * as Monaco from "monaco-editor";
import { resolveMonacoNls, type MonacoNlsId } from "@renderer/i18n/locale";

let monacoPromise: Promise<typeof Monaco> | null = null;

/**
 * monaco-editor package exports map `monaco-editor/<path>` → `esm/vs/<path>`.
 * So nls packs are imported as `monaco-editor/nls/lang/<id>.js`.
 */
async function loadNlsPack(id: MonacoNlsId): Promise<void> {
  switch (id) {
    case "zh-cn":
      await import("monaco-editor/nls/lang/zh-cn.js");
      break;
    case "zh-tw":
      await import("monaco-editor/nls/lang/zh-tw.js");
      break;
    case "ja":
      await import("monaco-editor/nls/lang/ja.js");
      break;
    case "ko":
      await import("monaco-editor/nls/lang/ko.js");
      break;
    case "de":
      await import("monaco-editor/nls/lang/de.js");
      break;
    case "fr":
      await import("monaco-editor/nls/lang/fr.js");
      break;
    case "es":
      await import("monaco-editor/nls/lang/es.js");
      break;
    case "ru":
      await import("monaco-editor/nls/lang/ru.js");
      break;
    case "it":
      await import("monaco-editor/nls/lang/it.js");
      break;
    case "pt-br":
      await import("monaco-editor/nls/lang/pt-br.js");
      break;
    case "tr":
      await import("monaco-editor/nls/lang/tr.js");
      break;
    case "pl":
      await import("monaco-editor/nls/lang/pl.js");
      break;
    case "cs":
      await import("monaco-editor/nls/lang/cs.js");
      break;
    default: {
      const _exhaustive: never = id;
      void _exhaustive;
      break;
    }
  }
}

/**
 * Load Monaco after applying system-locale nls (if available).
 * Must run before any other monaco import so messages stick.
 */
export function loadMonaco(): Promise<typeof Monaco> {
  if (!monacoPromise) {
    monacoPromise = (async () => {
      const nls = resolveMonacoNls();
      if (nls) await loadNlsPack(nls);
      return import("monaco-editor");
    })();
  }
  return monacoPromise;
}
