import {
	type Component,
	Container,
	Input,
	type MouseRoutable,
	matchesKey,
	type SgrMouseEvent,
	wrapTextWithAnsi,
} from "@f5-sales-demo/pi-tui";
import { theme } from "../../modes/theme/theme";
import type { SessionInfo } from "../../session/session-manager";
import { fuzzyFilter } from "../../utils/fuzzy";
import { ReviewedActionDialog } from "./reviewed-action-dialog";
import {
	matchesSelectorKey,
	type SelectorFrameLine,
	selectorCancelHint,
	selectorFrame,
	selectorFrameContentWidth,
	selectorKeys,
	selectorRow,
} from "./selector-frame";

function formatDate(date: Date): string {
	const diffMinutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60_000));
	if (diffMinutes < 1) return "now";
	if (diffMinutes < 60) return `${diffMinutes}m`;
	const hours = Math.floor(diffMinutes / 60);
	if (hours < 24) return `${hours}h`;
	const days = Math.floor(hours / 24);
	if (days < 7) return `${days}d`;
	return date.toLocaleDateString();
}

class SessionList implements Component {
	#sessions: SessionInfo[];
	#filteredSessions: SessionInfo[];
	#selectedIndex = 0;
	#searchInput = new Input();
	#hitRows: (number | undefined)[] = [];
	#capacity = 4;
	#showCwd = false;
	onSelect?: (sessionPath: string) => void;
	onCancel?: () => void;
	onExit: () => void = () => {};
	onDeleteRequest?: (session: SessionInfo) => void;

	constructor(sessions: SessionInfo[], showCwd = false) {
		this.#sessions = sessions;
		this.#filteredSessions = sessions;
		this.#showCwd = showCwd;
		this.#searchInput.onEscape = () => {};
	}

	setSessions(sessions: SessionInfo[], showCwd: boolean, query: string): void {
		const identity = this.selected()?.path;
		this.#sessions = sessions;
		this.#showCwd = showCwd;
		this.#searchInput.setValue(query);
		this.#filterSessions(query);
		if (identity) {
			const index = this.#filteredSessions.findIndex(session => session.path === identity);
			if (index >= 0) this.#selectedIndex = index;
		}
	}

	getQuery(): string {
		return this.#searchInput.getValue();
	}

	selected(): SessionInfo | undefined {
		return this.#filteredSessions[this.#selectedIndex];
	}

	#filterSessions(query: string): void {
		this.#filteredSessions = fuzzyFilter(this.#sessions, query, session =>
			[session.id, session.title ?? "", session.cwd, session.firstMessage, session.allMessagesText, session.path]
				.filter(Boolean)
				.join(" "),
		);
		this.#selectedIndex = Math.min(this.#selectedIndex, Math.max(0, this.#filteredSessions.length - 1));
	}

	removeSession(sessionPath: string): void {
		this.#sessions = this.#sessions.filter(session => session.path !== sessionPath);
		this.#filterSessions(this.getQuery());
	}

	hitTest(line: number): number | undefined {
		return this.#hitRows[line];
	}

	handleWheel(delta: -1 | 1): void {
		this.#selectedIndex = Math.max(0, Math.min(this.#filteredSessions.length - 1, this.#selectedIndex + delta));
	}

	selectAndConfirm(index: number): void {
		const session = this.#filteredSessions[index];
		if (!session) return;
		this.#selectedIndex = index;
		this.onSelect?.(session.path);
	}

	invalidate(): void {}

	renderFrameLines(width: number): SelectorFrameLine[] {
		const lines: SelectorFrameLine[] = [];
		this.#hitRows = [];
		lines.push(`Search: ${theme.nav.cursor} ${this.#searchInput.render(Math.max(1, width - 10))[0] ?? ""}`);
		if (this.#filteredSessions.length === 0) {
			lines.push(theme.fg("muted", this.getQuery() ? "No matching sessions" : "No sessions in this scope"));
			return lines;
		}
		const start = Math.max(
			0,
			Math.min(this.#selectedIndex - Math.floor(this.#capacity / 2), this.#filteredSessions.length - this.#capacity),
		);
		const end = Math.min(this.#filteredSessions.length, start + this.#capacity);
		const metaWidth = Math.min(16, Math.max(9, Math.floor(width * 0.22)));
		const countWidth = Math.min(12, Math.max(7, Math.floor(width * 0.14)));
		const titleWidth = Math.max(8, width - metaWidth - countWidth - 4);
		for (let index = start; index < end; index++) {
			const session = this.#filteredSessions[index];
			const title = session.title || session.firstMessage.replace(/\s+/g, " ").trim() || "Untitled session";
			this.#hitRows[lines.length] = index;
			lines.push(
				selectorRow(
					[`${title} · ${session.id.slice(-8)}`, `${session.messageCount} msg`, formatDate(session.modified)],
					[titleWidth, countWidth, metaWidth],
					index === this.#selectedIndex,
				),
			);
			if (index === this.#selectedIndex) {
				const summary = `${this.#showCwd ? `${session.cwd} · ` : ""}${session.firstMessage.replace(/\s+/g, " ").trim()}`;
				lines.push(...wrapTextWithAnsi(theme.fg("muted", summary), width));
			}
		}
		if (start > 0 || end < this.#filteredSessions.length)
			lines.push(theme.fg("muted", `${this.#selectedIndex + 1}/${this.#filteredSessions.length}`));
		return lines;
	}

	render(width: number): string[] {
		return this.renderFrameLines(width).map(line => (typeof line === "string" ? line : line.content));
	}

	handleInput(data: string): void {
		if (matchesKey(data, "delete")) {
			const session = this.selected();
			if (session) this.onDeleteRequest?.(session);
			return;
		}
		if (matchesSelectorKey(data, "up") || matchesSelectorKey(data, "down")) {
			const delta = matchesSelectorKey(data, "up") ? -1 : 1;
			this.#selectedIndex = Math.max(0, Math.min(this.#filteredSessions.length - 1, this.#selectedIndex + delta));
			return;
		}
		if (matchesSelectorKey(data, "pageUp") || matchesSelectorKey(data, "pageDown")) {
			const delta = matchesSelectorKey(data, "pageUp") ? -this.#capacity : this.#capacity;
			this.#selectedIndex = Math.max(0, Math.min(this.#filteredSessions.length - 1, this.#selectedIndex + delta));
			return;
		}
		if (matchesSelectorKey(data, "confirm")) {
			const session = this.selected();
			if (session) this.onSelect?.(session.path);
			return;
		}
		if (matchesSelectorKey(data, "cancel")) {
			if (this.getQuery()) {
				this.#searchInput.setValue("");
				this.#filterSessions("");
			} else this.onCancel?.();
			return;
		}
		if (matchesKey(data, "ctrl+c")) return;
		this.#searchInput.handleInput(data);
		this.#filterSessions(this.getQuery());
	}
}

export interface SessionSelectorOptions {
	fillHeight?: boolean;
	getTerminalRows?: () => number;
	allSessions?: SessionInfo[];
	currentCwd?: string;
}

export class SessionSelectorComponent extends Container implements MouseRoutable {
	#sessionList: SessionList;
	#confirmationDialog: ReviewedActionDialog<SessionInfo> | null = null;
	#detail: SessionInfo | undefined;
	#detailAction = 0;
	#onRequestRender?: () => void;
	#listLineOffset = 0;
	#detailActionRows: number[] = [];
	#scope: "current" | "all" = "current";
	#queries = { current: "", all: "" };
	readonly #getTerminalRows: () => number;
	readonly #currentCwd: string;
	readonly #currentSessions: SessionInfo[];
	readonly #allSessions: SessionInfo[];

	constructor(
		sessions: SessionInfo[],
		private readonly onResume: (sessionPath: string) => void,
		private readonly onCancel: () => void,
		private readonly onExit: () => void,
		private readonly onDelete?: (session: SessionInfo) => Promise<boolean>,
		options: SessionSelectorOptions = {},
	) {
		super();
		this.#getTerminalRows = options.getTerminalRows ?? (() => 24);
		this.#currentCwd = options.currentCwd ?? sessions[0]?.cwd ?? "";
		this.#currentSessions = sessions;
		this.#allSessions = options.allSessions ?? sessions;
		this.#sessionList = new SessionList(sessions);
		this.#sessionList.onSelect = path => {
			this.#detail = this.#allSessions.find(session => session.path === path);
			this.#detailAction = 0;
			this.#onRequestRender?.();
		};
		this.#sessionList.onCancel = this.onCancel;
		this.#sessionList.onExit = this.onExit;
		this.#sessionList.onDeleteRequest = session => this.#showDeleteConfirmation(session);
	}

	setOnRequestRender(callback: () => void): void {
		this.#onRequestRender = callback;
	}

	#switchScope(next: "current" | "all"): void {
		if (next === this.#scope) return;
		this.#queries[this.#scope] = this.#sessionList.getQuery();
		this.#scope = next;
		this.#sessionList.setSessions(
			next === "current" ? this.#currentSessions : this.#allSessions,
			next === "all",
			this.#queries[next],
		);
	}

	override render(width: number): string[] {
		if (this.#confirmationDialog) return this.#confirmationDialog.render(width);
		const inner = selectorFrameContentWidth(width);
		if (this.#detail) {
			const session = this.#detail;
			const actions = ["Resume this session", "Delete this session"];
			const lines = selectorFrame(
				width,
				this.#getTerminalRows(),
				"Session details",
				`${session.title || "Untitled session"} · ${session.id}`,
				[],
				actions.map((label, index) => selectorRow([label], [inner - 2], index === this.#detailAction)),
				[
					`Identity: ${session.id}`,
					`Working directory: ${session.cwd || "Unknown"}`,
					`Session file: ${session.path}`,
					`Parent: ${session.parentSessionPath ?? "None"}`,
					`Modified: ${session.modified.toISOString()}`,
					`Messages: ${session.messageCount}`,
					...wrapTextWithAnsi(`First message: ${session.firstMessage}`, inner),
				],
				[selectorCancelHint("back")],
				{ selectedBodyIndex: this.#detailAction },
			);
			this.#detailActionRows = actions.map(label => lines.findIndex(line => Bun.stripANSI(line).includes(label)));
			return lines;
		}
		const list = this.#sessionList.renderFrameLines(inner);
		const tabs = `[${this.#scope === "current" ? "Current" : "current"} (${this.#currentSessions.length})]  [${this.#scope === "all" ? "All" : "all"} (${this.#allSessions.length})]`;
		const lines = selectorFrame(
			width,
			this.#getTerminalRows(),
			"Sessions",
			this.#scope === "current"
				? `Current directory · ${this.#currentCwd || "unknown"}`
				: "All saved session directories",
			[theme.fg("muted", tabs)],
			list,
			[],
			[
				"Tab/Shift+Tab: scope",
				"Del: review deletion",
				selectorCancelHint("back"),
				...(list.length >= Math.max(1, this.#getTerminalRows() - 10)
					? [`${selectorKeys("pageUp")}/${selectorKeys("pageDown")}: page`]
					: []),
			],
		);
		this.#listLineOffset = lines.findIndex(line => Bun.stripANSI(line).includes("Search:"));
		return lines;
	}

	#showDeleteConfirmation(session: SessionInfo): void {
		const displayName = session.title || session.firstMessage.slice(0, 40) || session.id;
		const review = {
			identity: `session:${session.id}`,
			scope: `Saved session · ${session.cwd}`,
			revision: JSON.stringify([session.id, session.path, session.modified.getTime(), session.messageCount]),
			changes: [
				{ field: "Session", before: displayName, after: "Permanently deleted" },
				{ field: "File", before: session.path, after: "Removed" },
				{ field: "Artifacts", before: session.path.slice(0, -6), after: "Removed if present" },
			],
			consequence:
				"Permanently removes this saved conversation and its artifacts. If it is active, a new saved session is created before deletion. This cannot be undone.",
		};
		this.#confirmationDialog = new ReviewedActionDialog(
			"session deletion",
			{
				review,
				resolve: async () => ({ review, target: session }),
				execute: async target => {
					if (!this.onDelete || !(await this.onDelete(target)))
						throw new Error("Session deletion was not completed.");
				},
			},
			outcome => {
				if (outcome === "succeeded") {
					this.#sessionList.removeSession(session.path);
					if (this.#detail?.path === session.path) this.#detail = undefined;
				}
				this.#confirmationDialog = null;
				this.#onRequestRender?.();
			},
			() => this.#onRequestRender?.(),
			this.#getTerminalRows,
		);
	}

	handleInput(data: string): void {
		if (this.#confirmationDialog) {
			this.#confirmationDialog.handleInput(data);
			return;
		}
		if (this.#detail) {
			if (matchesSelectorKey(data, "cancel")) this.#detail = undefined;
			else if (matchesSelectorKey(data, "up") || matchesSelectorKey(data, "down"))
				this.#detailAction = 1 - this.#detailAction;
			else if (matchesSelectorKey(data, "confirm")) {
				if (this.#detailAction === 0) this.onResume(this.#detail.path);
				else this.#showDeleteConfirmation(this.#detail);
			}
			return;
		}
		if (matchesKey(data, "tab") || matchesKey(data, "shift+tab")) {
			this.#switchScope(this.#scope === "current" ? "all" : "current");
			return;
		}
		this.#sessionList.handleInput(data);
	}

	routeMouse(event: SgrMouseEvent, _line: number, _col: number): void {
		if (this.#confirmationDialog) return;
		if (this.#detail) {
			const index = this.#detailActionRows.indexOf(event.row);
			if (event.leftClick && index >= 0) {
				this.#detailAction = index;
				this.handleInput("\n");
			}
			return;
		}
		if (event.wheel !== null) {
			this.#sessionList.handleWheel(event.wheel);
			return;
		}
		if (!event.leftClick || this.#listLineOffset < 0) return;
		const index = this.#sessionList.hitTest(event.row - this.#listLineOffset);
		if (index !== undefined) this.#sessionList.selectAndConfirm(index);
	}

	getSessionList(): SessionList {
		return this.#sessionList;
	}
}
