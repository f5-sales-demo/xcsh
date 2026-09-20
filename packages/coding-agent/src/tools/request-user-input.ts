import type { AgentTool, AgentToolResult } from "@f5-sales-demo/pi-agent-core";
import { type Static, Type } from "@sinclair/typebox";
import type { AsyncInputQuestion } from "../../../chat-ui/src/interactions/contract";
import asyncDescription from "../prompts/tools/request-user-input-async.md" with { type: "text" };
import type { ToolSession } from ".";
import { ToolAbortError, ToolError } from "./tool-errors";

// Field text and strictness are pinned to Codex request_user_input_spec.rs.
export const requestUserInputSchema = Type.Object(
	{
		questions: Type.Array(
			Type.Object(
				{
					id: Type.String({ description: "Stable identifier for mapping answers (snake_case)." }),
					header: Type.String({ description: "Short header label shown in the UI (12 or fewer chars)." }),
					question: Type.String({ description: "Single-sentence prompt shown to the user." }),
					options: Type.Array(
						Type.Object(
							{
								label: Type.String({ description: "User-facing label (1-5 words)." }),
								description: Type.String({
									description: "One short sentence explaining impact/tradeoff if selected.",
								}),
							},
							{ additionalProperties: false },
						),
						{
							description:
								'Provide 2-3 mutually exclusive choices. Put the recommended option first and suffix its label with "(Recommended)". Do not include an "Other" option in this list; the client will add a free-form "Other" option automatically.',
						},
					),
				},
				{ additionalProperties: false },
			),
			{ description: "Questions to show the user. Prefer 1 and do not exceed 3" },
		),
	},
	{ additionalProperties: false },
);

export const requestUserInputAsyncSchema = Type.Object(
	{
		questions: Type.Array(
			Type.Object(
				{
					title: Type.String({
						description: "The complete question shown to the user, including any context needed to answer it.",
					}),
					options: Type.Optional(
						Type.Array(Type.String(), {
							minItems: 1,
							description:
								"Suggested answers, in display order. Put the recommended answer first; the first option is preselected by default. The user can select one option or enter a free-text answer. Do not include an Other option or a free-text placeholder; the UI provides free-text input automatically. Omit options for a free-text-only question.",
						}),
					),
				},
				{ additionalProperties: false },
			),
			{ minItems: 1, description: "One or more self-contained questions to present together, in display order." },
		),
	},
	{ additionalProperties: false },
);

export class RequestUserInputTool implements AgentTool<typeof requestUserInputSchema> {
	readonly name = "request_user_input";
	readonly label = "Request user input";
	readonly strict = false;
	readonly parameters = requestUserInputSchema;
	get description(): string {
		return `Request user input for one to three short questions and wait for the response. This tool is only available in ${this.session.settings.get("interactions.waitingInDefault") ? "Plan or Default mode" : "Plan mode"}.`;
	}
	constructor(private readonly session: ToolSession) {}
	async execute(
		callId: string,
		args: Static<typeof requestUserInputSchema>,
		signal?: AbortSignal,
	): Promise<AgentToolResult> {
		if (!this.session.getPlanModeState?.()?.enabled && !this.session.settings.get("interactions.waitingInDefault"))
			throw new ToolError("request_user_input is unavailable in Default mode");
		if (args.questions.some(question => !question.options?.length))
			throw new ToolError("request_user_input requires non-empty options for every question");
		const owner = this.session.getUserInteractions?.();
		if (!owner) throw new ToolError("Session interaction owner unavailable");
		const response = await owner.requestInput(
			{
				title: "Questions",
				toolCallId: callId,
				identity: this.session.getInteractionIdentity?.(callId),
				inputQuestions: args.questions.map(question => ({ ...question, isOther: true, isSecret: false })),
			},
			signal,
		);
		if (response === undefined) throw new ToolAbortError("User input interrupted");
		return { content: [{ type: "text", text: JSON.stringify(response) }], details: {} };
	}
}

export class RequestUserInputAsyncTool implements AgentTool<typeof requestUserInputAsyncSchema> {
	readonly name = "request_user_input_async";
	readonly label = "Ask asynchronously";
	readonly description = asyncDescription.trim();
	readonly strict = false;
	readonly parameters = requestUserInputAsyncSchema;
	constructor(private readonly session: ToolSession) {}
	async execute(callId: string, args: Static<typeof requestUserInputAsyncSchema>): Promise<AgentToolResult> {
		if (!args.questions.length) throw new ToolError("questions must not be empty");
		for (const question of args.questions) {
			if (!question.title.trim()) throw new ToolError("question titles must not be empty");
			if (question.options && (!question.options.length || question.options.some(option => !option.trim())))
				throw new ToolError("options must contain at least one non-empty answer");
		}
		const owner = this.session.getUserInteractions?.();
		if (!owner) throw new ToolError("Session interaction owner unavailable");
		const identity = this.session.getInteractionIdentity?.(callId);
		const questionIds = args.questions.map((_, index) => `${callId}:${index}`);
		const pending = owner.requestAsyncBatch(
			args.questions.map((question, index) => ({
				kind: "input",
				delivery: "async",
				questionId: questionIds[index],
				title: question.title,
				options: question.options,
				toolCallId: callId,
				identity,
			})),
		);
		for (const [index, result] of pending.entries()) {
			void result
				.then(answer => {
					const current = this.session.getInteractionIdentity?.(callId);
					if (
						answer !== undefined &&
						(!identity ||
							(current?.sessionId === identity.sessionId && current.generation === identity.generation))
					)
						return this.session.deliverAsyncAnswer?.(callId, questionIds[index], answer);
				})
				.catch(error => this.session.reportInteractionFailure?.(callId, error));
		}
		this.session.publishAsyncQuestions?.(callId, args.questions as AsyncInputQuestion[], questionIds);
		return { content: [{ type: "text", text: '{"accepted":true}' }], details: {} };
	}
}
