export type GitStatusCode = "M" | "A" | "D" | "R" | "U" | "C";

/** language id for monaco from file path */
export function languageFromPath(filePath: string): string {
  const name = filePath.split(/[/\\]/).pop()?.toLowerCase() ?? "";
  // .env, .env.local, .env.development, foo.env
  if (name === ".env" || name.startsWith(".env.") || name.endsWith(".env")) {
    return "dotenv";
  }
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
  switch (ext) {
    case ".ts":
      return "typescript";
    case ".tsx":
      return "typescript";
    case ".js":
    case ".mjs":
    case ".cjs":
      return "javascript";
    case ".jsx":
      return "javascript";
    case ".json":
      return "json";
    case ".json5":
    case ".jsonc":
      return "json5";
    case ".vue":
      return "html";
    case ".css":
      return "css";
    case ".scss":
      return "scss";
    case ".less":
      return "less";
    case ".html":
    case ".htm":
      return "html";
    case ".md":
    case ".markdown":
    case ".mdx":
      return "markdown";
    case ".py":
      return "python";
    case ".go":
      return "go";
    case ".rs":
      return "rust";
    case ".java":
      return "java";
    case ".kt":
      return "kotlin";
    case ".cs":
      return "csharp";
    case ".cpp":
    case ".cc":
    case ".cxx":
      return "cpp";
    case ".c":
    case ".h":
      return "c";
    case ".sql":
      return "sql";
    case ".sh":
    case ".bash":
    case ".zsh":
      return "shell";
    case ".ps1":
      return "powershell";
    case ".yaml":
    case ".yml":
      return "yaml";
    case ".xml":
    case ".svg":
      return "xml";
    case ".toml":
      return "ini";
    default:
      return "plaintext";
  }
}

export function gitCodeColor(code: string): string {
  switch (code as GitStatusCode) {
    case "M":
      return "var(--git-m)";
    case "A":
      return "var(--git-a)";
    case "U":
      return "var(--git-u)";
    case "D":
      return "var(--git-d)";
    case "R":
      return "var(--git-r)";
    case "C":
      return "var(--accent)";
    default:
      return "var(--fg-faint)";
  }
}

export function breadcrumbs(filePath: string): string[] {
  return filePath.replace(/\\/g, "/").split("/").filter(Boolean);
}
