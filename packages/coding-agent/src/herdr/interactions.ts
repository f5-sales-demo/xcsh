import { isDeepStrictEqual } from "node:util";
import type { ConversationPlan, PlanAction } from "../../../chat-ui/src/interactions/conversation-plan";
import type {
	InteractionIdentity,
	UserInteraction,
	UserInteractionEvent,
	UserInteractions,
} from "../session/user-interactions";

interface Client {
	ensureProtocol(): Promise<void>;
	capabilityVersion(name: string): number | undefined;
	request(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>>;
}
interface Binding {
	execution_id: string;
	pane_id: string;
	producer: string;
	generation: number;
}
interface Owner extends Binding {
	session_id: string;
}
interface Target {
	owner: Owner;
	request_id: string;
}
interface Entry {
	target: Target;
	identity: InteractionIdentity;
	report: Record<string, unknown>;
	decide?: (action: PlanAction) => Promise<{ accepted: boolean }>;
}
const record = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === "object" && !Array.isArray(value);

/** Additional observation never owns completion or disables the local interaction path. */
export class HerdrInteractionBridge {
	#entries = new Map<string, Entry>();
	#reports: Record<string, unknown>[] = [];
	#acks: Record<string, unknown>[] = [];
	#decisions = new Map<string, { action: unknown; accepted: boolean }>();
	#unsubscribe: () => void;
	#timer?: ReturnType<typeof setInterval>;
	#flight?: Promise<void>;
	#closed = false;
	#failureReported = false;
	constructor(
		private readonly client: Client,
		private readonly interactions: UserInteractions,
		private readonly binding: Binding,
		private readonly onError: (error: unknown) => void,
		private readonly capability?: string,
		poll = true,
	) {
		this.#unsubscribe = interactions.subscribe(event => this.#observe(event));
		for (const request of interactions.pending()) this.#open(request, 1);
		if (poll) {
			this.#timer = setInterval(() => {
				void this.flush();
			}, 1000);
			this.#timer.unref?.();
		}
	}
	#observe(event: UserInteractionEvent): void {
		if (event.type === "opened") this.#open(event.interaction, event.revision);
		else {
			const entry = this.#entries.get(event.interaction.id);
			if (!entry) return;
			entry.report = { ...entry.report, event_revision: event.revision, state: event.reason ?? "owner_lost" };
			this.#reports.push(structuredClone(entry.report));
		}
	}
	#open(request: UserInteraction, revision: number): void {
		const identity = request.identity;
		if (!identity || (request.kind !== "request_user_input" && request.delivery !== "async")) return;
		const target = { owner: { ...this.binding, session_id: identity.sessionId }, request_id: request.id };
		const report = {
			target,
			thread_id: identity.threadId,
			turn_id: identity.turnId,
			item_id: identity.itemId,
			question_ids: request.inputQuestions?.map(question => question.id) ?? [request.questionId ?? identity.itemId],
			event_revision: revision,
			kind: request.delivery === "async" ? "async" : "waiting",
			state: "pending",
			payload:
				request.delivery === "async"
					? {
							id: identity.itemId,
							type: "agentMessage",
							text: request.title,
							phase: "final_answer",
							delivery: "async",
							questions: [{ title: request.title, ...(request.options ? { options: request.options } : {}) }],
						}
					: { questions: request.inputQuestions, isBlocking: true, autoResolutionMs: null },
		};
		this.#entries.set(request.id, { target, identity: structuredClone(identity), report });
		this.#reports.push(structuredClone(report));
	}
	plan(
		plan: ConversationPlan,
		identity: InteractionIdentity,
		decide: (action: PlanAction) => Promise<{ accepted: boolean }>,
	): void {
		const target = { owner: { ...this.binding, session_id: identity.sessionId }, request_id: plan.id };
		const report = {
			target,
			thread_id: identity.threadId,
			turn_id: identity.turnId,
			item_id: plan.itemId,
			question_ids: [],
			event_revision: plan.revision,
			kind: "plan_decision",
			payload: plan,
			state: "pending",
		};
		this.#entries.set(plan.id, { target, identity, report, decide });
		this.#reports.push(structuredClone(report));
	}
	resolvePlan(planId: string): void {
		const entry = this.#entries.get(planId);
		if (!entry) return;
		entry.report = { ...entry.report, event_revision: Number(entry.report.event_revision) + 1, state: "answered" };
		this.#reports.push(structuredClone(entry.report));
	}
	flush(): Promise<void> {
		if (this.#closed) return Promise.resolve();
		if (this.#flight) return this.#flight;
		this.#flight = this.#flush()
			.catch(error => {
				if (!this.#failureReported) this.onError(error);
				this.#failureReported = true;
			})
			.finally(() => {
				this.#flight = undefined;
			});
		return this.#flight;
	}
	async #flush(): Promise<void> {
		if (!this.#entries.size) return;
		await this.client.ensureProtocol();
		if (this.client.capabilityVersion("agent_interactions") !== 1)
			throw new Error("Herdr interaction capability is unavailable");
		await this.#flushAcknowledgements();
		while (this.#reports.length) {
			const report = this.#reports[0];
			const response = await this.client.request("agent.interaction.report", {
				...report,
				...(this.capability ? { native_capability: this.capability } : {}),
			});
			if (response.type !== "agent_interaction") throw new Error("Herdr did not acknowledge the interaction report");
			this.#reports.shift();
		}
		const owners = new Map(
			[...this.#entries.values()]
				.filter(entry => entry.report.state === "pending")
				.map(entry => [JSON.stringify(entry.target.owner), entry.target.owner]),
		);
		for (const owner of owners.values()) {
			const producer = { owner, ...(this.capability ? { native_capability: this.capability } : {}) };
			const response = await this.client.request("agent.interaction.delivery.get", producer);
			if (response.type !== "agent_interaction_deliveries" || !Array.isArray(response.deliveries))
				throw new Error("Invalid Herdr delivery response");
			for (const delivery of response.deliveries) {
				if (
					!record(delivery) ||
					!record(delivery.receipt) ||
					!record(delivery.receipt.target) ||
					typeof delivery.receipt.response_id !== "string"
				)
					throw new Error("Invalid Herdr delivery identity");
				const receipt = delivery.receipt;
				const target = receipt.target as unknown as Target;
				const entry = this.#entries.get(target.request_id);
				if (!entry || !isDeepStrictEqual(target, entry.target)) throw new Error("Herdr delivery owner mismatch");
				let accepted: boolean;
				if (entry.decide) {
					const prior = this.#decisions.get(receipt.response_id as string);
					if (prior) accepted = prior.action === delivery.answer && prior.accepted;
					else {
						accepted =
							typeof delivery.answer === "string" &&
							["implement", "fresh", "stay"].includes(delivery.answer) &&
							(await entry.decide(delivery.answer as PlanAction)).accepted;
						this.#decisions.set(receipt.response_id as string, { action: delivery.answer, accepted });
					}
				} else
					accepted = this.interactions.respondExternal(
						target.request_id,
						receipt.response_id as string,
						delivery.answer,
						entry.identity,
					);
				this.#acks.push({
					producer,
					request_id: target.request_id,
					response_id: receipt.response_id,
					accepted,
				});
				await this.#flushAcknowledgements();
			}
		}
		this.#failureReported = false;
	}
	async #flushAcknowledgements(): Promise<void> {
		while (this.#acks.length) {
			const ack = await this.client.request("agent.interaction.delivery.ack", this.#acks[0]);
			if (ack.type !== "agent_interaction_receipt")
				throw new Error("Herdr did not acknowledge producer answer delivery");
			this.#acks.shift();
		}
	}
	async close(): Promise<void> {
		if (this.#timer) clearInterval(this.#timer);
		this.#unsubscribe();
		await this.flush();
		this.#closed = true;
	}
}
