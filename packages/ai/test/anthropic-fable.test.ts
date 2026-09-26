import { describe, expect, it } from "bun:test";
import { Type } from "@sinclair/typebox";
import { Effort } from "../src/model-thinking";
import { getBundledModel } from "../src/models";
import {
	buildAnthropicClientOptions,
	buildAnthropicHeaders,
	isAnthropicPermanentErrorMessage,
	isProviderRetryableError,
	rewriteAnthropicPermanentError,
	streamAnthropic,
} from "../src/providers/anthropic";
import { mapOptionsForApi } from "../src/stream";
import type { Context, Model, Tool } from "../src/types";

type FablePayload = {
	thinking?: { type?: string };
	output_config?: { effort?: string };
	temperature?: number;
	tool_choice?: { type?: string; name?: string };
	tools?: Array<{ name: string; strict?: boolean; input_schema: Record<string, unknown> }>;
};

const context: Context = {
	messages: [{ role: "user", content: "Test Fable", timestamp: 1 }],
};

function fable(id: "claude-fable-5" | "claude-fable-5-1" = "claude-fable-5-1") {
	return getBundledModel("anthropic", id) as Model<"anthropic-messages">;
}

async function capturePayload(
	model: Model<"anthropic-messages">,
	options: Parameters<typeof streamAnthropic>[2] = {},
	requestContext: Context = context,
): Promise<FablePayload> {
	const controller = new AbortController();
	controller.abort();
	const { promise, resolve } = Promise.withResolvers<FablePayload>();
	streamAnthropic(model, requestContext, {
		apiKey: "sk-ant-api-test",
		isOAuth: false,
		signal: controller.signal,
		...options,
		onPayload: payload => {
			resolve(payload as FablePayload);
			return options.onPayload?.(payload, model);
		},
	});
	return promise;
}

describe("Claude Fable transport", () => {
	it.each(["claude-fable-5", "claude-fable-5-1"] as const)(
		"keeps adaptive thinking on at high by default for %s and omits temperature",
		async id => {
			const options = mapOptionsForApi(fable(id), { temperature: 0 });
			const payload = await capturePayload(fable(id), options);

			expect(payload.thinking).toEqual({ type: "adaptive" });
			expect(payload.output_config).toEqual({ effort: "high" });
			expect(payload.temperature).toBeUndefined();
		},
	);

	it("maps xcsh minimal effort to Anthropic low", async () => {
		const payload = await capturePayload(fable(), mapOptionsForApi(fable(), { reasoning: Effort.Minimal }));
		expect(payload.output_config).toEqual({ effort: "low" });
	});

	it("rejects disabled thinking", () => {
		expect(() => mapOptionsForApi(fable(), { reasoning: "none" as Effort })).toThrow(
			/Thinking effort none is not supported by anthropic\/claude-fable-5-1/,
		);
	});

	it.each(["any", { type: "tool", name: "todo_write" }] as const)(
		"normalizes forced tool choice to auto while preserving adaptive thinking and strict schemas",
		async toolChoice => {
			const tool: Tool = {
				name: "todo_write",
				description: "Write todos",
				strict: true,
				parameters: Type.Object({ title: Type.Optional(Type.String()) }),
			};
			const payload = await capturePayload(
				fable(),
				mapOptionsForApi(fable(), { reasoning: Effort.High, toolChoice }),
				{ ...context, tools: [tool] },
			);

			expect(payload.tool_choice).toEqual({ type: "auto" });
			expect(payload.thinking).toEqual({ type: "adaptive" });
			if (typeof toolChoice === "object") {
				expect(payload.tools?.[0]?.strict).toBe(true);
				expect(payload.tools?.[0]?.input_schema).toMatchObject({ additionalProperties: false });
			}
		},
	);

	it("uses the native Anthropic header for API keys and Claude Code bearer headers for OAuth", () => {
		const apiKeyHeaders = buildAnthropicHeaders({ apiKey: "sk-ant-api-test" });
		const oauthHeaders = buildAnthropicHeaders({ apiKey: "sk-ant-oat-test", isOAuth: true });

		expect(apiKeyHeaders["X-Api-Key"]).toBe("sk-ant-api-test");
		expect(apiKeyHeaders.Authorization).toBeUndefined();
		expect(oauthHeaders.Authorization).toBe("Bearer sk-ant-oat-test");
		expect(oauthHeaders["X-Api-Key"]).toBeUndefined();
		expect(oauthHeaders["User-Agent"]).toBe("claude-cli/2.1.283 (external, cli)");
	});

	it("leaves retries to the classified provider loop", () => {
		const options = buildAnthropicClientOptions({ model: fable(), apiKey: "sk-ant-api-test" });
		expect(options.maxRetries).toBe(0);
	});

	it("classifies entitlement and obsolete-client failures as permanent with actionable redacted guidance", () => {
		for (const message of [
			'429 {"type":"error","error":{"type":"credits_required","message":"token-secret"}}',
			"obsolete_client: this version of Claude Code is no longer supported",
		]) {
			expect(isAnthropicPermanentErrorMessage(message)).toBe(true);
			expect(isProviderRetryableError(new Error(message))).toBe(false);
		}
		expect(rewriteAnthropicPermanentError("credits_required token-secret")).toBe(
			"Anthropic access requires credits for this model. Check the account's Claude subscription or API billing entitlement, then retry.",
		);
		expect(rewriteAnthropicPermanentError("obsolete_client token-secret")).toBe(
			"Anthropic rejected this xcsh client version. Upgrade xcsh to the latest release, then retry.",
		);
	});

	it.each([
		{
			code: "credits_required",
			message: "secret-entitlement-detail",
			expected: "Anthropic access requires credits for this model.",
		},
		{
			code: "obsolete_client",
			message: "This version of Claude Code is no longer supported secret-client-detail",
			expected: "Upgrade xcsh to the latest release",
		},
	])("makes one request and redacts $code failures", async ({ code, message, expected }) => {
		let requestCount = 0;
		const server = Bun.serve({
			port: 0,
			fetch: () => {
				requestCount++;
				return Response.json({ type: "error", error: { type: code, message } }, { status: 429 });
			},
		});
		try {
			const model = { ...fable(), baseUrl: `http://127.0.0.1:${server.port}` };
			const stream = streamAnthropic(model, context, { apiKey: "sk-ant-api-test" });
			for await (const _event of stream) {
				// Drain the stream so the terminal error is available from result().
			}
			const result = await stream.result();
			expect(requestCount).toBe(1);
			expect(result.errorMessage).toContain(expected);
			expect(result.errorMessage).not.toContain(message);
		} finally {
			server.stop(true);
		}
	});
});
