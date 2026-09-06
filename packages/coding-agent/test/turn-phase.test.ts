import { describe, expect, it } from "bun:test";
import { type NormalizedTurnPhase, TurnPhaseController, type TurnPhaseEvent } from "../src/session/turn-phase";

const PROVIDERS = ["anthropic/claude-sonnet-4-6", "openai-codex/gpt-5.3-codex", "google-vertex/gemini-2.5-pro"];

function recordScenario(run: (controller: TurnPhaseController) => void): TurnPhaseEvent[] {
	const events: TurnPhaseEvent[] = [];
	const controller = new TurnPhaseController(event => events.push(event));
	run(controller);
	return events;
}

function phases(events: TurnPhaseEvent[]): NormalizedTurnPhase[] {
	return events.map(event => event.phase);
}

describe("provider-independent turn phases", () => {
	for (const provider of PROVIDERS) {
		describe(provider, () => {
			it("normalizes a no-tool turn", () => {
				const events = recordScenario(controller => {
					controller.startTurn();
					controller.startModelTurn();
					controller.settle("stop");
				});

				expect(phases(events)).toEqual(["submitting", "thinking", "idle"]);
			});

			it("normalizes a tool turn and restores thinking after the tool", () => {
				const events = recordScenario(controller => {
					controller.startTurn();
					controller.startModelTurn();
					controller.startTool("PRIVATE_TOOL_CALL_ID");
					controller.endTool("PRIVATE_TOOL_CALL_ID");
					controller.settle("stop");
				});

				expect(phases(events)).toEqual(["submitting", "thinking", "tool_call", "thinking", "idle"]);
			});

			it("restores the tool phase after awaiting user input", () => {
				const events = recordScenario(controller => {
					controller.startTurn();
					controller.startModelTurn();
					controller.startTool("PRIVATE_TOOL_CALL_ID");
					controller.startUserPrompt();
					controller.endUserPrompt();
					controller.endTool("PRIVATE_TOOL_CALL_ID");
					controller.settle("stop");
				});

				expect(phases(events)).toEqual([
					"submitting",
					"thinking",
					"tool_call",
					"awaiting_user",
					"tool_call",
					"thinking",
					"idle",
				]);
			});

			it("distinguishes cancellation and provider error settlement", () => {
				const cancelled = recordScenario(controller => {
					controller.startTurn();
					controller.startModelTurn();
					controller.settle("aborted");
				});
				const failed = recordScenario(controller => {
					controller.startTurn();
					controller.startModelTurn();
					controller.settle("error");
				});

				expect(phases(cancelled)).toEqual(["submitting", "thinking", "cancelled"]);
				expect(phases(failed)).toEqual(["submitting", "thinking", "error"]);
			});
		});
	}

	it("assigns repeated submissions distinct turn IDs and exposes no prompt or tool data", () => {
		const events = recordScenario(controller => {
			controller.startTurn();
			controller.startModelTurn();
			controller.settle("stop");
			controller.startTurn();
			controller.startModelTurn();
			controller.startTool("PRIVATE_TOOL_CALL_ID");
		});

		expect(events.map(event => event.turnId)).toEqual([1, 1, 1, 2, 2, 2]);
		expect(JSON.stringify(events)).not.toContain("PRIVATE_TOOL_CALL_ID");
		expect(Object.keys(events[0]!).sort()).toEqual(["phase", "turnId", "type"]);
	});
});
