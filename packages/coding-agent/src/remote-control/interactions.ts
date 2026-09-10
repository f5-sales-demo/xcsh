import type { UserInteraction, UserInteractions } from "../session/user-interactions";
import { ProtocolError } from "./errors";
import type { Notification } from "./session";

type Context = { threadId: string; turnId: string; itemId: string };
export interface InteractionRequest extends Notification {
	id: string;
}
const record = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === "object" && !Array.isArray(value);

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
				questions: [
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
