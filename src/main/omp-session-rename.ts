import fs from "node:fs";

/** omp 的 title slot：固定 256 字节（含换行）的首行，用于改会话标题。 */
const TITLE_SLOT_BYTES = 256;

type TitleSource = "auto" | "user";

function slotLine(
	title: string,
	source: TitleSource,
	updatedAt: string,
	pad: string,
): string {
	return `${JSON.stringify({ type: "title", v: 1, title, source, updatedAt, pad })}\n`;
}

/** 标题过长时按码点截断，保证整行不超过固定槽位。 */
function truncateTitle(
	title: string,
	source: TitleSource,
	updatedAt: string,
): string {
	const codePoints = [...title];
	let low = 0;
	let high = codePoints.length;
	let best = "";
	while (low <= high) {
		const mid = (low + high) >>> 1;
		const candidate = codePoints.slice(0, mid).join("");
		if (Buffer.byteLength(slotLine(candidate, source, updatedAt, ""), "utf8") <= TITLE_SLOT_BYTES) {
			best = candidate;
			low = mid + 1;
		} else {
			high = mid - 1;
		}
	}
	return best;
}

/** 与 omp 的 serializeTitleSlot 等价：256 字节定长行。 */
export function serializeOmpTitleSlot(title: string, source: TitleSource): string {
	const updatedAt = new Date().toISOString();
	const trimmed = truncateTitle(title, source, updatedAt);
	const unpadded = slotLine(trimmed, source, updatedAt, "");
	const padBytes = TITLE_SLOT_BYTES - Buffer.byteLength(unpadded, "utf8");
	return slotLine(trimmed, source, updatedAt, " ".repeat(Math.max(0, padBytes)));
}

function isTitleSlotLine(line: string): boolean {
	try {
		const parsed = JSON.parse(line) as { type?: unknown; v?: unknown };
		return parsed.type === "title" && parsed.v === 1;
	} catch {
		return false;
	}
}

/** 重命名 omp 会话：覆盖首行 title slot，没有就补一行。 */
export async function renameOmpSessionFile(
	filePath: string,
	name: string,
): Promise<void> {
	const raw = await fs.promises.readFile(filePath, "utf8");
	const slot = serializeOmpTitleSlot(name.trim(), "user");
	const newline = raw.indexOf("\n");
	const firstLine = newline < 0 ? raw : raw.slice(0, newline);
	const rest = newline < 0 ? "" : raw.slice(newline + 1);
	const body = isTitleSlotLine(firstLine) ? rest : raw;
	await fs.promises.writeFile(filePath, slot + body, "utf8");
}
