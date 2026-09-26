import { describe, expect, it } from "bun:test";
import {
	benchmarkExecutableArgs,
	benchmarkScenarioArgs,
	DEFAULT_MODEL_SCENARIO_TARGETS,
	fixedSeedPairwiseOrder,
	orderedScenarioTurns,
} from "./model-scenarios";

describe("model scenario executable selection", () => {
	it("uses bun dev by default and an installed binary when explicitly requested", () => {
		expect(benchmarkExecutableArgs()).toEqual([process.execPath, "run", "dev", "--"]);
		expect(benchmarkExecutableArgs("/opt/xcsh/bin/xcsh")).toEqual(["/opt/xcsh/bin/xcsh"]);
	});
});

describe("model scenario release matrix", () => {
	it("uses the approved three-model matrix", () => {
		expect(DEFAULT_MODEL_SCENARIO_TARGETS.map(target => target.selector)).toEqual([
			"openai-codex/gpt-6-sol",
			"anthropic/claude-opus-5-5",
			"google-vertex/gemini-3.8-flash",
		]);
	});

	it("uses a stable fixed-seed pairwise order without dropping entries", () => {
		const entries = ["single", "multi", "plan", "long"];
		expect(fixedSeedPairwiseOrder(entries, 4393)).toEqual(fixedSeedPairwiseOrder(entries, 4393));
		expect(fixedSeedPairwiseOrder(entries, 4393)).not.toEqual(fixedSeedPairwiseOrder(entries, 4394));
		expect([...fixedSeedPairwiseOrder(entries, 4393)].sort()).toEqual([...entries].sort());
	});

	it("normalizes legacy one-prompt scenarios and preserves explicit ordered turns", () => {
		const single = {
			prompt: "first",
			contract: { expectedResponse: "one" },
			quality: [],
		} as any;
		expect(orderedScenarioTurns(single)).toEqual([
			{ id: "turn-1", prompt: "first", contract: single.contract, quality: [] },
		]);

		const turns = [
			{ id: "resource", prompt: "What is the route limit?", contract: {}, quality: [] },
			{ id: "follow-up", prompt: "What is its maximum?", contract: {}, quality: [] },
		];
		expect(orderedScenarioTurns({ ...single, turns })).toEqual(turns);
	});

	it("uses RPC mode without an argv prompt for an ordered multi-turn scenario", () => {
		const scenario = {
			prompt: "first",
			contract: {},
			quality: [],
			turns: [
				{ id: "one", prompt: "first", contract: {}, quality: [] },
				{ id: "two", prompt: "follow up", contract: {}, quality: [] },
			],
			runtime: { tools: ["read"], extensions: "none", skills: "none", requiresContext: false },
		} as any;
		const args = benchmarkScenarioArgs(scenario, { label: "Example", selector: "provider/model" }, undefined, "high" as any, undefined);
		expect(args).toContain("rpc");
		expect(args).not.toContain("first");
		expect(args).not.toContain("follow up");
	});
});
