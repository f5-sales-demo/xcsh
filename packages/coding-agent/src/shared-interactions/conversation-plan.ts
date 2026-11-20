export const PLAN_ACTIONS = [
	{ id: "implement", label: "Yes, implement this plan", description: "Switch to Default and start coding." },
	{ id: "fresh", label: "Yes, clear context and implement", description: "Fresh thread with this plan." },
	{ id: "stay", label: "No, stay in Plan mode", description: "Continue planning with the model." },
] as const;
export type PlanAction = (typeof PLAN_ACTIONS)[number]["id"];
export const FRESH_PLAN_PREFIX =
	"A previous agent produced the plan below to accomplish the user's task. Implement the plan in a fresh context. Treat the plan as the source of user intent, re-read files as needed, and carry the work through implementation and verification.";
export interface ConversationPlan {
	id: string;
	itemId: string;
	revision: number;
	markdown: string;
	status: "pending" | "resolved" | "superseded";
}
export interface PlanImplementation {
	mode: "plan" | "default";
	freshContext: boolean;
	text?: string;
}

/** Incremental stream consumer. Plans are conversation artifacts, never file approvals. */
export class ConversationPlans {
	#buffers = new Map<string, string>();
	#completed = new Set<string>();
	#revision = 0;
	#current?: ConversationPlan;
	get current(): ConversationPlan | undefined {
		return this.#current ? { ...this.#current } : undefined;
	}
	append(itemId: string, delta: string): ConversationPlan | undefined {
		if (this.#completed.has(itemId)) return;
		const text = (this.#buffers.get(itemId) ?? "") + delta;
		this.#buffers.set(itemId, text);
		let fence = "";
		let collecting = false;
		const plan: string[] = [];
		for (const line of text.split(/\r?\n/)) {
			const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
			if (marker && !collecting) {
				if (!fence) fence = marker;
				else if (marker[0] === fence[0] && marker.length >= fence.length) fence = "";
				continue;
			}
			if (fence) continue;
			if (!collecting && line.trim() === "<proposed_plan>") {
				collecting = true;
				continue;
			}
			if (collecting && line.trim() === "</proposed_plan>") {
				const markdown = plan.join("\n").trim();
				if (!markdown) return;
				this.#completed.add(itemId);
				this.#buffers.delete(itemId);
				if (this.#current) this.#current.status = "superseded";
				const revision = ++this.#revision;
				this.#current = { id: `${itemId}:plan:${revision}`, itemId, revision, markdown, status: "pending" };
				return this.current;
			}
			if (collecting) plan.push(line);
		}
	}
	decide(id: string, action: PlanAction): PlanImplementation | undefined {
		if (
			!PLAN_ACTIONS.some(candidate => candidate.id === action) ||
			this.#current?.id !== id ||
			this.#current.status !== "pending"
		)
			return;
		this.#current.status = "resolved";
		if (action === "stay") return { mode: "plan", freshContext: false };
		return {
			mode: "default",
			freshContext: action === "fresh",
			text: action === "fresh" ? `${FRESH_PLAN_PREFIX}\n\n${this.#current.markdown}` : "Implement the plan.",
		};
	}
	/** Restore a durable conversation artifact, including a cancelled context switch. */
	restore(plan: ConversationPlan): void {
		this.#current = structuredClone(plan);
		this.#revision = Math.max(this.#revision, plan.revision);
		this.#completed.add(plan.itemId);
		this.#buffers.delete(plan.itemId);
	}
	complete(itemId: string, text: string): ConversationPlan | undefined {
		if (this.#completed.has(itemId)) return;
		this.#buffers.delete(itemId);
		return this.append(itemId, text);
	}
	reset(): void {
		this.#buffers.clear();
		this.#completed.clear();
		this.#revision = 0;
		this.#current = undefined;
	}
	invalidate(): void {
		if (this.#current?.status === "pending") this.#current.status = "superseded";
		this.#buffers.clear();
	}
}
