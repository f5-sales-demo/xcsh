/** Offline model fixture only. The packaged agent executes the real read/write tools. */
export default function packageFixture(pi: any) {
	pi.on("session_start", async () => {
		const name = process.env.XCSH_PACKAGE_SESSION_NAME;
		if (name) await pi.setSessionName(name);
	});
	pi.registerProvider("package-fixture", {
		baseUrl: "http://127.0.0.1/unused",
		apiKey: "fixture-key",
		api: "package-fixture",
		models: [
			{
				id: "model",
				name: "Offline package fixture",
				reasoning: true,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 128000,
				maxTokens: 8192,
			},
		],
		streamSimple(model: any, context: any) {
			const lastUser = context.messages.findLastIndex((m: any) => m.role === "user");
			const text = JSON.stringify(context.messages[lastUser]?.content ?? "");
			const titleRequest = context.tools?.some((tool: any) => tool.name === "submit_title");
			const skyQuestion = text.toLowerCase().includes("why is the sky blue");
			const marker = text.match(/PACKAGE-(?:CURRENT|CRASH|RESUME|PHONE)/)?.[0] ?? "PACKAGE-UNKNOWN";
			const results = context.messages.slice(lastUser + 1).filter((m: any) => m.role === "toolResult");
			const step = results.length;
			if (results.some((result: any) => result.isError)) throw new Error("Package fixture tool failed");
			if (step >= 2 && !JSON.stringify(results[1].content).includes(marker))
				throw new Error("The real read tool did not return the written marker");
			const content = titleRequest
				? [
						{
							type: "toolCall",
							id: "package-title",
							name: "submit_title",
							arguments: { title: "Why the Sky Is Blue" },
						},
					]
				: skyQuestion
					? [
							{
								type: "text",
								text: "Blue light is scattered more strongly by Earth's atmosphere.",
								phase: "final_answer",
							},
						]
					: step < 2
						? [
								{
									type: "toolCall",
									id: `package-${marker}-${step}`,
									name: step === 0 ? "write" : "read",
									arguments:
										step === 0
											? { path: "package-check.txt", content: marker }
											: { path: "package-check.txt" },
								},
							]
						: [{ type: "text", text: marker, phase: "final_answer" }];
			const message = {
				role: "assistant",
				content,
				api: model.api,
				provider: model.provider,
				model: model.id,
				stopReason: titleRequest || (!skyQuestion && step < 2) ? "toolUse" : "stop",
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
