/**
 * Tests for secrets regex parsing, compilation, and obfuscation.
 */

import { describe, expect, it } from "bun:test";
import type { Context, Message } from "@f5-sales-demo/pi-ai";
import { builtinCredentialSecretEntries } from "../src/secrets";
import {
	deobfuscateAssistantContent,
	obfuscateMessages,
	obfuscateProviderContext,
	SecretObfuscator,
} from "../src/secrets/obfuscator";
import { compileSecretRegex } from "../src/secrets/regex";

describe("compileSecretRegex", () => {
	it("compiles pattern with explicit flags and enforces global scanning", () => {
		const regex = compileSecretRegex("api[_-]?key\\s*=\\s*\\w+", "gi");
		expect(regex.source).toBe("api[_-]?key\\s*=\\s*\\w+");
		expect(regex.flags).toBe("gi");
	});

	it("adds global flag when not provided", () => {
		const regex = compileSecretRegex("api[_-]?key\\s*=\\s*\\w+", "i");
		expect(regex.source).toBe("api[_-]?key\\s*=\\s*\\w+");
		expect(regex.flags).toBe("gi");
	});

	it("defaults to global flag when no flags provided", () => {
		const regex = compileSecretRegex("api[_-]?key\\s*=\\s*\\w+");
		expect(regex.source).toBe("api[_-]?key\\s*=\\s*\\w+");
		expect(regex.flags).toBe("g");
	});

	it("rejects invalid regex pattern", () => {
		expect(() => compileSecretRegex("(")).toThrow();
	});
	it("rejects invalid regex flags", () => {
		expect(() => compileSecretRegex("x", "zz")).toThrow();
	});
});

describe("SecretObfuscator regex behavior", () => {
	it("obfuscates and deobfuscates regex matches with flags", () => {
		const obfuscator = new SecretObfuscator([{ type: "regex", content: "api[_-]?key\\s*=\\s*\\w+", flags: "i" }]);
		const original = "API_KEY=abc and api-key=def";
		const obfuscated = obfuscator.obfuscate(original);
		expect(obfuscated).not.toEqual(original);
		expect(obfuscator.deobfuscate(obfuscated)).toEqual(original);
	});

	it("supports bare regex patterns without explicit flags", () => {
		const obfuscator = new SecretObfuscator([{ type: "regex", content: "api[_-]?key\\s*=\\s*\\w+" }]);
		const text = "api_key=abc and API_KEY=def";
		const obfuscated = obfuscator.obfuscate(text);
		expect(obfuscated).not.toEqual(text);
		expect(obfuscator.deobfuscate(obfuscated)).toEqual(text);
	});
	it("deobfuscates placeholders through object payloads", () => {
		const obfuscator = new SecretObfuscator([{ type: "regex", content: "api[_-]?key\\s*=\\s*\\w+", flags: "i" }]);
		const original = {
			cmd: "API_KEY=abc and api-key=def",
			status: "ok",
		};
		const obfuscated = {
			cmd: obfuscator.obfuscate(original.cmd),
			status: original.status,
		};
		expect(obfuscator.deobfuscateObject(obfuscated)).toEqual({
			cmd: original.cmd,
			status: original.status,
		});
	});
});

describe("provider-boundary secret protection", () => {
	it("obfuscates every provider-visible string without mutating the source context", () => {
		const secret = "SUPER_SECRET_TOKEN_12345";
		const obfuscator = new SecretObfuscator([{ type: "plain", content: secret }]);
		const context = {
			systemPrompt: `system contains ${secret}`,
			messages: [
				{ role: "developer", content: `reminder ${secret}`, timestamp: 1 },
				{
					role: "assistant",
					content: [
						{ type: "thinking", thinking: `opaque ${secret}` },
						{
							type: "toolCall",
							id: "call-1",
							name: "edit",
							arguments: { nested: { value: secret } },
						},
					],
					api: "openai-responses",
					provider: "openai",
					model: "test",
					usage: {
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 0,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					},
					stopReason: "stop",
					timestamp: 2,
				},
			],
			tools: [
				{
					name: "secret_tool",
					description: `description ${secret}`,
					parameters: {
						type: "object",
						properties: { value: { type: "string", description: `schema ${secret}` } },
					},
				},
			],
		} as unknown as Context;

		const protectedContext = obfuscateProviderContext(obfuscator, context);
		expect(JSON.stringify(protectedContext)).not.toContain(secret);
		expect(JSON.stringify(context)).toContain(secret);
	});

	it("obfuscates nested message strings, including tool arguments", () => {
		const secret = "SUPER_SECRET_TOKEN_12345";
		const obfuscator = new SecretObfuscator([{ type: "plain", content: secret }]);
		const messages = [
			{
				role: "assistant",
				content: [{ type: "toolCall", id: "call-1", name: "write", arguments: { payload: { secret } } }],
			},
		] as unknown as Message[];

		const protectedMessages = obfuscateMessages(obfuscator, messages);
		expect(JSON.stringify(protectedMessages)).not.toContain(secret);
		expect(JSON.stringify(messages)).toContain(secret);
	});

	it("restores visible assistant content but leaves opaque thinking untouched", () => {
		const secret = "SUPER_SECRET_TOKEN_12345";
		const obfuscator = new SecretObfuscator([{ type: "plain", content: secret }]);
		const placeholder = obfuscator.obfuscate(secret);
		const content = [
			{ type: "thinking", thinking: `opaque ${placeholder}` },
			{ type: "text", text: `visible ${placeholder}` },
			{ type: "toolCall", id: "call-1", name: "edit", arguments: { old_text: placeholder } },
		] as Parameters<typeof deobfuscateAssistantContent>[1];

		const restored = deobfuscateAssistantContent(obfuscator, content);
		expect(restored[0]).toEqual(content[0]);
		expect(JSON.stringify(restored[1])).toContain(secret);
		expect(JSON.stringify(restored[2])).toContain(secret);
	});
});

describe("built-in credential protection", () => {
	it("round-trips unconfigured credential-shaped values byte-exact", () => {
		const obfuscator = new SecretObfuscator(builtinCredentialSecretEntries());
		const tokens = [`ghp_${"aB1".repeat(12)}`, `glpat-${"xY2-".repeat(5)}`, `sk-${"a1B-c2D".repeat(7)}e3F`];

		for (const token of tokens) {
			const source = `API_KEY=${token}`;
			const providerView = obfuscator.obfuscate(source);
			expect(providerView).not.toContain(token);
			expect(obfuscator.obfuscate(providerView)).toBe(providerView);
			expect(obfuscator.deobfuscateObject({ old_text: providerView })).toEqual({ old_text: source });
		}
	});
});
