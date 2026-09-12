import { expect, test } from "bun:test";
import { voicePersonaInstructions } from "../../src/remote-control/voice-persona";

const snapshot = {
	systemPrompt: "You are xcsh, the F5 sales-engineering assistant.",
	tools: [
		{ name: "zeta", description: "Last capability." },
		{ name: "alpha", description: "First capability." },
	],
	history: '[{"role":"user","text":"Previous user turn"}]',
};

test.each([undefined, "", null])("voice preferences %p retain xcsh identity", prompt => {
	const { instructions } = voicePersonaInstructions({ ...(prompt === undefined ? {} : { prompt }) }, snapshot);
	expect(instructions).toContain("xcsh's voice surface");
	expect(instructions).toContain(snapshot.systemPrompt);
	expect(instructions).toContain("alpha, zeta");
});

test("history is the only server-supplied section suppressed by includeStartupContext", () => {
	const { instructions } = voicePersonaInstructions({ includeStartupContext: false, prompt: "Be brief." }, snapshot);
	expect(instructions).toContain(snapshot.systemPrompt);
	expect(instructions).toContain("Be brief.");
	expect(instructions).not.toContain("Previous user turn");
});

test("oversized UTF-8 prompt preserves a safe prefix and suffix without leaking into diagnostics", () => {
	const source = "A".repeat(96 * 1024) + "🌳".repeat(1024) + "Z".repeat(64 * 1024);
	const { instructions, diagnostics } = voicePersonaInstructions({}, { ...snapshot, systemPrompt: source });
	expect(Buffer.byteLength(instructions)).toBeLessThanOrEqual(64 * 1024);
	expect(instructions).toContain("[...xcsh prompt truncated...]");
	expect(instructions).toContain("A".repeat(64));
	expect(instructions).toContain("Z".repeat(64));
	expect(instructions).toContain("alpha, zeta");
	expect(diagnostics.truncated.systemPrompt).toBe(true);
	expect(JSON.stringify(diagnostics)).not.toContain("🌳");
});

test("the complete envelope and every truncated section stay within their byte budgets", () => {
	const { instructions, diagnostics } = voicePersonaInstructions(
		{ prompt: "P".repeat(256 * 1024) },
		{
			systemPrompt: "S".repeat(200 * 1024),
			tools: Array.from({ length: 1000 }, (_, index) => ({ name: `tool-${index}`, description: "D".repeat(100) })),
			history: "H".repeat(64 * 1024),
		},
	);
	expect(Buffer.byteLength(instructions)).toBeLessThanOrEqual(64 * 1024);
	expect(diagnostics.bytes.systemPrompt).toBeLessThanOrEqual(160 * 1024);
	expect(diagnostics.bytes.capabilities).toBeLessThanOrEqual(16 * 1024);
	expect(diagnostics.bytes.preferences).toBeLessThanOrEqual(32 * 1024);
	expect(diagnostics.bytes.history).toBeLessThanOrEqual(32 * 1024);
	expect(instructions).toContain("tool-0");
	expect(instructions).toContain("tool-999");
	expect(instructions).toContain("P".repeat(64));
	expect(diagnostics.truncated.instructions).toBe(true);
});

test("optional descriptions and history use only space left by identity, names, and preferences", () => {
	const tools = Array.from({ length: 250 }, (_, index) => ({
		name: `capability-${String(index).padStart(3, "0")}`,
		description: `description-${index}-${"D".repeat(300)}`,
	}));
	const { instructions, diagnostics } = voicePersonaInstructions(
		{ prompt: "Speak naturally and briefly." },
		{ systemPrompt: "You are xcsh. ".repeat(4000), tools, history: "H".repeat(32 * 1024) },
	);
	expect(Buffer.byteLength(instructions)).toBeLessThanOrEqual(64 * 1024);
	expect(instructions).toContain("xcsh's voice surface");
	expect(instructions).toContain("capability-000");
	expect(instructions).toContain("capability-249");
	expect(instructions).toContain("Speak naturally and briefly.");
	expect(diagnostics.truncated.capabilities || diagnostics.truncated.history).toBe(true);
	expect(JSON.stringify(diagnostics)).not.toContain("description-");
});
