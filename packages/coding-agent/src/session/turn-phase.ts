export const NORMALIZED_TURN_PHASES = [
	"submitting",
	"thinking",
	"tool_call",
	"awaiting_user",
	"cancelled",
	"error",
	"idle",
] as const;

export type NormalizedTurnPhase = (typeof NORMALIZED_TURN_PHASES)[number];

/** Safe lifecycle event: deliberately contains no prompt, provider, tool, argument, or result data. */
export interface TurnPhaseEvent {
	type: "turn_phase";
	phase: NormalizedTurnPhase;
	turnId: number;
}

type TurnSettlement = "stop" | "aborted" | "error";

/**
 * Provider-neutral source of truth for the currently visible turn phase.
 * Provider adapters keep emitting their rich text; this controller observes only
 * lifecycle boundaries and publishes a minimal, payload-free status contract.
 */
export class TurnPhaseController {
	#turnId = 0;
	#phase: NormalizedTurnPhase = "idle";
	#activeTurn = false;
	#activeToolCalls = new Set<string>();
	#userPromptDepth = 0;

	constructor(private readonly publish: (event: TurnPhaseEvent) => void) {}

	get current(): TurnPhaseEvent {
		return { type: "turn_phase", phase: this.#phase, turnId: this.#turnId };
	}

	startTurn(): void {
		this.#turnId++;
		this.#activeTurn = true;
		this.#activeToolCalls.clear();
		this.#userPromptDepth = 0;
		this.#transition("submitting", true);
	}

	/** Activate an agent loop that was started without a new submitted prompt (for example, a continuation). */
	startAgentLoop(): void {
		if (this.#activeTurn) return;
		this.#turnId++;
		this.#activeTurn = true;
		this.#activeToolCalls.clear();
		this.#userPromptDepth = 0;
		this.#transition("thinking", true);
	}

	startModelTurn(): void {
		if (this.#activeTurn && this.#userPromptDepth === 0) this.#transition("thinking");
	}

	startTool(toolCallId: string): void {
		if (!this.#activeTurn) return;
		this.#activeToolCalls.add(toolCallId);
		if (this.#userPromptDepth === 0) this.#transition("tool_call");
	}

	endTool(toolCallId: string): void {
		if (!this.#activeTurn) return;
		this.#activeToolCalls.delete(toolCallId);
		if (this.#userPromptDepth === 0 && this.#activeToolCalls.size === 0) this.#transition("thinking");
	}

	startUserPrompt(): void {
		this.#userPromptDepth++;
		this.#transition("awaiting_user");
	}

	endUserPrompt(): void {
		this.#userPromptDepth = Math.max(0, this.#userPromptDepth - 1);
		if (this.#userPromptDepth > 0) return;
		if (!this.#activeTurn) {
			this.#transition("idle");
			return;
		}
		this.#transition(this.#activeToolCalls.size > 0 ? "tool_call" : "thinking");
	}

	settle(settlement: TurnSettlement): void {
		if (!this.#activeTurn) return;
		this.#activeTurn = false;
		this.#activeToolCalls.clear();
		this.#userPromptDepth = 0;
		this.#transition(settlement === "aborted" ? "cancelled" : settlement === "error" ? "error" : "idle");
	}

	#transition(phase: NormalizedTurnPhase, force = false): void {
		if (!force && phase === this.#phase) return;
		this.#phase = phase;
		this.publish(this.current);
	}
}
