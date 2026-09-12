/**
 * Session observer overlay component.
 *
 * Picker mode: lists main + active subagent sessions with live status.
 * Viewer mode: renders a read-only transcript of the selected subagent's session
 *   by reading its JSONL session file — shows thinking, text, tool calls, results.
 *
 * Lifecycle:
 *   - shortcut opens picker
 *   - Enter on a subagent -> viewer
 *   - shortcut while in viewer -> back to picker
 *   - Esc from viewer -> back to picker
 *   - Esc from picker -> close overlay
 *   - Enter on main session -> close overlay (jump back)
 */
import type { AssistantMessage, ToolResultMessage } from "@f5-sales-demo/pi-ai";
import { Container, Markdown, matchesKey, type SelectItem, type SelectList, Spacer, Text } from "@f5-sales-demo/pi-tui";
import { formatDuration, formatNumber, logger } from "@f5-sales-demo/pi-utils";
import { formatKeyHints, type KeyId } from "../../config/keybindings";
import type { SessionMessageEntry } from "../../session/session-manager";
import { parseSessionEntries } from "../../session/session-manager";
import { replaceTabs, shortenPath, truncateToWidth } from "../../tools/render-utils";
import type { ObservableSession, SessionObserverRegistry } from "../session-observer-registry";
import { getMarkdownTheme, getSelectListTheme, theme } from "../theme/theme";
import { SearchableSelectList } from "./searchable-select-list";
import {
	matchesSelectorKey,
	selectorCancelHint,
	selectorFrame,
	selectorFrameContentWidth,
	selectorKeys,
} from "./selector-frame";

type Mode = "picker" | "viewer";

export class SessionObserverOverlayComponent extends Container {
	#registry: SessionObserverRegistry;
	#onDone: () => void;
	#mode: Mode = "picker";
	#selectList: SelectList;
	#viewerContainer: Container;
	#selectedSessionId?: string;
	#observeKeys: KeyId[];
	/** Cached parsed transcript per session file to avoid reparsing on every refresh */
	#transcriptCache?: { path: string; bytesRead: number; entries: SessionMessageEntry[] };
	/** Live stats text component, placed after transcript to avoid above-viewport diffs */
	#statsText?: Text;
	#viewerOffset = 0;
	#viewerCapacity = 1;
	#viewerLength = 0;

	constructor(registry: SessionObserverRegistry, onDone: () => void, observeKeys: KeyId[]) {
		super();
		this.#registry = registry;
		this.#onDone = onDone;
		this.#observeKeys = observeKeys;
		this.#selectList = new SearchableSelectList(
			"Observe sessions",
			"Choose the main session or inspect a live identity-qualified subagent session.",
			[],
			1,
			getSelectListTheme(),
		);
		this.#viewerContainer = new Container();

		this.#setupPicker();
	}

	#setupPicker(): void {
		this.#mode = "picker";

		const items = this.#buildPickerItems();
		this.#selectList = new SearchableSelectList(
			"Observe sessions",
			"Choose the main session or inspect a live identity-qualified subagent session.",
			items,
			Math.max(1, Math.min(items.length, 12)),
			getSelectListTheme(),
		);

		this.#selectList.onSelect = item => {
			if (item.value === "main") {
				this.#onDone();
				return;
			}
			this.#selectedSessionId = item.value;
			this.#setupViewer();
		};

		this.#selectList.onCancel = () => {
			this.#onDone();
		};
	}

	#setupViewer(): void {
		this.#mode = "viewer";
		this.#viewerOffset = 0;
		this.#viewerContainer = new Container();
		this.#statsText = new Text("", 1, 0);
		this.#refreshViewer();
	}

	override render(width: number): string[] {
		if (this.#mode === "picker") return this.#selectList.render(width);
		const rows = process.stdout.rows || 24;
		const inner = selectorFrameContentWidth(width);
		const content = [...this.#viewerContainer.render(inner), ...(this.#statsText?.render(inner) ?? [])].filter(line =>
			Bun.stripANSI(line).trim(),
		);
		this.#viewerLength = content.length;
		this.#viewerCapacity = Math.max(1, rows - 9);
		this.#viewerOffset = Math.max(
			0,
			Math.min(this.#viewerOffset, Math.max(0, this.#viewerLength - this.#viewerCapacity)),
		);
		const session = this.#registry.getSessions().find(candidate => candidate.id === this.#selectedSessionId);
		return selectorFrame(
			width,
			rows,
			"Session observer",
			session ? `Live read-only view · ${session.label} · identity ${session.id}` : "Live session is unavailable.",
			[],
			content.slice(this.#viewerOffset, this.#viewerOffset + this.#viewerCapacity),
			[],
			[
				...(this.#viewerLength > this.#viewerCapacity
					? [`${selectorKeys("pageUp")}/${selectorKeys("pageDown")}: transcript`]
					: []),
				selectorCancelHint("back to sessions"),
				...(this.#observeKeys.length ? [`${formatKeyHints(this.#observeKeys)}: back to sessions`] : []),
			],
		);
	}

	/** Rebuild content from live registry data */
	refreshFromRegistry(): void {
		if (this.#mode === "picker") {
			this.#refreshPickerItems();
		} else if (this.#mode === "viewer" && this.#selectedSessionId) {
			this.#refreshViewer();
		}
	}

	#refreshPickerItems(): void {
		// Preserve selection across refresh by matching on value
		const previousValue = this.#selectList.getSelectedItem()?.value;

		const items = this.#buildPickerItems();
		const newList = new SearchableSelectList(
			"Observe sessions",
			"Choose the main session or inspect a live identity-qualified subagent session.",
			items,
			Math.max(1, Math.min(items.length, 12)),
			getSelectListTheme(),
		);
		newList.onSelect = this.#selectList.onSelect;
		newList.onCancel = this.#selectList.onCancel;

		if (previousValue) {
			const newIndex = items.findIndex(i => i.value === previousValue);
			if (newIndex >= 0) newList.setSelectedIndex(newIndex);
		}
		this.#selectList = newList;
	}

	#refreshViewer(): void {
		this.#viewerContainer.clear();

		const sessions = this.#registry.getSessions();
		const session = sessions.find(s => s.id === this.#selectedSessionId);
		if (!session) {
			this.#viewerContainer.addChild(new Text(theme.fg("dim", "Session no longer available."), 1, 0));
			this.#updateStats(undefined);
			return;
		}

		this.#renderSessionHeader(session);
		this.#renderSessionTranscript(session);
		this.#updateStats(session);
	}

	#renderSessionHeader(session: ObservableSession): void {
		const c = this.#viewerContainer;

		// Header: label + status + [agent]
		const statusColor = session.status === "active" ? "success" : session.status === "failed" ? "error" : "dim";
		const statusText = theme.fg(statusColor, session.status);
		const agentTag = session.agent ? theme.fg("dim", ` [${session.agent}]`) : "";
		c.addChild(new Text(`${theme.bold(theme.fg("contentAccent", session.label))}  ${statusText}${agentTag}`, 1, 0));

		if (session.description) {
			c.addChild(new Text(theme.fg("muted", session.description), 1, 0));
		}

		if (session.sessionFile) {
			c.addChild(new Text(theme.fg("dim", `Session: ${shortenPath(session.sessionFile)}`), 1, 0));
		}
	}

	/** Update live stats in-place (below transcript, within viewport). */
	#updateStats(session: ObservableSession | undefined): void {
		if (!this.#statsText) return;
		const progress = session?.progress;
		if (!progress) {
			this.#statsText.setText("");
			return;
		}
		const stats: string[] = [];
		if (progress.toolCount > 0) stats.push(`${formatNumber(progress.toolCount)} tools`);
		if (progress.tokens > 0) stats.push(`${formatNumber(progress.tokens)} tokens`);
		if (progress.durationMs > 0) stats.push(formatDuration(progress.durationMs));
		this.#statsText.setText(stats.length > 0 ? theme.fg("dim", stats.join(theme.sep.dot)) : "");
	}

	/** Incrementally read and parse the session JSONL, caching already-parsed entries. */
	#loadTranscript(sessionFile: string): SessionMessageEntry[] | null {
		// Invalidate cache if session file changed (e.g. switched to different subagent)
		if (this.#transcriptCache && this.#transcriptCache.path !== sessionFile) {
			this.#transcriptCache = undefined;
		}

		const fromByte = this.#transcriptCache?.bytesRead ?? 0;
		const result = readFileIncremental(sessionFile, fromByte);
		if (!result) {
			logger.debug("Session observer: failed to read session file", { path: sessionFile });
			return this.#transcriptCache?.entries ?? null;
		}

		// File shrank (compaction or pruning rewrote it) — invalidate and re-read from scratch
		if (result.newSize < fromByte) {
			this.#transcriptCache = undefined;
			return this.#loadTranscript(sessionFile);
		}

		if (!this.#transcriptCache) {
			this.#transcriptCache = { path: sessionFile, bytesRead: 0, entries: [] };
		}

		// Parse only new bytes, but only up to the last complete line.
		// A partial trailing record (mid-write) must not be consumed —
		// we leave those bytes for the next refresh.
		if (result.text.length > 0) {
			const lastNewline = result.text.lastIndexOf("\n");
			if (lastNewline >= 0) {
				const completeChunk = result.text.slice(0, lastNewline + 1);
				const newEntries = parseSessionEntries(completeChunk);
				for (const entry of newEntries) {
					if (entry.type === "message") {
						this.#transcriptCache.entries.push(entry as SessionMessageEntry);
					}
				}
				this.#transcriptCache.bytesRead = fromByte + Buffer.byteLength(completeChunk, "utf-8");
			}
			// If no newline found, the entire chunk is partial — leave bytesRead unchanged
		}
		return this.#transcriptCache.entries;
	}

	#renderSessionTranscript(session: ObservableSession): void {
		const c = this.#viewerContainer;

		if (!session.sessionFile) {
			c.addChild(new Text(theme.fg("dim", "No session file available yet."), 1, 0));
			return;
		}

		const messageEntries = this.#loadTranscript(session.sessionFile);
		if (!messageEntries) {
			c.addChild(new Text(theme.fg("dim", "Unable to read session file."), 1, 0));
			return;
		}
		if (messageEntries.length === 0) {
			c.addChild(new Text(theme.fg("dim", "No messages yet."), 1, 0));
			return;
		}

		// Build a tool call ID -> tool result map for matching
		const toolResults = new Map<string, ToolResultMessage>();
		for (const entry of messageEntries) {
			if (entry.message.role === "toolResult") {
				toolResults.set(entry.message.toolCallId, entry.message);
			}
		}

		for (const entry of messageEntries) {
			const msg = entry.message;

			if (msg.role === "assistant") {
				this.#renderAssistantMessage(c, msg, toolResults);
			} else if (msg.role === "user" || msg.role === "developer") {
				// Show user/developer messages briefly
				const text =
					typeof msg.content === "string"
						? msg.content
						: msg.content
								.filter((b): b is { type: "text"; text: string } => b.type === "text")
								.map(b => b.text)
								.join("\n");
				if (text.trim()) {
					const label = msg.role === "developer" ? "System" : "User";
					c.addChild(new Spacer(1));
					c.addChild(new Text(`${theme.fg("dim", `[${label}]`)} ${theme.fg("muted", text.trim())}`, 1, 0));
				}
			}
			// toolResult entries are rendered inline with their tool calls above
		}
	}

	#renderAssistantMessage(c: Container, msg: AssistantMessage, toolResults: Map<string, ToolResultMessage>): void {
		for (const content of msg.content) {
			if (content.type === "thinking" && content.thinking.trim()) {
				const thinking = content.thinking.trim();
				c.addChild(new Spacer(1));
				c.addChild(
					new Markdown(thinking, 1, 0, getMarkdownTheme(), {
						color: (t: string) => theme.fg("thinkingText", t),
						italic: true,
					}),
				);
			} else if (content.type === "text" && content.text.trim()) {
				c.addChild(new Spacer(1));
				c.addChild(new Markdown(content.text.trim(), 1, 0, getMarkdownTheme()));
			} else if (content.type === "toolCall") {
				this.#renderToolCall(c, content, toolResults);
			}
		}
	}

	#renderToolCall(
		c: Container,
		call: { id: string; name: string; arguments: Record<string, unknown>; intent?: string },
		toolResults: Map<string, ToolResultMessage>,
	): void {
		c.addChild(new Spacer(1));

		// Tool call header with intent
		const intentStr = call.intent ? theme.fg("dim", ` ${call.intent}`) : "";
		c.addChild(
			new Text(`${theme.fg("contentAccent", "▸")} ${theme.bold(theme.fg("muted", call.name))}${intentStr}`, 1, 0),
		);

		// Key arguments (skip very long ones, show summary)
		const argEntries = Object.entries(call.arguments);
		if (argEntries.length > 0) {
			const argSummary = this.#formatToolArgs(call.name, call.arguments);
			if (argSummary) {
				c.addChild(new Text(`  ${theme.fg("dim", argSummary)}`, 1, 0));
			}
		}

		// Inline tool result
		const result = toolResults.get(call.id);
		if (result) {
			this.#renderToolResult(c, result);
		}
	}

	#formatToolArgs(toolName: string, args: Record<string, unknown>): string {
		// Show the most relevant arg for common tools
		switch (toolName) {
			case "read":
				return args.path ? `path: ${args.path}` : "";
			case "write":
				return args.path ? `path: ${args.path}` : "";
			case "edit":
				return args.path ? `path: ${args.path}` : "";
			case "grep":
				return [args.pattern ? `pattern: ${args.pattern}` : "", args.path ? `path: ${args.path}` : ""]
					.filter(Boolean)
					.join(", ");
			case "find":
				return args.pattern ? `pattern: ${args.pattern}` : "";
			case "bash": {
				const cmd = args.command;
				if (typeof cmd === "string") {
					return replaceTabs(cmd);
				}
				return "";
			}
			case "lsp":
				return [args.action, args.file, args.symbol].filter(Boolean).join(" ");
			case "ast_grep":
			case "ast_edit":
				return args.path ? `path: ${args.path}` : "";
			case "task": {
				const tasks = args.tasks;
				if (Array.isArray(tasks)) {
					return `${tasks.length} task(s)`;
				}
				return "";
			}
			default: {
				// The viewer itself is scrollable, so preserve every argument rather
				// than creating an inaccessible summary-only transcript.
				const parts: string[] = [];
				for (const [key, value] of Object.entries(args)) {
					if (key.startsWith("_")) continue;
					const v = typeof value === "string" ? value : JSON.stringify(value);
					parts.push(`${key}: ${replaceTabs(v ?? "")}`);
				}
				return parts.join(", ");
			}
		}
	}

	#renderToolResult(c: Container, result: ToolResultMessage): void {
		const textParts = result.content
			.filter((p): p is { type: "text"; text: string } => p.type === "text")
			.map(p => p.text);
		const text = textParts.join("\n").trim();

		if (result.isError) {
			c.addChild(new Text(`  ${theme.fg("error", `✗ ${replaceTabs(text || "Error")}`)}`, 1, 0));
		} else if (text) {
			c.addChild(new Text(`  ${theme.fg("dim", `✓ ${replaceTabs(text)}`)}`, 1, 0));
		} else {
			c.addChild(new Text(`  ${theme.fg("dim", "✓ done")}`, 1, 0));
		}
	}

	#buildPickerItems(): SelectItem[] {
		const sessions = this.#registry.getSessions();
		return sessions.map(s => {
			const statusIcon =
				s.status === "active" ? "●" : s.status === "completed" ? "✓" : s.status === "failed" ? "✗" : "○";
			const statusColor = s.status === "active" ? "success" : s.status === "failed" ? "error" : "dim";
			const prefix = theme.fg(statusColor, statusIcon);
			const agentSuffix = s.agent ? theme.fg("dim", ` [${s.agent}]`) : "";
			const label = s.kind === "main" ? `${prefix} ${s.label} (return)` : `${prefix} ${s.label}${agentSuffix}`;

			// Show current activity in the picker description for subagents
			let description = s.description;
			if (s.progress?.currentTool) {
				const intent = s.progress.lastIntent;
				description = intent ? `${s.progress.currentTool}: ${truncateToWidth(intent, 40)}` : s.progress.currentTool;
			}

			return { value: s.id, label, description };
		});
	}

	handleInput(keyData: string): void {
		for (const key of this.#observeKeys) {
			if (matchesKey(keyData, key)) {
				if (this.#mode === "viewer") {
					this.#setupPicker();
					return;
				}
				this.#onDone();
				return;
			}
		}

		if (this.#mode === "picker") {
			this.#selectList.handleInput(keyData);
		} else if (this.#mode === "viewer") {
			if (matchesSelectorKey(keyData, "cancel")) {
				this.#setupPicker();
				return;
			}
			const delta = matchesSelectorKey(keyData, "pageDown")
				? this.#viewerCapacity
				: matchesSelectorKey(keyData, "pageUp")
					? -this.#viewerCapacity
					: matchesSelectorKey(keyData, "down")
						? 1
						: matchesSelectorKey(keyData, "up")
							? -1
							: 0;
			this.#viewerOffset = Math.max(
				0,
				Math.min(Math.max(0, this.#viewerLength - this.#viewerCapacity), this.#viewerOffset + delta),
			);
		}
	}
}

// Sync helpers for render path — avoid async in component rendering
import * as fs from "node:fs";

/**
 * Read new bytes from a file starting at the given byte offset.
 * Returns the new text and updated file size, or null on error.
 */
function readFileIncremental(filePath: string, fromByte: number): { text: string; newSize: number } | null {
	try {
		const stat = fs.statSync(filePath);
		if (stat.size <= fromByte) return { text: "", newSize: stat.size };
		const buf = Buffer.alloc(stat.size - fromByte);
		const fd = fs.openSync(filePath, "r");
		try {
			fs.readSync(fd, buf, 0, buf.length, fromByte);
		} finally {
			fs.closeSync(fd);
		}
		return { text: buf.toString("utf-8"), newSize: stat.size };
	} catch {
		return null;
	}
}
