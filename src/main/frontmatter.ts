/** 把 frontmatter 的 name 行替换为新名称，缺失时补上。 */
export function withFrontmatterName(content: string, name: string): string {
	return /^name:\s*/m.test(content)
		? content.replace(/^(name:\s*).*$/m, `$1${name}`)
		: `---\nname: ${name}\n---\n\n${content}`;
}
