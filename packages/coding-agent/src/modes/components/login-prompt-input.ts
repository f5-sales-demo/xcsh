import type { OAuthPrompt } from "@f5-sales-demo/pi-ai";
import { Input } from "@f5-sales-demo/pi-tui";

/** Build a login input with the display policy declared by its prompt contract. */
export function createLoginPromptInput(prompt: Partial<OAuthPrompt>): Input {
	const input = new Input();
	input.setMasked(prompt.secret === true);
	return input;
}
