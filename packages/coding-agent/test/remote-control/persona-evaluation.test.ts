import { expect, test } from "bun:test";
import { scorePersonaResponse } from "../../src/remote-control/persona-evaluation";

const memory = "The user works on F5 Distributed Cloud and prefers evidence-backed delivery.";

test("persona scoring accepts specific persisted knowledge without retaining text", () => {
	const score = scorePersonaResponse(
		"You work on F5 Distributed Cloud and prefer evidence-backed delivery. This is stored project memory and may be stale.",
		memory,
	);
	expect(score.passed).toBe(true);
	expect(score.knowledgeTermMatches).toBeGreaterThanOrEqual(2);
	expect(JSON.stringify(score)).not.toContain("Distributed Cloud");
});

test.each([
	"I have no details about you.",
	"I only know about this current chat.",
	"I'm ChatGPT, and I know that you work on F5 Distributed Cloud.",
])("persona scoring rejects missing knowledge or generic identity: %s", response => {
	expect(scorePersonaResponse(response, memory).passed).toBe(false);
});

test("persona scoring cannot pass without an applicable memory summary", () => {
	expect(scorePersonaResponse("You work on F5 Distributed Cloud.", "").passed).toBe(false);
});

test("honest unknown boundaries do not erase specific persisted knowledge", () => {
	const score = scorePersonaResponse(
		"Stored project memory says you work on Distributed Cloud; I don't know your preferred name.",
		memory,
	);
	expect(score.passed).toBe(true);
	expect(score.deniedKnownContext).toBe(false);
});
