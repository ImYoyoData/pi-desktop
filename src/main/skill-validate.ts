import type { SkillIssueCode, SkillWarningCode } from "../shared/customizations";

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

/** 保存前校验：返回全部规范问题，供 UI 逐条给出正确写法。 */
export function validateSkillMeta(name: string, description: string): SkillIssueCode[] {
	const issues: SkillIssueCode[] = [];
	if (!name) issues.push("name-required");
	else if (name.length > SKILL_NAME_MAX) issues.push("name-too-long");
	else if (!SKILL_NAME_PATTERN.test(name)) issues.push("name-invalid");
	if (!description) issues.push("description-required");
	else if (description.length > SKILL_DESCRIPTION_MAX) issues.push("description-too-long");
	return issues;
}
