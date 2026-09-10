/** Offline model fixture only. The packaged agent executes the real read/write tools. */
export default function packageFixture(pi: any) {
	pi.on("session_start", async () => {
		await pi.setSessionName(process.env.XCSH_PACKAGE_SESSION_NAME ?? "Package fixture");
	});
	pi.registerProvider("package-fixture", {
		baseUrl: "http://127.0.0.1/unused",
		apiKey: "fixture-key",
		api: "package-fixture",
		models: [
			{
				id: "model",
				name: "Offline package fixture",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 128000,
				maxTokens: 8192,
			},
		],
		streamSimple(model: any, context: any) {
			const lastUser = context.messages.findLastIndex((m: any) => m.role === "user");
			const text = JSON.stringify(context.messages[lastUser]?.content ?? "");
			const marker = text.match(/PACKAGE-(?:ALPHA|BETA|CRASH|RESUME)/)?.[0] ?? "PACKAGE-UNKNOWN";
			const results = context.messages.slice(lastUser + 1).filter((m: any) => m.role === "toolResult");
			const step = results.length;
			if (results.some((result: any) => result.isError)) throw new Error("Package fixture tool failed");
			if (step >= 2 && !JSON.stringify(results[1].content).includes(marker))
				throw new Error("The real read tool did not return the written marker");
			const content =
				step < 2
					? [
							{
								type: "toolCall",
								id: `package-${marker}-${step}`,
								name: step === 0 ? "write" : "read",
								arguments:
									step === 0 ? { path: "package-check.txt", content: marker } : { path: "package-check.txt" },
							},
						]
					: [{ type: "text", text: marker, phase: "final_answer" }];
			const message = {
				role: "assistant",
				content,
				api: model.api,
				provider: model.provider,
				model: model.id,
				stopReason: step < 2 ? "toolUse" : "stop",
				timestamp: Date.now(),
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
			};
			return {
				async *[Symbol.asyncIterator]() {
					yield { type: "start", partial: { ...message, content: [] } };
					if (marker === "PACKAGE-CRASH") await Bun.sleep(750);
					yield { type: "done", reason: message.stopReason, message };
				},
				result: () => Promise.resolve(message),
			};
		},
	});
}
