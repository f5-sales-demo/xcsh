import type { AgentMessage } from "@f5-sales-demo/pi-agent-core";
import { type AssistantMessage, type Context, streamSimple } from "@f5-sales-demo/pi-ai";
import { prompt } from "@f5-sales-demo/pi-utils";
import btwUserPrompt from "../../prompts/system/btw-user.md" with { type: "text" };
import { finalAnswerText } from "../../session/final-answer";
import { toReasoningEffort } from "../../thinking";
import { BtwPanelComponent } from "../components/btw-panel";
import type { InteractiveModeContext } from "../types";

interface BtwRequest {
	component: BtwPanelComponent;
	abortController: AbortController;
	question: string;
	state: "running" | "settled";
}

export class BtwController {
	#activeRequest: BtwRequest | undefined;
	readonly #streamFn: typeof streamSimple;

	constructor(
		private readonly ctx: InteractiveModeContext,
		options?: { streamFn?: typeof streamSimple },
	) {
		this.#streamFn = options?.streamFn ?? streamSimple;
	}

	hasActiveRequest(): boolean {
		return this.#activeRequest !== undefined;
	}

	handleEscape(): boolean {
		if (!this.#activeRequest) return false;
		if (this.#activeRequest.state === "running") {
			this.ctx.showStatus("/btw is still running; use the configured interrupt key to stop it.");
			return true;
		}
		this.#closeActiveRequest({ abort: false });
		return true;
	}

	handleInterrupt(): boolean {
		const request = this.#activeRequest;
		if (request?.state !== "running") return false;
		request.state = "settled";
		request.abortController.abort();
		request.component.markAborted();
		return true;
	}

	/**
	 * A running side request owns a foreground-only panel. Refuse background
	 * transfer until it settles (or is explicitly interrupted) so its completion
	 * is never hidden or accidentally abandoned. A settled panel can be closed.
	 */
	prepareForBackground(): boolean {
		if (!this.#activeRequest) return true;
		if (this.#activeRequest.state === "running") {
			this.ctx.showWarning(
				"/btw is still running; wait for it or use the configured interrupt key before backgrounding.",
			);
			return false;
		}
		this.#closeActiveRequest({ abort: false });
		return true;
	}

	dispose(): void {
		this.#closeActiveRequest({ abort: true });
	}

	async start(question: string): Promise<void> {
		const trimmedQuestion = question.trim();
		if (!trimmedQuestion) {
			this.ctx.showStatus("Usage: /btw <question>");
			return;
		}

		const model = this.ctx.session.model;
		if (!model) {
			this.ctx.showError("No active model available for /btw.");
			return;
		}

		if (this.#activeRequest?.state === "running") {
			this.ctx.showWarning(
				`/btw is already answering “${this.#activeRequest.question}”. Interrupt it before retrying.`,
			);
			return;
		}
		this.#closeActiveRequest({ abort: false });

		const request: BtwRequest = {
			component: new BtwPanelComponent({ question: trimmedQuestion, tui: this.ctx.ui }),
			abortController: new AbortController(),
			question: trimmedQuestion,
			state: "running",
		};
		this.ctx.btwContainer.clear();
		this.ctx.btwContainer.addChild(request.component);
		this.ctx.ui.requestRender();
		this.#activeRequest = request;
		void this.#runRequest(request, model);
	}

	async #runRequest(
		request: BtwRequest,
		model: NonNullable<InteractiveModeContext["session"]["model"]>,
	): Promise<void> {
		try {
			const apiKey = await this.ctx.session.modelRegistry.getApiKey(model, this.ctx.session.sessionId);
			if (!apiKey) {
				throw new Error(`No API key for provider: ${model.provider}`);
			}

			const llmMessages = await this.ctx.session.convertMessagesToLlm(
				[...this.#buildMessageSnapshot(), this.#buildQuestionMessage(request.question)],
				request.abortController.signal,
			);
			const context: Context = {
				systemPrompt: this.ctx.session.systemPrompt,
				messages: llmMessages,
			};
			const options = this.ctx.session.prepareSimpleStreamOptions({
				apiKey,
				sessionId: this.ctx.session.sessionId,
				reasoning: toReasoningEffort(this.ctx.session.thinkingLevel),
				serviceTier: this.ctx.session.serviceTier,
				signal: request.abortController.signal,
				toolChoice: "none",
			});
			const stream = this.#streamFn(model, context, options);

			for await (const event of stream) {
				if (!this.#isActiveRequest(request)) {
					return;
				}
				if (event.type === "text_delta") {
					request.component.appendText(event.delta);
					continue;
				}
				if (event.type === "done") {
					const finalText = this.#assistantText(event.message);
					if (finalText) {
						request.component.setAnswer(finalText);
					}
					request.component.markComplete();
					request.state = "settled";
					return;
				}
				if (event.type === "error") {
					if (event.reason === "aborted" || request.abortController.signal.aborted) {
						request.component.markAborted();
					} else {
						request.component.markError(
							this.#assistantText(event.error) || event.error.errorMessage || "BTW request failed.",
						);
					}
					request.state = "settled";
					return;
				}
			}
		} catch (error) {
			if (!this.#isActiveRequest(request)) {
				return;
			}
			if (request.abortController.signal.aborted) {
				request.component.markAborted();
				request.state = "settled";
				return;
			}
			request.component.markError(error instanceof Error ? error.message : String(error));
			request.state = "settled";
		}
	}

	#buildQuestionMessage(question: string): AgentMessage {
		return {
			role: "user",
			content: [
				{
					type: "text",
					text: prompt.render(btwUserPrompt, { question }),
				},
			],
			attribution: "user",
			timestamp: Date.now(),
		};
	}

	#buildMessageSnapshot(): AgentMessage[] {
		const messages = this.ctx.session.messages.slice();
		if (!this.ctx.session.isStreaming || !this.ctx.streamingMessage) {
			return messages;
		}
		const streamingText = this.ctx.extractAssistantText(this.ctx.streamingMessage);
		const lastMessage = messages.at(-1);
		if (!streamingText) {
			return lastMessage?.role === "assistant" ? messages.slice(0, -1) : messages;
		}
		const normalizedStreamingMessage: AssistantMessage = {
			...this.ctx.streamingMessage,
			content: [{ type: "text", text: streamingText }],
		};
		if (lastMessage?.role === "assistant") {
			return [...messages.slice(0, -1), normalizedStreamingMessage];
		}
		return [...messages, normalizedStreamingMessage];
	}

	#assistantText(message: AssistantMessage): string {
		return finalAnswerText(message).trim();
	}

	#closeActiveRequest(options: { abort: boolean }): void {
		const request = this.#activeRequest;
		if (!request) return;
		this.#activeRequest = undefined;
		if (options.abort) {
			request.abortController.abort();
		}
		request.component.close();
		this.ctx.btwContainer.clear();
		this.ctx.ui.requestRender();
	}

	#isActiveRequest(request: BtwRequest): boolean {
		return this.#activeRequest === request;
	}
}
