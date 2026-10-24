/** Native history mapping adapted from MIT pi-kiro 0.1.3 (Hongyi Lyu).
 * AWS event-stream framing is decoded and checked directly; see kiro-LICENSE. */
import type { AssistantMessage, Context, Message, Model, StreamOptions, TextContent, ToolCall } from "../types";
import { AssistantMessageEventStream } from "../utils/event-stream";
import type { KiroCredentials } from "../utils/oauth/kiro-credentials";
import { kiroEndpoint } from "./kiro-service";
export interface KiroOptions extends StreamOptions {}
function text(message: Message): string {
	return typeof message.content === "string"
		? message.content
		: message.content
				.filter(c => c.type === "text")
				.map(c => (c as TextContent).text)
				.join("\n");
}
interface NativeUser {
	content: string;
	modelId: string;
	origin: string;
	images?: { format: string; source: { bytes: string } }[];
	userInputMessageContext: {
		tools?: { toolSpecification: { name: string; description: string; inputSchema: { json: unknown } } }[];
		toolResults?: { toolUseId: string; status: string; content: { text: string }[] }[];
	};
}
interface NativeHistory {
	userInputMessage?: NativeUser;
	assistantResponseMessage?: { content: string; toolUses?: { name: string; toolUseId: string; input: unknown }[] };
}
/** Keep service IDs verbatim, include tools/results, and place the system text once. */
export function buildKiroRequest(
	model: Model<"kiro-api">,
	context: Context,
	profileArn: string,
	conversationId: string,
) {
	const history: NativeHistory[] = [];
	let systemUsed = false;
	const makeUser = (message?: Message): NativeUser => {
		let content = message ? text(message) : "Continue.";
		if (context.systemPrompt && !systemUsed) {
			content = `${context.systemPrompt}\n\n${content}`;
			systemUsed = true;
		}
		const images =
			message && Array.isArray(message.content)
				? message.content
						.filter(c => c.type === "image")
						.map(c => ({ format: c.mimeType.split("/")[1], source: { bytes: c.data } }))
				: [];
		return {
			content: content || "Continue.",
			modelId: model.id,
			origin: "KIRO_CLI",
			...(images.length ? { images } : {}),
			userInputMessageContext: {},
		};
	};
	let current: NativeUser | undefined;
	for (const message of context.messages) {
		if (message.role === "assistant") {
			if (current) {
				history.push({ userInputMessage: current });
				current = undefined;
			}
			const tools = message.content
				.filter(c => c.type === "toolCall")
				.map(c => ({ name: c.name, toolUseId: c.id, input: c.arguments }));
			history.push({
				assistantResponseMessage: { content: text(message), ...(tools.length ? { toolUses: tools } : {}) },
			});
		} else if (message.role === "toolResult") {
			current ??= makeUser();
			current.userInputMessageContext.toolResults ??= [];
			current.userInputMessageContext.toolResults.push({
				toolUseId: message.toolCallId,
				status: message.isError ? "error" : "success",
				content: [{ text: text(message) }],
			});
		} else {
			if (current) current.content += `\n\n${text(message)}`;
			else current = makeUser(message);
		}
	}
	current ??= makeUser();
	if (context.tools?.length)
		current.userInputMessageContext.tools = context.tools.map(tool => ({
			toolSpecification: { name: tool.name, description: tool.description, inputSchema: { json: tool.parameters } },
		}));
	return {
		conversationState: {
			chatTriggerType: "MANUAL",
			agentTaskType: "vibe",
			conversationId,
			currentMessage: { userInputMessage: current },
			...(history.length ? { history } : { history: [] }),
		},
		profileArn,
		agentMode: "vibe",
	};
}
function crc32(bytes: Uint8Array): number {
	let value = 0xffffffff;
	for (const byte of bytes) {
		value ^= byte;
		for (let i = 0; i < 8; i++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
	}
	return (value ^ 0xffffffff) >>> 0;
}
interface Frame {
	type: string;
	messageType: string;
	body: Record<string, any>;
}
/** Decode AWS event-stream frames without searching arbitrary bytes for JSON. */
class FrameDecoder {
	buffer = new Uint8Array(0);
	feed(chunk: Uint8Array): Frame[] {
		const merged = new Uint8Array(this.buffer.length + chunk.length);
		merged.set(this.buffer);
		merged.set(chunk, this.buffer.length);
		this.buffer = merged;
		const frames: Frame[] = [];
		while (this.buffer.length >= 12) {
			const view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
			const length = view.getUint32(0);
			const headersLength = view.getUint32(4);
			if (length < 16 || length > 16 * 1024 * 1024 || headersLength > length - 16)
				throw new Error("Malformed Kiro event frame");
			if (crc32(this.buffer.subarray(0, 8)) !== view.getUint32(8)) throw new Error("Corrupt Kiro event prelude");
			if (this.buffer.length < length) break;
			const bytes = this.buffer.subarray(0, length);
			if (crc32(bytes.subarray(0, length - 4)) !== view.getUint32(length - 4))
				throw new Error("Corrupt Kiro event checksum");
			const headers: Record<string, string> = {};
			let p = 12;
			const end = 12 + headersLength;
			const decoder = new TextDecoder("utf-8", { fatal: true });
			while (p < end) {
				const keyLength = bytes[p++];
				if (p + keyLength + 1 > end) throw new Error("Malformed Kiro event headers");
				const key = decoder.decode(bytes.subarray(p, p + keyLength));
				p += keyLength;
				const type = bytes[p++];
				if (type !== 7 || p + 2 > end) throw new Error("Unsupported Kiro event header");
				const valueLength = view.getUint16(p);
				p += 2;
				if (p + valueLength > end) throw new Error("Malformed Kiro event header value");
				headers[key] = decoder.decode(bytes.subarray(p, p + valueLength));
				p += valueLength;
			}
			const body = JSON.parse(decoder.decode(bytes.subarray(end, length - 4)));
			if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Malformed Kiro event body");
			frames.push({
				type: headers[":event-type"] ?? headers[":exception-type"] ?? "",
				messageType: headers[":message-type"] ?? "event",
				body,
			});
			this.buffer = this.buffer.slice(length);
		}
		return frames;
	}
	finish() {
		if (this.buffer.length) throw new Error("Incomplete Kiro event stream");
	}
}
export function streamKiro(
	model: Model<"kiro-api">,
	context: Context,
	options: KiroOptions = {},
): AssistantMessageEventStream {
	const stream = new AssistantMessageEventStream();
	const output: AssistantMessage = {
		role: "assistant",
		content: [],
		api: "kiro-api",
		provider: "kiro",
		model: model.id,
		timestamp: Date.now(),
		stopReason: "stop",
		usage: {
			billing: "subscription",
			costKnown: false,
			tokenSource: "estimated",
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
	};
	void (async () => {
		let reader: Pick<ReadableStreamDefaultReader<Uint8Array>, "read" | "cancel" | "releaseLock"> | undefined;
		const signal = options.signal
			? AbortSignal.any([options.signal, AbortSignal.timeout(300000)])
			: AbortSignal.timeout(300000);
		const cancel = () => {
			void reader?.cancel().catch(() => {});
		};
		try {
			signal.throwIfAborted();
			let credentials: KiroCredentials;
			try {
				credentials = JSON.parse(options.apiKey ?? "");
			} catch {
				throw new Error("Kiro credentials required. Run /login kiro.");
			}
			if (!credentials.access || !credentials.profileArn || !credentials.serviceRegion)
				throw new Error("Select a Kiro account/profile with /login kiro.");
			const binding = model.kiroConnection;
			if (
				binding &&
				(credentials.accountId !== binding.accountId ||
					credentials.profileArn !== binding.profileArn ||
					credentials.serviceRegion !== binding.serviceRegion)
			)
				throw new Error(
					"Kiro account/profile differs from this model catalog. Reconnect or choose the intended catalog.",
				);
			const endpoint = `${kiroEndpoint(credentials.serviceRegion)}/generateAssistantResponse`;
			if (model.baseUrl !== endpoint)
				throw new Error("Kiro model region differs from the selected account/profile. Reconnect with /login kiro.");
			const request = buildKiroRequest(
				model,
				context,
				credentials.profileArn,
				options.sessionId ?? crypto.randomUUID(),
			);
			options.onPayload?.(request);
			const response = await (options.fetch ?? globalThis.fetch)(endpoint, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/vnd.amazon.eventstream",
					Authorization: `Bearer ${credentials.access}`,
					"User-Agent": "xcsh-kiro",
					"x-amzn-codewhisperer-optout": "true",
				},
				body: JSON.stringify(request),
				signal,
			});
			if (!response.ok)
				throw new Error(
					`Kiro inference HTTP ${response.status}. ${response.status === 401 || response.status === 403 ? "Reconnect with /login kiro." : "Retry when the service is available."}`,
				);
			if (!response.body) throw new Error("Kiro returned no response stream");
			stream.push({ type: "start", partial: output });
			reader = response.body.getReader();
			signal.addEventListener("abort", cancel, { once: true });
			const decoder = new FrameDecoder();
			let textIndex: number | undefined;
			let currentTool: string | undefined;
			const tools = new Map<string, { index: number; input: string; ended: boolean }>();
			let observed = false;
			const endTool = (id: string) => {
				const state = tools.get(id);
				if (!state || state.ended) throw new Error("Malformed Kiro tool boundary");
				const tool = output.content[state.index] as ToolCall;
				const args = JSON.parse(state.input || "{}");
				if (!args || typeof args !== "object" || Array.isArray(args))
					throw new Error("Malformed Kiro tool arguments");
				tool.arguments = args;
				state.ended = true;
				stream.push({ type: "toolcall_end", contentIndex: state.index, toolCall: tool, partial: output });
			};
			while (true) {
				signal.throwIfAborted();
				const chunk = await reader!.read();
				signal.throwIfAborted();
				if (chunk.done) break;
				for (const frame of decoder.feed(chunk.value)) {
					const b = frame.body;
					if (
						frame.messageType === "exception" ||
						frame.messageType === "error" ||
						/exception|error/i.test(frame.type) ||
						b.error
					)
						throw new Error("Kiro service failed during streaming. Retry when the service is available.");
					if (typeof b.content === "string") {
						observed = true;
						if (textIndex === undefined) {
							textIndex = output.content.length;
							output.content.push({ type: "text", text: "" });
							stream.push({ type: "text_start", contentIndex: textIndex, partial: output });
						}
						(output.content[textIndex] as TextContent).text += b.content;
						stream.push({ type: "text_delta", contentIndex: textIndex, delta: b.content, partial: output });
					}
					if (frame.type === "toolUseEvent" || b.toolUseId || b.input !== undefined) {
						observed = true;
						const id = typeof b.toolUseId === "string" ? b.toolUseId : currentTool;
						if (!id) throw new Error("Kiro tool input without an ID");
						if (!tools.has(id)) {
							if (typeof b.name !== "string") throw new Error("Kiro tool call missing name");
							const index = output.content.length;
							output.content.push({ type: "toolCall", id, name: b.name, arguments: {} });
							tools.set(id, { index, input: "", ended: false });
							stream.push({ type: "toolcall_start", contentIndex: index, partial: output });
						}
						currentTool = id;
						const state = tools.get(id)!;
						if (state.ended) throw new Error("Kiro tool input after completion");
						const delta = typeof b.input === "string" ? b.input : b.input ? JSON.stringify(b.input) : "";
						state.input += delta;
						if (delta) stream.push({ type: "toolcall_delta", contentIndex: state.index, delta, partial: output });
						if (b.stop === true) endTool(id);
					}
					const usage = b.usage;
					if (
						usage &&
						Number.isFinite(usage.inputTokens) &&
						usage.inputTokens >= 0 &&
						Number.isFinite(usage.outputTokens) &&
						usage.outputTokens >= 0
					) {
						output.usage.input = usage.inputTokens;
						output.usage.output = usage.outputTokens;
						output.usage.tokenSource = "reported";
					}
				}
			}
			decoder.finish();
			if (!observed) throw new Error("Kiro returned an empty stream");
			for (const state of tools.values()) if (!state.ended) throw new Error("Incomplete Kiro tool call");
			if (textIndex !== undefined)
				stream.push({
					type: "text_end",
					contentIndex: textIndex,
					content: (output.content[textIndex] as TextContent).text,
					partial: output,
				});
			if (output.usage.tokenSource === "estimated") {
				output.usage.input = Math.ceil(JSON.stringify(request).length / 4);
				output.usage.output = Math.ceil(JSON.stringify(output.content).length / 4);
			}
			output.usage.totalTokens = output.usage.input + output.usage.output;
			output.stopReason = tools.size ? "toolUse" : "stop";
			stream.push({ type: "done", reason: output.stopReason, message: output });
		} catch (error) {
			output.stopReason = signal.aborted ? "aborted" : "error";
			output.errorMessage = signal.aborted
				? "Kiro request cancelled"
				: error instanceof Error
					? error.message
					: "Kiro inference failed";
			stream.push({ type: "error", reason: output.stopReason, error: output });
		} finally {
			signal.removeEventListener("abort", cancel);
			await reader?.cancel().catch(() => {});
			reader?.releaseLock();
			stream.end();
		}
	})();
	return stream;
}
