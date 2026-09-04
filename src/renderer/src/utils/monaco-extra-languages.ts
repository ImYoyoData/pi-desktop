import type * as Monaco from "monaco-editor";
import JSON5 from "json5";
import { jsonDefaults } from "monaco-editor/language/json/monaco.contribution";

let registered = false;

/** Register dotenv + json5 languages (highlight, comments, json5 markers). */
export function ensureMonacoExtraLanguages(monaco: typeof Monaco): void {
  if (registered) return;
  registered = true;

  registerDotenv(monaco);
  registerJson5(monaco);
  configureJsonDiagnostics(monaco);
  wireJson5Validation(monaco);
}

function registerDotenv(monaco: typeof Monaco): void {
  monaco.languages.register({ id: "dotenv", extensions: [".env"], aliases: ["Dotenv", "env"] });
  monaco.languages.setLanguageConfiguration("dotenv", {
    comments: { lineComment: "#" },
    autoClosingPairs: [
      { open: '"', close: '"' },
      { open: "'", close: "'" },
    ],
    surroundingPairs: [
      { open: '"', close: '"' },
      { open: "'", close: "'" },
    ],
  });
  monaco.languages.setMonarchTokensProvider("dotenv", {
    tokenizer: {
      root: [
        [/^\s*#.*$/, "comment"],
        [/#.*$/, "comment"],
        [/^\s*export\s+/, "keyword"],
        [/[A-Za-z_][\w.-]*(?=\s*=)/, "type.identifier"],
        [/=/, "delimiter"],
        [/"([^"\\]|\\.)*$/, "string.invalid"],
        [/'([^'\\]|\\.)*$/, "string.invalid"],
        [/"/, "string", "@string_double"],
        [/'/, "string", "@string_single"],
        [/[^#\s].*$/, "string"],
      ],
      string_double: [
        [/[^\\"]+/, "string"],
        [/\\./, "string.escape"],
        [/"/, "string", "@pop"],
      ],
      string_single: [
        [/[^\\']+/, "string"],
        [/\\./, "string.escape"],
        [/'/, "string", "@pop"],
      ],
    },
  });
}

function registerJson5(monaco: typeof Monaco): void {
  monaco.languages.register({
    id: "json5",
    extensions: [".json5", ".jsonc"],
    aliases: ["JSON5", "json5", "JSONC"],
  });
  monaco.languages.setLanguageConfiguration("json5", {
    wordPattern: /(-?\d*\.\d\w*)|([^\\`~!#%^&*()\-=+[{\]}\\|;:'",.<>/?\s]+)/g,
    comments: {
      lineComment: "//",
      blockComment: ["/*", "*/"],
    },
    brackets: [
      ["{", "}"],
      ["[", "]"],
    ],
    autoClosingPairs: [
      { open: "{", close: "}", notIn: ["string"] },
      { open: "[", close: "]", notIn: ["string"] },
      { open: '"', close: '"', notIn: ["string"] },
      { open: "'", close: "'", notIn: ["string"] },
    ],
    surroundingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
    ],
  });
  monaco.languages.setMonarchTokensProvider("json5", {
    defaultToken: "invalid",
    tokenPostfix: ".json5",
    brackets: [
      { open: "{", close: "}", token: "delimiter.bracket" },
      { open: "[", close: "]", token: "delimiter.array" },
    ],
    tokenizer: {
      root: [
        [/[{}\[\]]/, "@brackets"],
        [/[,:]/, "delimiter"],
        [/"([^"\\]|\\.)*$/, "string.invalid"],
        [/'([^'\\]|\\.)*$/, "string.invalid"],
        [/"/, "string", "@string_double"],
        [/'/, "string", "@string_single"],
        [/\/\/.*$/, "comment"],
        [/\/\*/, "comment", "@comment"],
        [/\b(true|false|null|NaN|Infinity)\b/, "keyword"],
        [/[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/, "number"],
        [/[A-Za-z_$][\w$]*/, "type.identifier"],
        [/\s+/, "white"],
      ],
      comment: [
        [/[^\/*]+/, "comment"],
        [/\*\//, "comment", "@pop"],
        [/[\/*]/, "comment"],
      ],
      string_double: [
        [/[^\\"]+/, "string"],
        [/\\./, "string.escape"],
        [/"/, "string", "@pop"],
      ],
      string_single: [
        [/[^\\']+/, "string"],
        [/\\./, "string.escape"],
        [/'/, "string", "@pop"],
      ],
    },
  });
}

function configureJsonDiagnostics(_monaco: typeof Monaco): void {
  jsonDefaults.setDiagnosticsOptions({
    validate: true,
    allowComments: false,
    schemas: [],
    enableSchemaRequest: false,
    schemaValidation: "error",
    comments: "error",
    trailingCommas: "error",
  });
}

function wireJson5Validation(monaco: typeof Monaco): void {
  const OWNER = "json5";

  const validate = (model: Monaco.editor.ITextModel): void => {
    if (model.getLanguageId() !== "json5") {
      monaco.editor.setModelMarkers(model, OWNER, []);
      return;
    }
    const text = model.getValue();
    if (!text.trim()) {
      monaco.editor.setModelMarkers(model, OWNER, []);
      return;
    }
    try {
      JSON5.parse(text);
      monaco.editor.setModelMarkers(model, OWNER, []);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const loc = extractJson5ErrorPosition(message, text);
      monaco.editor.setModelMarkers(model, OWNER, [
        {
          severity: monaco.MarkerSeverity.Error,
          message,
          startLineNumber: loc.line,
          startColumn: loc.column,
          endLineNumber: loc.line,
          endColumn: loc.column + 1,
        },
      ]);
    }
  };

  const attach = (model: Monaco.editor.ITextModel): void => {
    validate(model);
    const subs = [
      model.onDidChangeContent(() => validate(model)),
      model.onDidChangeLanguage(() => validate(model)),
    ];
    model.onWillDispose(() => {
      for (const s of subs) s.dispose();
    });
  };

  for (const model of monaco.editor.getModels()) attach(model);
  monaco.editor.onDidCreateModel(attach);
}

/** Best-effort line/column from JSON5 error text. */
function extractJson5ErrorPosition(
  message: string,
  text: string,
): { line: number; column: number } {
  const atMatch = message.match(/at\s+(\d+):(\d+)/i);
  if (atMatch) {
    return { line: Number(atMatch[1]) || 1, column: Number(atMatch[2]) || 1 };
  }
  const posMatch = message.match(/position\s+(\d+)/i);
  if (posMatch) {
    const offset = Number(posMatch[1]) || 0;
    const before = text.slice(0, offset);
    const lines = before.split(/\n/);
    return {
      line: Math.max(1, lines.length),
      column: Math.max(1, (lines[lines.length - 1]?.length ?? 0) + 1),
    };
  }
  return { line: 1, column: 1 };
}
