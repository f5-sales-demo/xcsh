import { expect, it } from "bun:test";
import { assertAnthropicParityRoute } from "../scripts/anthropic-parity-route";

it("accepts the official Messages URL when the provider base is the root origin", () => {
	expect(() =>
		assertAnthropicParityRoute("https://api.anthropic.com/v1/messages", "https://api.anthropic.com"),
	).not.toThrow();
});
it("accepts the separately qualified gateway inference path", () => {
	expect(() =>
		assertAnthropicParityRoute("https://gateway.example/anthropic/v1/messages", "https://gateway.example/anthropic"),
	).not.toThrow();
});
it("rejects another origin and another API path before credentials are sent", () => {
	for (const url of [
		"https://other.example/v1/messages",
		"https://api.anthropic.com/v1/models",
		"https://api.anthropic.com//v1/messages",
	])
		expect(() => assertAnthropicParityRoute(url, "https://api.anthropic.com")).toThrow(
			"Unexpected provider request route",
		);
});
