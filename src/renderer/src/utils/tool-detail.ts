/** 详情卡入口：按工具名分发到各 family 的适配器。 */

import { isPathListTool } from "./structured-text";
import { astEditCard, astGrepCard, pathListCard } from "./tool-detail-files";
import { codemodeCard, browserCard, computerCard, mcpCard, toolSearchCard } from "./tool-detail-extensions";
import {
  learnCard,
  manageSkillCard,
  memoryEditCard,
  queryMemoryCard,
  retainCard,
  webSearchCard,
} from "./tool-detail-knowledge";
import { askCard, debugCard, evalCard, idaCard, taskCard } from "./tool-detail-runtime";
import {
  checkpointCard,
  contextNotesCard,
  githubCard,
  lspCard,
  newContextCard,
  rewindCard,
  securityScanCard,
} from "./tool-detail-session";
import type { DetailParseOptions, DetailResultParts, DetailToolCard } from "./tool-detail-types";

export type {
  DetailChip,
  DetailCountUnit,
  DetailFlag,
  DetailItem,
  DetailLink,
  DetailMatchFile,
  DetailMatchLine,
  DetailParseOptions,
  DetailResultParts,
  DetailSection,
  DetailToolCard,
  DetailLabel,
} from "./tool-detail-types";

export function parseDetailTool(
  toolName: string,
  args: unknown,
  parts: DetailResultParts,
  opts: DetailParseOptions = {},
): DetailToolCard | null {
  const name = toolName.toLowerCase();
  switch (name) {
    case "find":
    case "glob":
    case "ls":
      return pathListCard(name, args, parts, opts);
    case "ast_grep":
      return astGrepCard(args, parts, opts);
    case "ast_edit":
      return astEditCard(args, parts, opts);
    case "eval":
      return evalCard(args, parts, opts);
    case "task":
      return taskCard(args, parts, opts);
    case "ask":
      return askCard(args, parts, opts);
    case "debug":
      return debugCard(args, parts, opts);
    case "ida":
      return idaCard(args, parts, opts);
    case "github":
      return githubCard(args, parts, opts);
    case "lsp":
      return lspCard(args, parts, opts);
    case "checkpoint":
      return checkpointCard(args, parts, opts);
    case "rewind":
      return rewindCard(args, parts, opts);
    case "context_notes":
      return contextNotesCard(args, parts, opts);
    case "new_context":
      return newContextCard(args, parts, opts);
    case "security_scan":
      return securityScanCard(args, parts, opts);
    case "web_search":
      return webSearchCard(args, parts, opts);
    case "retain":
      return retainCard(args, parts, opts);
    case "recall":
    case "reflect":
      return queryMemoryCard(name, args, parts, opts);
    case "memory_edit":
      return memoryEditCard(args, parts, opts);
    case "learn":
      return learnCard(args, parts, opts);
    case "manage_skill":
      return manageSkillCard(args, parts, opts);
    case "codemode":
      return codemodeCard(args, parts, opts);
    case "tool_search":
      return toolSearchCard(args, parts, opts);
    case "computer":
      return computerCard(args, parts, opts);
    default:
      break;
  }
  if (name.startsWith("browser_")) return browserCard(name, args, parts, opts);
  if (name.startsWith("mcp__")) return mcpCard(name, args, parts, opts);
  if (isPathListTool(name)) return pathListCard(name, args, parts, opts);
  return null;
}
