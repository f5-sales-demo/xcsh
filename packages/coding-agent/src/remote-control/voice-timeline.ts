/** Canonical realtime history reducer. Source provenance is recorded in NOTICE.md. */
export type TimelineInput =
	| { type: "start"; sessionId?: string | null }
	| { type: "close" | "error" | "handoff" }
	| { type: "turnStarted" | "turnCompleted"; turnId: string }
	| { type: "turnAborted"; turnId?: string }
	| { type: "transcript"; role: "user" | "assistant"; text: string; done: boolean }
	| { type: "item"; turnId: string; item: Record<string, unknown> & { id: string; type: string }; completed: boolean }
	| { type: "textDelta"; turnId: string; itemId: string; delta: string };
export interface TimelineItem extends Record<string, unknown> {
	id: string;
	realtimeSessionId: string;
	type: string;
}
export interface TimelineEffects {
	before: boolean;
	items: TimelineItem[];
	stream?: { startedItem?: TimelineItem; itemId: string; delta: string };
}
type Role = "user" | "assistant";
type Segment = TimelineItem & { role: Role; text: string };
type Presentation = { type: "wholeItem" | "inlineMarkdown" } | { type: "inlineVisualization"; index: number };
// Rust str::trim_start uses Unicode White_Space, which differs from JavaScript for NEL and BOM.
const whitespace = "[\\u0009-\\u000d\\u0020\\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]";
const leading = new RegExp(`^${whitespace}+`, "u");
const trailing = new RegExp(`${whitespace}+$`, "u");
const trimStart = (text: string) => text.replace(leading, "");
const trim = (text: string) => trimStart(text).replace(trailing, "");

export class VoiceTimeline {
	#session?: string;
	#turn?: string;
	#turnSessions = new Map<string, string>();
	#promoted = new Set<string>();
	#handoffs: string[] = [];
	#segments = new Map<Role, Segment>();
	#streaming?: { id: string; text: string };
	#failed = false;
	constructor(private readonly id: () => string = () => Bun.randomUUIDv7()) {}
	observe(event: TimelineInput): TimelineEffects {
		const effects: TimelineEffects = { before: false, items: [] };
		if (event.type === "turnStarted") this.#turn = event.turnId;
		if (
			(event.type === "turnCompleted" && event.turnId === this.#turn) ||
			(event.type === "turnAborted" && (event.turnId == null || event.turnId === this.#turn))
		)
			this.#turn = undefined;
		if (event.type === "start") {
			const sessionId = event.sessionId ?? this.id();
			if (this.#session !== sessionId) {
				this.#seal(effects.items, false);
				this.#session = sessionId;
				this.#failed = false;
				effects.items.push(this.#item(sessionId, "realtimeSessionStarted"));
			}
			if (this.#turn !== undefined) this.#turnSessions.set(this.#turn, sessionId);
		} else if (event.type === "turnStarted") {
			const sessionId = this.#handoffs.shift() ?? this.#session;
			if (sessionId !== undefined && !this.#turnSessions.has(event.turnId))
				this.#turnSessions.set(event.turnId, sessionId);
		} else if (event.type === "item" || event.type === "textDelta") {
			if (this.#session === undefined && !this.#turnSessions.has(event.turnId)) return effects;
			if (event.type === "textDelta") {
				if (this.#streaming?.id !== event.itemId) this.#streaming = { id: event.itemId, text: "" };
				this.#bounded(this.#streaming.text, event.delta);
				this.#streaming.text += event.delta;
				this.#assistant(effects.items, event.turnId, event.itemId, this.#streaming.text);
			} else {
				const { item, completed, turnId } = event;
				if (item.type === "userMessage") {
					effects.before = true;
					const content = Array.isArray(item.content) ? (item.content as Record<string, unknown>[]) : [];
					const single =
						content.length === 1 && content[0]?.type === "text" && typeof content[0].text === "string"
							? trim(content[0].text)
							: undefined;
					const delegation =
						single?.startsWith("<realtime_delegation>") && single.endsWith("</realtime_delegation>");
					if (
						this.#session !== undefined &&
						!delegation &&
						[...this.#segments.values()].some(segment => segment.text)
					)
						this.#seal(effects.items, true);
				}
				if (item.type === "agentMessage" && typeof item.text === "string") {
					this.#bounded(item.text);
					if (!completed) this.#streaming = { id: item.id, text: item.text };
					this.#assistant(effects.items, turnId, item.id, item.text);
				} else if (
					item.type === "imageGeneration" ||
					(item.type === "extension" && item.kind === "image_gen.generation") ||
					(item.type === "subAgentActivity" && completed && item.kind === "started") ||
					(this.#session !== undefined &&
						completed &&
						item.status === "completed" &&
						((item.type === "dynamicToolCall" && item.success === true) ||
							(item.type === "mcpToolCall" && item.server === "codex_app")))
				)
					this.#promote(effects.items, turnId, item.id, { type: "wholeItem" });
				if (completed && this.#streaming?.id === item.id) this.#streaming = undefined;
			}
		} else if (this.#session !== undefined) {
			if (event.type === "handoff") this.#handoffs.push(this.#session);
			else if (event.type === "error") this.#failed = true;
			else if (event.type === "close") {
				const sessionId = this.#session;
				this.#session = undefined;
				this.#seal(effects.items, false);
				effects.items.push({
					...this.#item(sessionId, "realtimeSessionClosed"),
					outcome: this.#failed ? "failed" : "ended",
				});
				this.#failed = false;
			} else if (event.type === "transcript") {
				if (!event.done) effects.stream = this.#delta(event.role, event.text);
				else {
					let segment = this.#segments.get(event.role);
					if (!segment && event.text) {
						effects.stream = this.#delta(event.role, event.text);
						segment = this.#segments.get(event.role);
					}
					this.#segments.delete(event.role);
					if (segment?.text) effects.items.push({ ...segment });
				}
			}
		}
		return effects;
	}
	#item(sessionId: string, type: string): TimelineItem {
		return { id: this.id(), realtimeSessionId: sessionId, type };
	}
	#bounded(text: string, delta = ""): void {
		if (Buffer.byteLength(text) + Buffer.byteLength(delta) > 1_048_576) throw new Error("Realtime transcript limit");
	}
	#delta(role: Role, delta: string): NonNullable<TimelineEffects["stream"]> {
		let segment = this.#segments.get(role);
		this.#bounded(segment?.text ?? "", delta);
		if (!segment) {
			segment = { ...this.#item(this.#session!, "transcriptSegment"), role, text: "" };
			this.#segments.set(role, segment);
		}
		const startedItem = segment.text ? undefined : { ...segment };
		segment.text += delta;
		return { ...(startedItem ? { startedItem } : {}), itemId: segment.id, delta };
	}
	#seal(items: TimelineItem[], continuation: boolean): void {
		const segments = [...this.#segments.values()];
		this.#segments.clear();
		for (const segment of segments) {
			if (segment.text) items.push({ ...segment });
			if (continuation) this.#segments.set(segment.role, { ...segment, id: this.id(), text: "" });
		}
	}
	#promote(items: TimelineItem[], turnId: string, itemId: string, presentation: Presentation): void {
		const sessionId = this.#turnSessions.get(turnId);
		if (sessionId === undefined) return;
		const key = JSON.stringify([itemId, presentation]);
		if (this.#promoted.has(key)) return;
		this.#promoted.add(key);
		this.#seal(items, true);
		items.push({ ...this.#item(sessionId, "bemItemPromoted"), turnId, itemId, presentation });
	}
	#assistant(items: TimelineItem[], turnId: string, itemId: string, text: string): void {
		const lines = trimStart(text).split(/\r?\n/);
		let first = lines[0] ?? "";
		if (first.startsWith("[") && first.includes("]"))
			first = trimStart(first.slice(first.indexOf("]") + 1)) || lines[1] || "";
		if (first === "::codex-realtime-inline{}" && text.includes("\n")) {
			this.#promote(items, turnId, itemId, { type: "inlineMarkdown" });
			return;
		}
		let fenced = false,
			index = 0;
		for (const line of text.split(/\r?\n/)) {
			const trimmed = trimStart(line);
			if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) fenced = !fenced;
			else if (!fenced && (trimmed.startsWith("::codex-inline-vis{") || trimmed.startsWith("visualize{")))
				this.#promote(items, turnId, itemId, { type: "inlineVisualization", index: index++ });
		}
	}
}
