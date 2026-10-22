/**
 * 用户气泡的展示态 —— 一次算完，行内渲染与置顶预览共用。
 *
 * 之前模板里每行要重复调 displayUserText ×5、visibleUserTags ×4、
 * userCardNeedsToggle ×3；这里收成一次，保证同一份逻辑只有一个来源。
 */

import { isLegacyModeTagKind, stripInjectedBlocks } from "../../../shared/injected-blocks";
import type { UserMessage } from "./message-rows";

export type UserTag = NonNullable<UserMessage["elementTags"]>[number];

export type UserRowView = {
  /** 去掉开头注入块后的正文。 */
  text: string;
  /** 去掉旧版模式标记后的可见标签。 */
  tags: UserTag[];
  /** 长卡片需要折叠开关：正文、图、标签任一过多时折叠显示。 */
  needsToggle: boolean;
};

const TOGGLE_TEXT_LEN = 140;
const TOGGLE_IMG_COUNT = 2;
const TOGGLE_TAG_COUNT = 4;

export function buildUserRowView(msg: UserMessage): UserRowView {
  const text = stripInjectedBlocks(msg.text);
  const tags = (msg.elementTags ?? []).filter((tag) => !isLegacyModeTagKind(tag.kind));
  return {
    text,
    tags,
    needsToggle:
      text.length > TOGGLE_TEXT_LEN ||
      (msg.images?.length ?? 0) > TOGGLE_IMG_COUNT ||
      tags.length > TOGGLE_TAG_COUNT,
  };
}