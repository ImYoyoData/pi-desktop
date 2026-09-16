import type { SkillWarningCode } from "../shared/customizations";

/** 技能名称规范：小写字母、数字与连字符，首尾无连字符、无连续连字符。 */
export const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const SKILL_NAME_MAX = 64;
const SKILL_DESCRIPTION_MAX = 1024;

/** 技能规范校验（与 pi 的 Agent Skills 校验一致），返回首个问题 code。 */
export function skillWarningOf(name: string, description: string): SkillWarningCode | undefined {
	if (!description) return "missing-description";
	if (description.length > SKILL_DESCRIPTION_MAX) return "description-too-long";
	if (!name || name.length > SKILL_NAME_MAX || !SKILL_NAME_PATTERN.test(name)) return "invalid-name";
	return undefined;
}
