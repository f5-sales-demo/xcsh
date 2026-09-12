import type { SessionTarget } from "./session";
import { VoiceHistory } from "./voice-history";
import type { TimelineInput } from "./voice-timeline";

type Listener = (method: string, params: Record<string, unknown>) => void;
const owners = new WeakMap<SessionTarget, SessionVoiceHistory>();

/** Realtime history belongs to the terminal session, across calls and adapter reattachment. */
export class SessionVoiceHistory {
	readonly history: VoiceHistory;
	readonly #listeners = new Set<Listener>();
	readonly retireInputHook?: () => void;
	constructor(
		readonly sessionId: string,
		target: SessionTarget,
	) {
		this.history = new VoiceHistory(
			null,
			async record => {
				if (target.sessionId !== sessionId) throw new Error("Voice history storage owner changed");
				target.sessionManager.appendCustomEntry("remote-realtime", record);
				await target.sessionManager.flush();
			},
			(method, params) => {
				for (const listener of this.#listeners) listener(method, params);
			},
		);
		this.retireInputHook = target.addBeforeUserInputHook?.(message => {
			if (!this.history.engaged || target.sessionId !== sessionId) return;
			const content =
				typeof message.content === "string"
					? [{ type: "text", text: message.content }]
					: message.content.map(part =>
							part.type === "text" ? { type: "text", text: part.text } : { type: "image" },
						);
			return this.history.observe({
				type: "item",
				turnId: "",
				completed: false,
				item: { id: "input-preparation", type: "userMessage", content },
			});
		});
	}
	subscribe(listener: Listener): () => void {
		this.#listeners.add(listener);
		return () => {
			this.#listeners.delete(listener);
		};
	}
	dispatch(
		method: string,
		params: Record<string, unknown>,
		forward: (params: Record<string, unknown>) => void,
	): Promise<void> | undefined {
		if (this.history.engaged) params = structuredClone(params);
		let event: TimelineInput | undefined;
		const turn = params.turn as { id?: string; status?: string } | undefined;
		if (method === "turn/started" && typeof turn?.id === "string") event = { type: "turnStarted", turnId: turn.id };
		else if (method === "turn/completed" && typeof turn?.id === "string")
			event = { type: turn.status === "interrupted" ? "turnAborted" : "turnCompleted", turnId: turn.id };
		else if ((method === "item/started" || method === "item/completed") && typeof params.turnId === "string") {
			const item = params.item as { id?: unknown; type?: unknown } | undefined;
			if (typeof item?.id === "string" && typeof item.type === "string")
				event = {
					type: "item",
					turnId: params.turnId,
					item: structuredClone(item) as { id: string; type: string },
					completed: method === "item/completed",
				};
		} else if (
			method === "item/agentMessage/delta" &&
			typeof params.turnId === "string" &&
			typeof params.itemId === "string" &&
			typeof params.delta === "string"
		)
			event = { type: "textDelta", turnId: params.turnId, itemId: params.itemId, delta: params.delta };
		if (!event) {
			forward(params);
			return;
		}
		if (!this.history.engaged) {
			forward(params);
			return event.type === "turnStarted" || event.type === "turnCompleted" || event.type === "turnAborted"
				? this.history.observe(event)
				: undefined;
		}
		return this.history.observe(event, () => forward(params));
	}
}
export function getSessionVoiceHistory(target: SessionTarget): SessionVoiceHistory {
	let owner = owners.get(target);
	if (!owner || owner.sessionId !== target.sessionId) {
		owner?.retireInputHook?.();
		owner = new SessionVoiceHistory(target.sessionId, target);
		owners.set(target, owner);
	}
	return owner;
}
