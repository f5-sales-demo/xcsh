import { describe, expect, it } from "bun:test";
import { createLoginPromptInput } from "../src/modes/components/login-prompt-input";

describe("createLoginPromptInput", () => {
	it("obscures secret prompts without changing their submitted value", () => {
		const input = createLoginPromptInput({ message: "LiteLLM API Key", secret: true });
		input.setValue("sk-secret");

		const rendered = Bun.stripANSI(input.render(80).join("\n"));
		expect(rendered).toContain("•••••••••");
		expect(rendered).not.toContain("sk-secret");
		expect(input.getValue()).toBe("sk-secret");
	});

	it("leaves non-secret prompts readable", () => {
		const input = createLoginPromptInput({ message: "LiteLLM Base URL" });
		input.setValue("https://litellm.example.test");

		expect(Bun.stripANSI(input.render(80).join("\n"))).toContain("https://litellm.example.test");
	});
});
