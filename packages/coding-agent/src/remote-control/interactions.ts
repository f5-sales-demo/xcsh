import type { UserInteraction, UserInteractions } from "../session/user-interactions";
import { ProtocolError } from "./errors";
import type { Notification } from "./session";

type Context = { threadId: string; turnId: string; itemId: string };
export interface InteractionRequest extends Notification {
	id: string;
}
const record = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === "object" && !Array.isArray(value);

const identity = (value: unknown): value is string =>
	typeof value === "string" && value.length > 0 && value.length <= 256;
const optionalBoolean = (value: unknown): boolean => value === undefined || typeof value === "boolean";

/** The host bounds the entire pending snapshot, including prompts received as live events. */
export function validateInteractionRequests(threadId: string, input: unknown): InteractionRequest[] {
	const invalid = () => new ProtocolError(-32602, "Invalid pending user requests");
	if (!Array.isArray(input)) throw invalid();
	if (input.length > 32) throw new ProtocolError(-32000, "Pending user request limit");
	const seen = new Set<string>();
	for (const request of input) {
		if (
			!record(request) ||
			!identity(request.id) ||
			request.method !== "item/tool/requestUserInput" ||
			!record(request.params)
		)
			throw invalid();
		const params = request.params;
		if (
			seen.has(request.id) ||
			params.threadId !== threadId ||
			!identity(params.turnId) ||
			!identity(params.itemId) ||
			!Array.isArray(params.questions) ||
			!optionalBoolean(params.isBlocking)
		)
			throw invalid();
		seen.add(request.id);
		if (
			params.autoResolutionMs != null &&
			(typeof params.autoResolutionMs !== "number" ||
				!Number.isSafeInteger(params.autoResolutionMs) ||
				params.autoResolutionMs < 0)
		)
			throw invalid();
		const questions = new Set<string>();
		for (const question of params.questions) {
			if (
				!record(question) ||
				!identity(question.id) ||
				questions.has(question.id) ||
				typeof question.header !== "string" ||
				typeof question.question !== "string" ||
				!optionalBoolean(question.isOther) ||
				!optionalBoolean(question.isSecret)
			)
				throw invalid();
			questions.add(question.id);
			if (
				question.options != null &&
				(!Array.isArray(question.options) ||
					question.options.some(
						option =>
							!record(option) || typeof option.label !== "string" || typeof option.description !== "string",
					))
			)
				throw invalid();
		}
	}
	if (Buffer.byteLength(JSON.stringify(input)) > 1024 * 1024)
		throw new ProtocolError(-32000, "Pending user request buffer limit");
	return input as InteractionRequest[];
}

/** Wire fields follow Codex 0.153.4 v2/item.rs; see NOTICE.md for provenance. */
export class RemoteInteractions {
	#requests = new Map<string, { interaction: UserInteraction; request: InteractionRequest }>();
	#unsubscribe: () => void;
	constructor(
		private readonly broker: UserInteractions,
		private readonly context: (toolCallId: string) => Context | undefined,
		private readonly notify: (event: Notification) => void,
	) {
		this.#unsubscribe = broker.subscribe(event => {
			if (event.type === "opened") this.#open(event.interaction);
			else {
				const pending = this.#requests.get(event.interaction.id);
				if (!pending) return;
				this.#requests.delete(event.interaction.id);
				this.notify({
					method: "serverRequest/resolved",
					params: { threadId: pending.request.params.threadId, requestId: event.interaction.id },
				});
			}
		});
		for (const interaction of broker.pending()) this.#open(interaction);
	}
	#open(interaction: UserInteraction): void {
		if (!interaction.toolCallId) return;
		const context = this.context(interaction.toolCallId);
		if (!context) return;
		const request: InteractionRequest = {
			id: interaction.id,
			method: "item/tool/requestUserInput",
			params: {
				...context,
				questions:
					interaction.kind === "questions"
						? interaction.questions?.map(question => ({
								id: question.id,
								header: question.header ?? question.id,
								question: question.question,
								isOther: question.isOther ?? true,
								isSecret: question.isSecret ?? false,
								options: question.options.length
									? question.options.map((option, index) => ({
											label: option.label,
											description:
												option.description ?? (index === question.recommended ? "Recommended" : ""),
										}))
									: null,
							}))
						: [
								{
									id: interaction.id,
									header: "Question",
									question: interaction.title,
									isOther: false,
									isSecret: interaction.isSecret ?? false,
									options:
										interaction.kind === "select"
											? (interaction.options?.map(label => ({ label, description: "" })) ?? [])
											: null,
								},
							],
				isBlocking: true,
				autoResolutionMs: null,
			},
		};
		this.#requests.set(interaction.id, { interaction, request });
		this.notify(structuredClone(request));
	}
	pending(): InteractionRequest[] {
		return [...this.#requests.values()].map(value => structuredClone(value.request));
	}
	respond(id: string, response: unknown): { accepted: boolean } {
		const pending = this.#requests.get(id);
		if (!pending) return { accepted: false };
		const current = this.context(pending.interaction.toolCallId!);
		if (!current || Object.entries(current).some(([key, value]) => pending.request.params[key] !== value))
			return { accepted: false };
		const invalid = () => new ProtocolError(-32602, "Invalid answer to user interaction");
		if (!record(response) || !record(response.answers)) throw invalid();
		if (pending.interaction.kind === "questions") {
			const questions = pending.interaction.questions ?? [];
			const answers = response.answers;
			if (Object.keys(answers).length === 0) return { accepted: this.broker.respond(id, undefined) };
			if (Object.keys(answers).length !== questions.length) throw invalid();
			const values = Object.fromEntries(
				questions.map(question => {
					if (!Object.hasOwn(answers, question.id)) throw invalid();
					const answer = answers[question.id];
					if (
						!record(answer) ||
						!Array.isArray(answer.answers) ||
						answer.answers.some(value => typeof value !== "string")
					)
						throw invalid();
					const selectedOptions = answer.answers.filter(value =>
						question.options.some(option => option.label === value),
					);
					const custom = answer.answers.filter(value => !question.options.some(option => option.label === value));
					if (custom.length > 1) throw invalid();
					return [question.id, { selectedOptions, ...(custom.length ? { customInput: custom[0] } : {}) }];
				}),
			);
			const emptySingle =
				questions.length === 1 &&
				values[questions[0].id].selectedOptions.length === 0 &&
				values[questions[0].id].customInput === undefined;
			if (!this.broker.respond(id, emptySingle ? undefined : values)) throw invalid();
			return { accepted: true };
		}
		const keys = Object.keys(response.answers);
		let value: string | undefined;
		if (keys.length) {
			if (keys.length !== 1 || keys[0] !== id) throw invalid();
			const answer = response.answers[id];
			if (!record(answer) || !Array.isArray(answer.answers) || answer.answers.length > 1) throw invalid();
			if (answer.answers.length) {
				if (typeof answer.answers[0] !== "string") throw invalid();
				value = answer.answers[0];
			}
		}
		if (!this.broker.respond(id, value)) throw invalid();
		return { accepted: true };
	}
	close(): void {
		this.#unsubscribe();
		this.#requests.clear();
	}
}
