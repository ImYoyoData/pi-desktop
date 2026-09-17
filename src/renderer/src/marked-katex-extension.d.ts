/**
 * marked-katex-extension 把类型入口指向自己的 .ts 源码，会被本项目 tsconfig
 * 连带检查并报错（TS7030 / TS6133）。这里按包的公开 API 提供类型，
 * 由 tsconfig.web.json 的 paths 接管该模块的解析。
 */
import type { KatexOptions } from "katex";
import type { MarkedExtension } from "marked";

export interface MarkedKatexOptions extends KatexOptions {
  nonStandard?: boolean;
}

export default function markedKatex(options?: MarkedKatexOptions): MarkedExtension;
