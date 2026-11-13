/** 详情卡的数据契约：纯类型模块，不能依赖 i18n 或渲染层，避免类型环。 */

export type DetailCountUnit =
  | "matches"
  | "files"
  | "searched"
  | "replacements"
  | "findings"
  | "items"
  | "agents"
  | "sources"
  | "questions"
  | "tools"
  | "bytes";

export type DetailChip =
  | { kind: "text"; text: string }
  | { kind: "count"; unit: DetailCountUnit; value: number };

export type DetailFlag =
  | "applied"
  | "preview"
  | "limit"
  | "ok"
  | "failed"
  | "cancelled"
  | "timedOut"
  | "requested"
  | "read"
  | "write"
  | "clear"
  | "rewound"
  | "truncated"
  | "noMatches";

export type DetailLabel =
  | "output"
  | "code"
  | "input"
  | "paths"
  | "matches"
  | "sources"
  | "answer"
  | "questions"
  | "report"
  | "notes"
  | "goal"
  | "memory"
  | "skill"
  | "result"
  | "details"
  | "tasks";

export type DetailMatchLine = {
  line: number | null;
  text: string;
  match: boolean;
};

export type DetailMatchFile = {
  path: string;
  lines: DetailMatchLine[];
};

export type DetailItem = {
  title: string;
  subtitle?: string | null;
  body?: string | null;
  tone?: "ok" | "error" | "muted";
};

export type DetailLink = {
  title: string;
  url: string;
  snippet?: string | null;
  meta?: string | null;
};

export type DetailSection =
  | { kind: "text"; label: DetailLabel | null; title?: string; text: string }
  | { kind: "code"; label: DetailLabel | null; title?: string; code: string; lang: string }
  | { kind: "paths"; label: DetailLabel | null; items: string[]; notices: string[] }
  | {
      kind: "matches";
      label: DetailLabel | null;
      files: DetailMatchFile[];
      notices: string[];
    }
  | {
      kind: "diffs";
      label: DetailLabel | null;
      files: Array<{ path: string; diff: string }>;
    }
  | { kind: "links"; label: DetailLabel | null; items: DetailLink[] }
  | { kind: "items"; label: DetailLabel | null; items: DetailItem[] }
  | { kind: "json"; label: DetailLabel | null; value: unknown };

export type DetailToolCard = {
  kind: "detail";
  /** OMP 工具名：决定图标与卡片身份。 */
  tool: string;
  /** 主目标：路径 / 模式 / 查询 / 命令 / URL。 */
  target: string | null;
  /** 折叠行的次要摘要。 */
  summary: string | null;
  chips: DetailChip[];
  flags: DetailFlag[];
  sections: DetailSection[];
  /** task 结果里的子代理对话入口；异步 spawn 的行来自 details.progress。 */
  transcripts: Array<{
    agentId: string;
    label: string;
    status?: "running" | "completed" | "failed" | "cancelled";
    model?: string | null;
    durationMs?: number;
  }>;
  images: string[];
  args: unknown;
  durationMs?: number | null;
};

export type DetailResultParts = {
  details: Record<string, unknown> | null;
  text: string;
  images: string[];
  structured: unknown | null;
};

export type DetailParseOptions = {
  isError?: boolean;
  durationMs?: number;
};
