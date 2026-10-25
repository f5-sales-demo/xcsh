import { expect, test } from "bun:test";
import { prompt } from "@f5-sales-demo/pi-utils";
import activePrompt from "../../src/prompts/system/plan-mode-active.md" with { type: "text" };

test("saving a review uses the persisted Plan card without a project write", () => {
	const rendered = prompt.render(activePrompt, {});
	expect(rendered).toContain("persisted in conversation history");
	expect(rendered).toContain("Do not attempt a project-file write");
	expect(rendered).toContain("saved review card is not an executable Terraform plan");
});
