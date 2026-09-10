/**
 * Ask Tool - Interactive user prompting during execution
 *
 * Use this tool when you need to ask the user questions during execution.
 * This allows you to:
 *   1. Gather user preferences or requirements
 *   2. Clarify ambiguous instructions
 *   3. Get decisions on implementation choices as you work
 *   4. Offer choices to the user about what direction to take
 *
 * Usage notes:
 *   - Users will always be able to select "Other" to provide custom text input
 *   - Use multi: true to allow multiple answers to be selected for a question
 *   - Use recommended: <index> to mark the default option; "(Recommended)" suffix is added automatically
 *   - Questions may time out and auto-select the recommended option (configurable, disabled in plan mode)
 */

import type {
	AgentTool,
	AgentToolContext,
	AgentToolResult,
	AgentToolUpdateCallback,
} from "@f5-sales-demo/pi-agent-core";
import { type Component, Container, Markdown, renderInlineMarkdown, TERMINAL, Text } from "@f5-sales-demo/pi-tui";
import { prompt } from "@f5-sales-demo/pi-utils";
import { type Static, Type } from "@sinclair/typebox";
import type { RenderResultOptions } from "../extensibility/custom-tools/types";
import { runQuestionGroup } from "../modes/components/question-flow";
import { getMarkdownTheme, type Theme } from "../modes/theme/theme";
import askDescription from "../prompts/tools/ask.md" with { type: "text" };
import { type QuestionAnswers, validQuestionAnswers, validQuestionGroup } from "../session/question-types";
import { renderStatusLine } from "../tui";
import type { ToolSession } from ".";
import { formatErrorMessage, formatMeta, formatTitle } from "./render-utils";
import { ToolAbortError, ToolError } from "./tool-errors";

// =============================================================================
// Types
// =============================================================================

const OptionItem = Type.Object({
	label: Type.String({ description: "Display label" }),
});

const QuestionItem = Type.Object({
	id: Type.String({ description: "Question ID, e.g. 'auth', 'cache'" }),
	question: Type.String({ description: "Question text" }),
	options: Type.Array(OptionItem, { description: "Available options" }),
	multi: Type.Optional(Type.Boolean({ description: "Allow multiple selections" })),
	recommended: Type.Optional(Type.Number({ description: "Index of recommended option (0-indexed)" })),
});

const askSchema = Type.Object({
	questions: Type.Array(QuestionItem, { description: "Questions to ask", minItems: 1 }),
});

export type AskToolInput = Static<typeof askSchema>;

/** Result for a single question */
export interface QuestionResult {
	id: string;
	question: string;
	options: string[];
	multi: boolean;
	selectedOptions: string[];
	customInput?: string;
}

export interface AskToolDetails {
	question?: string;
	options?: string[];
	multi?: boolean;
	selectedOptions?: string[];
	customInput?: string;
	/** Multi-part question mode */
	results?: QuestionResult[];
}

// =============================================================================
// Constants
// =============================================================================

function formatQuestionResult(result: QuestionResult): string {
	if (result.customInput !== undefined) {
		return `${result.id}: "${result.customInput}"`;
	}
	if (result.selectedOptions.length > 0) {
		return result.multi
			? `${result.id}: [${result.selectedOptions.join(", ")}]`
			: `${result.id}: ${result.selectedOptions[0]}`;
	}
	return `${result.id}: (cancelled)`;
}

// =============================================================================
// Tool Class
// =============================================================================

type AskParams = AskToolInput;

/**
 * Ask tool for interactive user prompting during execution.
 *
 * Allows gathering user preferences, clarifying instructions, and getting decisions
 * on implementation choices as the agent works.
 */
export class AskTool implements AgentTool<typeof askSchema, AskToolDetails> {
	readonly name = "ask";
	readonly label = "Ask";
	readonly description: string;
	readonly parameters = askSchema;
	readonly strict = true;

	constructor(private readonly session: ToolSession) {
		this.description = prompt.render(askDescription);
	}

	static createIf(session: ToolSession): AskTool | null {
		return session.hasUI ? new AskTool(session) : null;
	}

	/** Send terminal notification when ask tool is waiting for input */
	#sendAskNotification(): void {
		const method = this.session.settings.get("ask.notify");
		if (method === "off") return;
		TERMINAL.sendNotification({ title: "xcsh", body: "Waiting for input", type: "ask" });
	}

	async execute(
		_toolCallId: string,
		params: AskParams,
		signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<AskToolDetails>,
		context?: AgentToolContext,
	): Promise<AgentToolResult<AskToolDetails>> {
		// Headless fallback
		if (!context?.hasUI || !context.ui) {
			return {
				content: [{ type: "text" as const, text: "Error: User prompt requires interactive mode" }],
				details: {},
				isWarning: true,
			};
		}

		const extensionUi = context.ui;

		// Determine timeout based on settings and plan mode
		const planModeEnabled = this.session.getPlanModeState?.()?.enabled ?? false;
		// Settings.get("ask.timeout") returns seconds (0 = disabled), convert to ms
		const timeoutSeconds = this.session.settings.get("ask.timeout");
		const settingsTimeout = timeoutSeconds === 0 ? null : timeoutSeconds * 1000;
		const timeout = planModeEnabled ? null : settingsTimeout;

		// Send notification if waiting and not suppressed
		this.#sendAskNotification();

		if (params.questions.length === 0) {
			return {
				content: [{ type: "text" as const, text: "Error: questions must not be empty" }],
				details: {},
				isWarning: true,
			};
		}

		if (!validQuestionGroup(params.questions)) throw new ToolError("Invalid or ambiguous question group");
		let answers: QuestionAnswers | undefined;
		try {
			answers = extensionUi.questions
				? await extensionUi.questions(params.questions, { signal, timeout: timeout ?? undefined })
				: await runQuestionGroup(params.questions, extensionUi, { signal, timeout: timeout ?? undefined });
		} catch (error) {
			if (error instanceof Error && error.name === "AbortError") throw new ToolAbortError("Ask input was cancelled");
			throw error;
		}
		if (answers === undefined) {
			context.abort();
			throw new ToolAbortError("Ask tool was cancelled by the user");
		}
		if (!validQuestionAnswers(params.questions, answers))
			throw new ToolError("Invalid response to grouped questions");
		const results: QuestionResult[] = params.questions.map(question => ({
			id: question.id,
			question: question.question,
			options: question.options.map(option => option.label),
			multi: question.multi ?? false,
			...answers[question.id],
		}));
		if (params.questions.length === 1) {
			const q = params.questions[0];
			const { options: optionLabels, selectedOptions, customInput } = results[0];
			const details: AskToolDetails = {
				question: q.question,
				options: optionLabels,
				multi: q.multi ?? false,
				selectedOptions,
				customInput,
			};

			const responseParts: string[] = [];
			if (selectedOptions.length > 0) {
				responseParts.push(
					q.multi ? `User selected: ${selectedOptions.join(", ")}` : `User selected: ${selectedOptions[0]}`,
				);
			}
			if (customInput !== undefined) {
				responseParts.push(
					customInput.includes("\n")
						? `User provided custom input:\n${customInput
								.split("\n")
								.map(line => `  ${line}`)
								.join("\n")}`
						: `User provided custom input: ${customInput}`,
				);
			}
			const responseText = responseParts.length > 0 ? responseParts.join("\n") : "User cancelled the selection";

			return { content: [{ type: "text" as const, text: responseText }], details };
		}

		const details: AskToolDetails = { results };
		const responseLines = results.map(formatQuestionResult);
		const responseText = `User answers:\n${responseLines.join("\n")}`;

		return { content: [{ type: "text" as const, text: responseText }], details };
	}
}

// =============================================================================
// TUI Renderer
// =============================================================================

interface AskRenderArgs {
	question?: string;
	options?: Array<{ label: string }>;
	multi?: boolean;
	questions?: Array<{
		id: string;
		question: string;
		options: Array<{ label: string }>;
		multi?: boolean;
	}>;
}

/** Render custom input as a single block with continuation lines (not one entry per line) */
function renderCustomInput(
	uiTheme: Theme,
	prefix: string,
	customInput: string,
	isLastEntry: boolean,
	includeLeadingNewline = true,
): string {
	const lines = customInput.split("\n");
	const branch = isLastEntry ? uiTheme.tree.last : uiTheme.tree.branch;
	const firstLine = lines[0] ?? "";
	let text = `${includeLeadingNewline ? "\n" : ""}${prefix}${uiTheme.fg("dim", branch)} ${uiTheme.styledSymbol("status.success", "success")} ${uiTheme.fg("toolOutput", firstLine)}`;
	const continuationIndent = isLastEntry ? "   " : `${uiTheme.fg("dim", uiTheme.tree.vertical)}  `;
	for (let i = 1; i < lines.length; i++) {
		text += `\n${prefix}${continuationIndent}   ${uiTheme.fg("toolOutput", lines[i])}`;
	}
	return text;
}

export const askToolRenderer = {
	renderCall(args: AskRenderArgs, _options: RenderResultOptions, uiTheme: Theme): Component {
		const label = formatTitle("Ask", uiTheme);
		const mdTheme = getMarkdownTheme();
		const accentStyle = { color: (t: string) => uiTheme.fg("contentAccent", t) };

		// Multi-part questions
		if (args.questions && args.questions.length > 0) {
			const container = new Container();
			container.addChild(new Text(`${label} ${uiTheme.fg("muted", `${args.questions.length} questions`)}`, 0, 0));

			for (let i = 0; i < args.questions.length; i++) {
				const q = args.questions[i];
				const isLastQ = i === args.questions.length - 1;
				const qBranch = isLastQ ? uiTheme.tree.last : uiTheme.tree.branch;
				const continuation = isLastQ ? " " : uiTheme.tree.vertical;

				const meta: string[] = [];
				if (q.multi) meta.push("multi");
				if (q.options?.length) meta.push(`options:${q.options.length}`);
				const metaStr = meta.length > 0 ? uiTheme.fg("dim", ` · ${meta.join(" · ")}`) : "";

				container.addChild(
					new Text(` ${uiTheme.fg("dim", qBranch)} ${uiTheme.fg("dim", `[${q.id}]`)}${metaStr}`, 0, 0),
				);
				container.addChild(new Markdown(q.question, 3, 0, mdTheme, accentStyle));

				if (q.options?.length) {
					let optText = "";
					for (let j = 0; j < q.options.length; j++) {
						const opt = q.options[j];
						const isLastOpt = j === q.options.length - 1;
						const optBranch = isLastOpt ? uiTheme.tree.last : uiTheme.tree.branch;
						const optLabel = renderInlineMarkdown(opt.label, mdTheme, t => uiTheme.fg("muted", t));
						optText += `\n ${uiTheme.fg("dim", continuation)}   ${uiTheme.fg("dim", optBranch)} ${uiTheme.fg("dim", uiTheme.checkbox.unchecked)} ${optLabel}`;
					}
					container.addChild(new Text(optText, 0, 0));
				}
			}
			return container;
		}

		// Single question
		if (!args.question) {
			return new Text(formatErrorMessage("No question provided", uiTheme), 0, 0);
		}

		const container = new Container();
		const meta: string[] = [];
		if (args.multi) meta.push("multi");
		if (args.options?.length) meta.push(`options:${args.options.length}`);
		container.addChild(new Text(`${label}${formatMeta(meta, uiTheme)}`, 0, 0));
		container.addChild(new Markdown(args.question, 1, 0, mdTheme, accentStyle));

		if (args.options?.length) {
			let optText = "";
			for (let i = 0; i < args.options.length; i++) {
				const opt = args.options[i];
				const isLast = i === args.options.length - 1;
				const branch = isLast ? uiTheme.tree.last : uiTheme.tree.branch;
				const optLabel = renderInlineMarkdown(opt.label, mdTheme, t => uiTheme.fg("muted", t));
				optText += `\n ${uiTheme.fg("dim", branch)} ${uiTheme.fg("dim", uiTheme.checkbox.unchecked)} ${optLabel}`;
			}
			container.addChild(new Text(optText, 0, 0));
		}

		return container;
	},

	renderResult(
		result: { content: Array<{ type: string; text?: string }>; details?: AskToolDetails },
		_options: RenderResultOptions,
		uiTheme: Theme,
	): Component {
		const { details } = result;
		const mdTheme = getMarkdownTheme();
		const accentStyle = { color: (t: string) => uiTheme.fg("contentAccent", t) };

		if (!details) {
			const txt = result.content[0];
			const fallback = txt?.type === "text" && txt.text ? txt.text : "";
			const header = renderStatusLine({ title: "Ask" }, uiTheme);
			return new Text(`${header}\n${uiTheme.fg("dim", fallback)}`, 0, 0);
		}

		// Multi-part results
		if (details.results && details.results.length > 0) {
			const header = renderStatusLine(
				{
					title: "Ask",
					meta: [`${details.results.length} questions`],
				},
				uiTheme,
			);
			const container = new Container();
			container.addChild(new Text(header, 0, 0));

			for (let i = 0; i < details.results.length; i++) {
				const r = details.results[i];
				const isLastQuestion = i === details.results.length - 1;
				const branch = isLastQuestion ? uiTheme.tree.last : uiTheme.tree.branch;
				const continuation = isLastQuestion ? "   " : `${uiTheme.fg("dim", uiTheme.tree.vertical)}  `;
				const hasSelection = r.customInput !== undefined || r.selectedOptions.length > 0;
				const statusIcon = hasSelection
					? uiTheme.styledSymbol("status.success", "success")
					: uiTheme.styledSymbol("status.warning", "warning");

				container.addChild(
					new Text(` ${uiTheme.fg("dim", branch)} ${statusIcon} ${uiTheme.fg("dim", `[${r.id}]`)}`, 0, 0),
				);
				container.addChild(new Markdown(r.question, 3, 0, mdTheme, accentStyle));

				const answerLines: string[] = [];
				for (let j = 0; j < r.selectedOptions.length; j++) {
					const isLast = j === r.selectedOptions.length - 1 && r.customInput === undefined;
					const optBranch = isLast ? uiTheme.tree.last : uiTheme.tree.branch;
					const selectedLabel = renderInlineMarkdown(r.selectedOptions[j], mdTheme, t =>
						uiTheme.fg("toolOutput", t),
					);
					answerLines.push(
						`${continuation}${uiTheme.fg("dim", optBranch)} ${uiTheme.fg("success", uiTheme.checkbox.checked)} ${selectedLabel}`,
					);
				}
				if (answerLines.length > 0) {
					container.addChild(new Text(answerLines.join("\n"), 0, 0));
				}
				if (r.customInput !== undefined) {
					container.addChild(new Text(renderCustomInput(uiTheme, continuation, r.customInput, true, false), 0, 0));
				} else if (r.selectedOptions.length === 0) {
					container.addChild(
						new Text(
							`${continuation}${uiTheme.fg("dim", uiTheme.tree.last)} ${uiTheme.styledSymbol("status.warning", "warning")} ${uiTheme.fg("warning", "Cancelled")}`,
							0,
							0,
						),
					);
				}
			}
			return container;
		}

		// Single question result
		if (!details.question) {
			const txt = result.content[0];
			const fallback = txt?.type === "text" && txt.text ? txt.text : "";
			return new Text(fallback, 0, 0);
		}

		const header = renderStatusLine({ title: "Ask" }, uiTheme);
		const container = new Container();
		container.addChild(new Text(header, 0, 0));
		container.addChild(new Markdown(details.question, 1, 0, mdTheme, accentStyle));

		const answerLines: string[] = [];
		if (details.selectedOptions && details.selectedOptions.length > 0) {
			for (let i = 0; i < details.selectedOptions.length; i++) {
				const isLast = i === details.selectedOptions.length - 1 && details.customInput === undefined;
				const branch = isLast ? uiTheme.tree.last : uiTheme.tree.branch;
				const selectedLabel = renderInlineMarkdown(details.selectedOptions[i], mdTheme, t =>
					uiTheme.fg("toolOutput", t),
				);
				answerLines.push(
					` ${uiTheme.fg("dim", branch)} ${uiTheme.fg("success", uiTheme.checkbox.checked)} ${selectedLabel}`,
				);
			}
		}
		if (answerLines.length > 0) {
			container.addChild(new Text(answerLines.join("\n"), 0, 0));
		}
		if (details.customInput !== undefined) {
			container.addChild(new Text(renderCustomInput(uiTheme, " ", details.customInput, true, false), 0, 0));
		} else if (!details.selectedOptions || details.selectedOptions.length === 0) {
			container.addChild(
				new Text(
					` ${uiTheme.fg("dim", uiTheme.tree.last)} ${uiTheme.styledSymbol("status.warning", "warning")} ${uiTheme.fg("warning", "Cancelled")}`,
					0,
					0,
				),
			);
		}

		return container;
	},
};
