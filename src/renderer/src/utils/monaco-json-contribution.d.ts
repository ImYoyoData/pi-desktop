declare module "monaco-editor/language/json/monaco.contribution" {
  export const jsonDefaults: {
    setDiagnosticsOptions(options: {
      validate?: boolean;
      allowComments?: boolean;
      schemas?: unknown[];
      enableSchemaRequest?: boolean;
      schemaValidation?: "error" | "warning" | "ignore";
      comments?: "error" | "warning" | "ignore";
      trailingCommas?: "error" | "warning" | "ignore";
    }): void;
  };
}
