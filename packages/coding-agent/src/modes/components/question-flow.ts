import { untilAborted } from "@f5-sales-demo/pi-utils";
import type { InteractionQuestion, QuestionAnswer, QuestionAnswers } from "../../session/question-types";
import { theme } from "../theme/theme";

const OTHER_OPTION = "Other (type your own)";
const RECOMMENDED_SUFFIX = " (Recommended)";

function getDoneOptionLabel(): string {
	return `${theme.status.success} Done selecting`;
}

/** Add "(Recommended)" suffix to the option at the given index if not already present */
function addRecommendedSuffix(labels: string[], recommendedIndex?: number): string[] {
	if (recommendedIndex === undefined || recommendedIndex < 0 || recommendedIndex >= labels.length) {
		return labels;
	}
	return labels.map((label, i) => {
		if (
			i === recommendedIndex &&
			!label.endsWith(RECOMMENDED_SUFFIX) &&
			!labels.includes(label + RECOMMENDED_SUFFIX)
		) {
			return label + RECOMMENDED_SUFFIX;
		}
		return label;
	});
}

function getAutoSelectionOnTimeout(optionLabels: string[], recommended?: number): string[] {
	if (optionLabels.length === 0) return [];
	if (typeof recommended === "number" && recommended >= 0 && recommended < optionLabels.length) {
		return [optionLabels[recommended]];
	}
	return [optionLabels[0]];
}

// =============================================================================
// Question Selection Logic
// =============================================================================

interface SelectionResult {
	selectedOptions: string[];
	customInput?: string;
	timedOut: boolean;
	navigation?: "back" | "forward";
	cancelled?: boolean;
}

interface NavigationControls {
	allowBack: boolean;
	allowForward: boolean;
	progressText?: string;
}
interface AskSingleQuestionOptions {
	isOther?: boolean;
	recommended?: number;
	timeout?: number;
	signal?: AbortSignal;
	initialSelection?: Pick<SelectionResult, "selectedOptions" | "customInput">;
	navigation?: NavigationControls;
}

export interface QuestionFormUI {
	select(
		prompt: string,
		options: string[],
		options_?: {
			initialIndex?: number;
			timeout?: number;
			signal?: AbortSignal;
			outline?: boolean;
			onTimeout?: () => void;
			onLeft?: () => void;
			onRight?: () => void;
			helpText?: string;
		},
	): Promise<string | undefined>;
	editor(
		title: string,
		prefill?: string,
		dialogOptions?: { signal?: AbortSignal },
		editorOptions?: { promptStyle?: boolean },
	): Promise<string | undefined>;
}

async function askSingleQuestion(
	ui: QuestionFormUI,
	question: string,
	optionLabels: string[],
	multi: boolean,
	options: AskSingleQuestionOptions = {},
): Promise<SelectionResult> {
	const { recommended, timeout, signal, initialSelection, navigation, isOther = true } = options;
	let otherLabel = OTHER_OPTION;
	while (optionLabels.includes(otherLabel)) otherLabel += "…";
	const doneLabel = getDoneOptionLabel();
	let selectedOptions = [...(initialSelection?.selectedOptions ?? [])];
	let customInput = initialSelection?.customInput;
	let timedOut = false;

	const selectOption = async (
		prompt: string,
		optionsToShow: string[],
		initialIndex?: number,
	): Promise<{ choice: string | undefined; timedOut: boolean; navigation?: "back" | "forward" }> => {
		let timeoutTriggered = false;
		const onTimeout = () => {
			timeoutTriggered = true;
		};
		let navigationAction: "back" | "forward" | undefined;
		const helpText = navigation
			? "up/down navigate  enter select  ←/→ question  esc cancel"
			: "up/down navigate  enter select  esc cancel";
		const dialogOptions = {
			initialIndex,
			timeout,
			signal,
			outline: true,
			onTimeout,
			helpText,
			onLeft: navigation?.allowBack
				? () => {
						navigationAction = "back";
					}
				: undefined,
			onRight: navigation?.allowForward
				? () => {
						navigationAction = "forward";
					}
				: undefined,
		};
		const choice = signal
			? await untilAborted(signal, () => ui.select(prompt, optionsToShow, dialogOptions))
			: await ui.select(prompt, optionsToShow, dialogOptions);
		return { choice, timedOut: timeoutTriggered, navigation: navigationAction };
	};

	const promptForCustomInput = async (): Promise<{ input: string | undefined }> => {
		const dialogOptions = signal ? { signal } : undefined;
		const showCustomInput = () => ui.editor("Enter your response:", undefined, dialogOptions, { promptStyle: true });
		const input = signal ? await untilAborted(signal, showCustomInput) : await showCustomInput();
		return { input };
	};

	const promptWithProgress = navigation?.progressText ? `${question} (${navigation.progressText})` : question;
	if (multi) {
		const selected = new Set<string>(selectedOptions);
		let cursorIndex = Math.min(Math.max(recommended ?? 0, 0), Math.max(optionLabels.length - 1, 0));
		const firstSelected = selectedOptions[0];
		if (firstSelected) {
			const selectedIndex = optionLabels.indexOf(firstSelected);
			if (selectedIndex >= 0) cursorIndex = selectedIndex;
		}
		while (true) {
			const opts: string[] = [];

			for (const opt of optionLabels) {
				const checkbox = selected.has(opt) ? theme.checkbox.checked : theme.checkbox.unchecked;
				opts.push(`${checkbox} ${opt}`);
			}

			if (!navigation?.allowForward && selected.size > 0) {
				opts.push(doneLabel);
			}
			if (isOther) opts.push(otherLabel);

			const prefix = selected.size > 0 ? `(${selected.size} selected) ` : "";
			const {
				choice,
				timedOut: selectTimedOut,
				navigation: arrowNavigation,
			} = await selectOption(`${prefix}${promptWithProgress}`, opts, cursorIndex);

			if (arrowNavigation) {
				return { selectedOptions: Array.from(selected), customInput, timedOut, navigation: arrowNavigation };
			}
			if (choice === undefined) {
				if (selectTimedOut) {
					timedOut = true;
					break;
				}
				return { selectedOptions: Array.from(selected), customInput, timedOut, cancelled: true };
			}
			if (choice === doneLabel) break;

			if (isOther && choice === otherLabel) {
				if (selectTimedOut) {
					timedOut = true;
					break;
				}
				const customResult = await promptForCustomInput();
				if (customResult.input === undefined) {
					break;
				}
				customInput = customResult.input;
				break;
			}

			const selectedIdx = opts.indexOf(choice);
			if (selectedIdx >= 0) {
				cursorIndex = selectedIdx;
			}

			const checkedPrefix = `${theme.checkbox.checked} `;
			const uncheckedPrefix = `${theme.checkbox.unchecked} `;
			let opt: string | undefined;
			if (choice.startsWith(checkedPrefix)) {
				opt = choice.slice(checkedPrefix.length);
			} else if (choice.startsWith(uncheckedPrefix)) {
				opt = choice.slice(uncheckedPrefix.length);
			}
			if (opt) {
				if (selected.has(opt)) {
					selected.delete(opt);
				} else {
					selected.add(opt);
				}
			}

			if (selectTimedOut) {
				timedOut = true;
				break;
			}
		}
		selectedOptions = Array.from(selected);
	} else {
		const displayLabels = addRecommendedSuffix(optionLabels, recommended);
		const optionsWithNavigation = [...displayLabels, ...(isOther ? [otherLabel] : [])];

		let initialIndex = recommended;
		const previouslySelected = selectedOptions[0];
		if (previouslySelected) {
			const selectedIndex = optionLabels.indexOf(previouslySelected);
			if (selectedIndex >= 0) initialIndex = selectedIndex;
		} else if (customInput !== undefined) {
			initialIndex = displayLabels.length;
		}
		if (initialIndex !== undefined) {
			const maxIndex = Math.max(optionsWithNavigation.length - 1, 0);
			initialIndex = Math.max(0, Math.min(initialIndex, maxIndex));
		}

		const {
			choice,
			timedOut: selectTimedOut,
			navigation: arrowNavigation,
		} = await selectOption(promptWithProgress, optionsWithNavigation, initialIndex);
		timedOut = selectTimedOut;

		if (arrowNavigation) {
			return { selectedOptions, customInput, timedOut, navigation: arrowNavigation };
		}
		if (choice === undefined) {
			if (!timedOut) {
				return { selectedOptions, customInput, timedOut, cancelled: true };
			}
		} else if (isOther && choice === otherLabel) {
			if (!selectTimedOut) {
				const customResult = await promptForCustomInput();
				if (customResult.input !== undefined) {
					customInput = customResult.input;
					selectedOptions = [];
				}
				// If editor was dismissed (undefined), keep prior selectedOptions/customInput intact
			}
		} else {
			const index = displayLabels.indexOf(choice);
			selectedOptions = index < 0 ? [] : [optionLabels[index]];
			customInput = undefined;
		}
		if (navigation?.allowForward) {
			return { selectedOptions, customInput, timedOut, navigation: "forward" };
		}
	}

	if (timedOut && selectedOptions.length === 0 && customInput === undefined) {
		selectedOptions = getAutoSelectionOnTimeout(optionLabels, recommended);
	}

	return { selectedOptions, customInput, timedOut };
}

/** Present the existing selector/editor workflow without publishing individual dialog steps. */
export async function runQuestionGroup(
	questions: readonly InteractionQuestion[],
	ui: QuestionFormUI,
	options: { signal?: AbortSignal; timeout?: number } = {},
): Promise<QuestionAnswers | undefined> {
	const results: Array<QuestionAnswer | undefined> = Array.from({ length: questions.length });
	let index = 0;
	while (index < questions.length) {
		const question = questions[index];
		const answer = await askSingleQuestion(
			ui,
			question.question,
			question.options.map(option => option.label),
			question.multi ?? false,
			{
				...options,
				recommended: question.recommended,
				isOther: question.isOther,
				initialSelection: results[index],
				navigation:
					questions.length > 1
						? { allowBack: index > 0, allowForward: true, progressText: `${index + 1}/${questions.length}` }
						: undefined,
			},
		);
		if (
			!answer.timedOut &&
			(answer.cancelled ||
				(questions.length === 1 && answer.selectedOptions.length === 0 && answer.customInput === undefined))
		)
			return undefined;
		results[index] = {
			selectedOptions: answer.selectedOptions,
			...(answer.customInput === undefined ? {} : { customInput: answer.customInput }),
		};
		index = answer.navigation === "back" ? Math.max(0, index - 1) : index + 1;
	}
	return Object.fromEntries(
		questions.map((question, index) => [question.id, results[index] ?? { selectedOptions: [] }]),
	);
}
