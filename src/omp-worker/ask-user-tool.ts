import type { AgentToolResult } from "@oh-my-pi/pi-agent-core";
import {
	ASK_USER_HEADER_MAX,
	ASK_USER_MAX_OPTIONS,
	ASK_USER_MAX_QUESTIONS,
	ASK_USER_MIN_OPTIONS,
	ASK_USER_RULES,
	ASK_USER_TOOL_NAME,
	parseAskUserArgs,
	type AskUserQuestion,
} from "../shared/ask-user";
import { rpcToMain } from "./main-rpc";

/**
 * OMP 的 ask_user 工具：向用户提问并等待回答。
 *
 * 问题格式与 pi 侧一致（渲染层的卡片是共用的），但工具本身走 omp 的
 * 自定义工具接口；回答通过 OMP worker 的 RPC 回到主进程。
 */
export type OmpAskUserAnswers = {
	text: string;
	/** 用户随回答附上的图片（base64），作为 image content 交给模型。 */
	images?: { data: string; mimeType: string }[];
};

export type OmpAskUserWaitForAnswers = (
	questions: AskUserQuestion[],
	signal?: AbortSignal,
) => Promise<string | OmpAskUserAnswers>;

function normalizeAnswers(raw: string | OmpAskUserAnswers): OmpAskUserAnswers {
	if (typeof raw === "string") return { text: raw.trim() };
	return { text: raw.text.trim(), images: raw.images ?? [] };
}

async function defaultWaitForAnswers(
	questions: AskUserQuestion[],
	signal?: AbortSignal,
): Promise<string | OmpAskUserAnswers> {
	// 不设自动超时：提问一直等到用户回答或回合被中止。
	const raw = await rpcToMain("desktop.askUser", { questions }, null, signal);

	if (typeof raw === "string") {
		if (!raw.trim()) throw new Error("ask_user: no answers from user");
		return raw;
	}
	const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
	const text = typeof row?.text === "string" ? row.text.trim() : "";
	if (!text) {
		throw new Error("ask_user: no answers from user");
	}
	const images = Array.isArray(row?.images)
		? row.images.filter(
				(img): img is { data: string; mimeType: string } =>
					Boolean(img) &&
					typeof (img as { data?: unknown }).data === "string" &&
					typeof (img as { mimeType?: unknown }).mimeType === "string",
			)
		: [];
	return { text, images };
}

/** 构造 ask_user 工具（OMP 自定义工具形态）。 */
export function createOmpAskUserTool(deps?: {
	waitForAnswers?: OmpAskUserWaitForAnswers;
}) {
	const waitForAnswers = deps?.waitForAnswers ?? defaultWaitForAnswers;
	return {
		name: ASK_USER_TOOL_NAME,
		label: "Ask user",
		description:
			'Ask the user 1-3 short questions and wait for the response. Each question takes 2-3 mutually exclusive options; the client adds a free-form "None of the above" choice. The user may skip any skippable question.',
		loadMode: "essential" as const,
		parameters: {
			type: "object",
			properties: {
				questions: {
					type: "array",
					minItems: 1,
					maxItems: ASK_USER_MAX_QUESTIONS,
					description:
						"Questions to show the user. Prefer 1 and do not exceed 3.",
					items: {
						type: "object",
						properties: {
							id: {
								type: "string",
								description:
									"Stable identifier for mapping answers (snake_case).",
							},
							header: {
								type: "string",
								maxLength: ASK_USER_HEADER_MAX,
								description:
									"Short header label shown in the UI (12 or fewer chars). It is the tab label users pick questions by.",
							},
							prompt: {
								type: "string",
								description:
									"Single-sentence question shown to the user.",
							},
							type: {
								type: "string",
								enum: ["single", "multi", "buttons"],
								description:
									"single = pick one option; multi = pick several; buttons = one-click choices.",
							},
							options: {
								type: "array",
								minItems: ASK_USER_MIN_OPTIONS,
								maxItems: ASK_USER_MAX_OPTIONS,
								description:
									'Provide 2-3 mutually exclusive choices. Put the recommended option first and suffix its label with "(Recommended)". Do not include an "Other" option in this list; the client adds a free-form "None of the above" option automatically.',
								items: {
									type: "object",
									properties: {
										id: { type: "string" },
										label: {
											type: "string",
											description: "User-facing label (1-5 words).",
										},
										description: {
											type: "string",
											description:
												"One short sentence explaining impact/tradeoff if selected (renders under the label).",
										},
										allowCustom: {
											type: "boolean",
											description:
												"If true, selecting this option lets the user add extra detail in the answer box.",
										},
									},
									required: ["id", "label"],
								},
							},
							skippable: {
								type: "boolean",
								description:
									"Whether the user may skip this question. Omitted = skippable. Set false only for hard requirements (e.g. a confirm/reject gate) — otherwise users can and often will skip.",
							},
							isSecret: {
								type: "boolean",
								description:
									"Mask this question's free-text answer in the UI (passwords, tokens, keys). The answer still reaches the tool result.",
							},
						},
						required: ["id", "header", "prompt", "type", "options"],
					},
				},
			},
			required: ["questions"],
		},
		async execute(
			_toolCallId: string,
			params: unknown,
			_onUpdate: unknown,
			_ctx: unknown,
			signal: AbortSignal | undefined,
		): Promise<AgentToolResult<unknown>> {
			const parsed = parseAskUserArgs(params);
			if (!parsed) {
				throw new Error(
					"ask_user: need 1-3 questions, each with a unique id, a header (<=12 chars), a prompt, and 2-3 options",
				);
			}
			const answers = normalizeAnswers(
				await waitForAnswers(parsed.questions, signal),
			);
			if (!answers.text) {
				throw new Error("ask_user: no answers from user");
			}
			return {
				content: [
					{ type: "text" as const, text: answers.text },
					...(answers.images ?? []).map((img) => ({
						type: "image" as const,
						data: img.data,
						mimeType: img.mimeType,
					})),
				],
				details: {},
			};
		},
	};
}

export const OMP_ASK_USER_RULES: readonly string[] = ASK_USER_RULES;
