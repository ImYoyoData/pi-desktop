/** 路径比较键：统一分隔符、去掉结尾分隔符，根目录保留。 */
export function workspacePathKey(input: string): string {
	const unified = input.trim().replace(/\\/g, "/");
	const trimmed = unified.replace(/\/+$/, "");
	if (trimmed) return trimmed;
	return unified.startsWith("/") ? "/" : trimmed;
}

/** 两个路径是否指向同一目录；Windows/macOS 的路径大小写不敏感。 */
export function workspacePathsEqual(a: string, b: string, caseInsensitive = false): boolean {
	const left = workspacePathKey(a);
	const right = workspacePathKey(b);
	return caseInsensitive ? left.toLowerCase() === right.toLowerCase() : left === right;
}
