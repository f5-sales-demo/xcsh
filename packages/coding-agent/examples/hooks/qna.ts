/**
 * Q&A extraction hook - extracts questions from assistant responses
 *
 * Demonstrates the "prompt generator" pattern:
 * 1. /qna command gets the last assistant message
 * 2. Shows a spinner while extracting (hides editor)
 * 3. Loads the result into the editor for user to fill in answers
 */
import { complete, type UserMessage } from "@f5-sales-demo/pi-ai";
import type { HookAPI } from "@f5-sales-demo/xcsh";
import { BorderedLoader } from "@f5-sales-demo/xcsh";
import systemPrompt from "./qna-system-prompt.md" with { type: "text" };

export default function (pi: HookAPI) {
	pi.registerCommand("qna", {
		description: "Extract questions from last assistant message into editor",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("qna requires interactive mode", "error");
				return;
			}

			if (!ctx.model) {
				ctx.ui.notify("No model selected", "error");
				return;
			}

			// Find the last assistant message on the current branch
			const branch = ctx.sessionManager.getBranch();
			let lastAssistantText: string | undefined;

			for (let i = branch.length - 1; i >= 0; i--) {
				const entry = branch[i];
				if (entry.type === "message") {
					const msg = entry.message;
					if ("role" in msg && msg.role === "assistant") {
						if (msg.stopReason !== "stop") {
							ctx.ui.notify(`Last assistant message incomplete (${msg.stopReason})`, "error");
							return;
						}
						const textParts = msg.content
							.filter((c): c is { type: "text"; text: string } => c.type === "text")
							.map(c => c.text);
						if (textParts.length > 0) {
							lastAssistantText = textParts.join("\n");
							break;
						}
					}
				}
			}

			if (!lastAssistantText) {
				ctx.ui.notify("No assistant messages found", "error");
				return;
			}

			// Run extraction with loader UI
			const result = await ctx.ui.custom<string | null>((tui, theme, done) => {
				const loader = new BorderedLoader(tui, theme, `Extracting questions using ${ctx.model!.id}…`);
				loader.onAbort = () => done(null);

				// Do the work
				const doExtract = async () => {
					const apiKey = await ctx.modelRegistry.getApiKey(ctx.model!);
					const userMessage: UserMessage = {
						role: "user",
						content: [{ type: "text", text: lastAssistantText! }],
						timestamp: Date.now(),
					};

					const response = await complete(
						ctx.model!,
						{ systemPrompt, messages: [userMessage] },
						{ apiKey, signal: loader.signal },
					);

					if (response.stopReason === "aborted") {
						return null;
					}

					return response.content
						.filter((c): c is { type: "text"; text: string } => c.type === "text")
						.map(c => c.text)
						.join("\n");
				};

				doExtract()
					.then(done)
					.catch(() => done(null));

				return loader;
			});

			if (result === null) {
				ctx.ui.notify("Cancelled", "info");
				return;
			}

			ctx.ui.setEditorText(result);
			ctx.ui.notify("Questions loaded. Edit and submit when ready.", "info");
		},
	});
}
