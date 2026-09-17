/** 把 frontmatter 的 name 行替换为新名称，缺失时补上。 */
export function withFrontmatterName(content: string, name: string): string {
	return /^name:[ \t]*/m.test(content)
		? content.replace(/^(name:[ \t]*).*$/m, `$1${name}`)
		: `---\nname: ${name}\n---\n\n${content}`;
}

/** 读取 frontmatter 文本字段：YAML 会把纯数字/布尔解析成非字符串，统一转成字符串。 */
export function frontmatterText(value: unknown): string {
	if (typeof value === "string") return value.trim();
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	return "";
}
