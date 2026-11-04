/** js-yaml 未装类型包，只声明主进程用到的两个函数。 */
declare module "js-yaml" {
	export function load(input: string): unknown;
	export function dump(input: unknown, options?: { lineWidth?: number }): string;
}
