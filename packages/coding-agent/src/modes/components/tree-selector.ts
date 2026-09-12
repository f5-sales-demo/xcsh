import {
	type Component,
	Container,
	Input,
	type MouseRoutable,
	matchesKey,
	type SgrMouseEvent,
	wrapTextWithAnsi,
} from "@f5-sales-demo/pi-tui";
import type { TreeFilterMode } from "../../config/settings-schema";
import { theme } from "../../modes/theme/theme";
import type { SessionTreeNode } from "../../session/session-manager";
import {
	matchesSelectorKey,
	type SelectorFrameLine,
	selectorCancelHint,
	selectorFrame,
	selectorFrameContentWidth,
	selectorKeys,
	selectorRow,
} from "./selector-frame";

type FilterMode = TreeFilterMode;

interface FlatNode {
	node: SessionTreeNode;
	depth: number;
	ancestorContinues: boolean[];
	isLast: boolean;
}

function textContent(content: unknown, maxLength = 2_000): string {
	if (typeof content === "string") return content.slice(0, maxLength);
	if (!Array.isArray(content)) return "";
	let result = "";
	for (const block of content) {
		if (typeof block === "object" && block !== null && "type" in block && block.type === "text") {
			result += (block as { text: string }).text;
			if (result.length >= maxLength) break;
		}
	}
	return result.slice(0, maxLength);
}

function normalized(value: string): string {
	return value
		.replace(/[\n\t]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function entryRole(node: SessionTreeNode): string {
	const entry = node.entry;
	if (entry.type === "message") return entry.message.role;
	if (entry.type === "custom_message") return entry.customType;
	return entry.type.replaceAll("_", " ");
}

function entryText(node: SessionTreeNode, full = false): string {
	const entry = node.entry;
	const limit = full ? 2_000 : 220;
	if (entry.type === "message") {
		const message = entry.message as {
			role: string;
			content?: unknown;
			command?: string;
			toolName?: string;
			errorMessage?: string;
		};
		const content = normalized(textContent(message.content, limit));
		if (content) return content;
		if (message.command) return normalized(message.command).slice(0, limit);
		if (message.errorMessage) return normalized(message.errorMessage).slice(0, limit);
		return message.toolName ? `[${message.toolName}]` : "(no text content)";
	}
	if (entry.type === "custom_message") return normalized(textContent(entry.content, limit));
	if (entry.type === "branch_summary") return normalized(entry.summary).slice(0, limit);
	if (entry.type === "compaction") return `${Math.round(entry.tokensBefore / 1_000)}k tokens before compaction`;
	if (entry.type === "model_change") return entry.model;
	if (entry.type === "thinking_level_change") return entry.thinkingLevel ?? "off";
	if (entry.type === "label") return entry.label ?? "label cleared";
	if (entry.type === "custom") return entry.customType;
	return "";
}

function flattenTree(roots: SessionTreeNode[], activeLeafId: string | null): FlatNode[] {
	const containsActive = new Map<SessionTreeNode, boolean>();
	const ordered: SessionTreeNode[] = [];
	const discover = [...roots];
	while (discover.length) {
		const node = discover.pop()!;
		ordered.push(node);
		discover.push(...node.children);
	}
	for (let index = ordered.length - 1; index >= 0; index--) {
		const node = ordered[index];
		containsActive.set(
			node,
			node.entry.id === activeLeafId || node.children.some(child => containsActive.get(child) === true),
		);
	}

	const result: FlatNode[] = [];
	type Pending = { node: SessionTreeNode; depth: number; ancestorContinues: boolean[]; isLast: boolean };
	const sortedRoots = [...roots].sort(
		(left, right) => Number(containsActive.get(right)) - Number(containsActive.get(left)),
	);
	const stack: Pending[] = [];
	for (let index = sortedRoots.length - 1; index >= 0; index--)
		stack.push({
			node: sortedRoots[index],
			depth: 0,
			ancestorContinues: [],
			isLast: index === sortedRoots.length - 1,
		});
	while (stack.length) {
		const item = stack.pop()!;
		result.push(item);
		const children = [...item.node.children].sort(
			(left, right) => Number(containsActive.get(right)) - Number(containsActive.get(left)),
		);
		for (let index = children.length - 1; index >= 0; index--) {
			stack.push({
				node: children[index],
				depth: item.depth + 1,
				ancestorContinues: [...item.ancestorContinues, !item.isLast],
				isLast: index === children.length - 1,
			});
		}
	}
	return result;
}

class LabelEditor implements Component {
	readonly input = new Input();
	constructor(current: string | undefined) {
		if (current) this.input.setValue(current);
		this.input.onEscape = () => {};
	}
	render(width: number): string[] {
		return this.input.render(width);
	}
	handleInput(data: string): void {
		this.input.handleInput(data);
	}
	invalidate(): void {}
}

/** Responsive session-tree browser with exact node details and explicit actions. */
export class TreeSelectorComponent extends Container implements MouseRoutable {
	readonly #flat: FlatNode[];
	#filtered: FlatNode[] = [];
	#activePath = new Set<string>();
	#selected = 0;
	#search = new Input();
	#filterMode: FilterMode;
	#detail: FlatNode | undefined;
	#detailAction = 0;
	#detailOffset = 0;
	#labelEditor: LabelEditor | undefined;
	#labelError = "";
	#savingLabel = false;
	#capacity = 1;
	#browseStart = 0;
	#hitRows = new Map<number, number>();
	#actionRows = new Map<number, number>();
	constructor(
		tree: SessionTreeNode[],
		private readonly currentLeafId: string | null,
		terminalHeight: number,
		private readonly onSelect: (entryId: string) => void | Promise<void>,
		private readonly onCancel: () => void,
		private readonly onLabelChangeCallback?: (
			entryId: string,
			label: string | undefined,
		) => boolean | undefined | Promise<boolean | undefined>,
		initialFilterMode: FilterMode = "default",
		private readonly rows: () => number = () => terminalHeight,
	) {
		super();
		this.#flat = flattenTree(tree, currentLeafId);
		this.#filterMode = initialFilterMode;
		this.#search.onEscape = () => {};
		this.#buildActivePath();
		this.#applyFilter(currentLeafId);
		if (tree.length === 0) setTimeout(onCancel, 100);
	}

	#buildActivePath(): void {
		const byId = new Map(this.#flat.map(item => [item.node.entry.id, item]));
		let id = this.currentLeafId;
		while (id) {
			this.#activePath.add(id);
			id = byId.get(id)?.node.entry.parentId ?? null;
		}
	}

	#matchesMode(item: FlatNode): boolean {
		const entry = item.node.entry;
		const settingsEntry = ["label", "custom", "model_change", "thinking_level_change"].includes(entry.type);
		if (this.#filterMode === "user-only") return entry.type === "message" && entry.message.role === "user";
		if (this.#filterMode === "labeled-only") return item.node.label !== undefined;
		if (this.#filterMode === "all") return true;
		if (this.#filterMode === "no-tools")
			return !settingsEntry && !(entry.type === "message" && entry.message.role === "toolResult");
		return !settingsEntry;
	}

	#applyFilter(preferredId?: string | null): void {
		const selectedId = preferredId ?? this.#filtered[this.#selected]?.node.entry.id;
		const tokens = this.#search.getValue().toLowerCase().split(/\s+/).filter(Boolean);
		this.#filtered = this.#flat.filter(item => {
			if (!this.#matchesMode(item)) return false;
			const haystack =
				`${item.node.entry.id} ${item.node.label ?? ""} ${entryRole(item.node)} ${entryText(item.node, true)}`.toLowerCase();
			return tokens.every(token => haystack.includes(token));
		});
		const exact = selectedId ? this.#filtered.findIndex(item => item.node.entry.id === selectedId) : -1;
		this.#selected = exact >= 0 ? exact : Math.min(this.#selected, Math.max(0, this.#filtered.length - 1));
	}

	#cycleFilter(delta: -1 | 1): void {
		const modes: FilterMode[] = ["default", "no-tools", "user-only", "labeled-only", "all"];
		const index = modes.indexOf(this.#filterMode);
		this.#filterMode = modes[(index + delta + modes.length) % modes.length];
		this.#applyFilter();
	}

	#prefix(item: FlatNode): string {
		if (item.depth === 0) return "";
		const ancestors = item.ancestorContinues
			.slice(1)
			.map(continues => (continues ? `${theme.tree.vertical}  ` : "   "));
		return `${ancestors.join("")}${item.isLast ? theme.tree.last : theme.tree.branch}`;
	}

	#browseBody(inner: number): SelectorFrameLine[] {
		this.#capacity = Math.max(1, this.rows() - 13);
		const body: SelectorFrameLine[] = [
			`Search: ${theme.nav.cursor} ${this.#search.render(Math.max(1, inner - 10))[0] ?? ""}`,
		];
		if (!this.#filtered.length) {
			body.push(theme.fg("muted", this.#search.getValue() ? "No matching tree nodes" : "No nodes in this view"));
			return body;
		}
		this.#browseStart = Math.max(
			0,
			Math.min(this.#selected - Math.floor(this.#capacity / 2), this.#filtered.length - this.#capacity),
		);
		const end = Math.min(this.#filtered.length, this.#browseStart + this.#capacity);
		for (let index = this.#browseStart; index < end; index++) {
			const item = this.#filtered[index];
			const active = this.#activePath.has(item.node.entry.id) ? `${theme.md.bullet} ` : "  ";
			const label = item.node.label ? `[${item.node.label}] ` : "";
			const lead = `${this.#prefix(item)}${active}${label}${entryRole(item.node)}:`;
			body.push(
				selectorRow(
					[lead, entryText(item.node), item.node.entry.id.slice(-8)],
					[Math.min(30, Math.max(12, Math.floor(inner * 0.34))), Math.max(8, inner - 44), 10],
					index === this.#selected,
				),
			);
		}
		return body;
	}

	override render(width: number): string[] {
		const inner = selectorFrameContentWidth(width);
		if (this.#labelEditor && this.#detail) {
			return selectorFrame(
				width,
				this.rows(),
				"Edit tree label",
				`Session node · ${this.#detail.node.entry.id}`,
				[],
				[
					...(this.#labelError ? [theme.fg("error", this.#labelError)] : []),
					"Label (leave empty to remove)",
					...(this.#savingLabel ? [theme.fg("muted", "Saving reviewed label…")] : this.#labelEditor.render(inner)),
				],
				[],
				[this.#savingLabel ? "Waiting for the reviewed save to finish." : selectorCancelHint("back")],
			);
		}
		if (this.#detail) {
			const actions = ["Navigate to this point", "Edit label"];
			const allDetails = [
				`Identity: ${this.#detail.node.entry.id}`,
				`Parent: ${this.#detail.node.entry.parentId ?? "Root"}`,
				`Type: ${entryRole(this.#detail.node)}`,
				`Timestamp: ${this.#detail.node.entry.timestamp}`,
				`Label: ${this.#detail.node.label ?? "None"}`,
				`Position: ${this.#detail.node.entry.id === this.currentLeafId ? "Current leaf" : this.#activePath.has(this.#detail.node.entry.id) ? "Current path" : "Alternate branch"}`,
				...wrapTextWithAnsi(`Content: ${entryText(this.#detail.node, true) || "No display content"}`, inner),
			];
			const detailCapacity = Math.max(2, this.rows() - 13);
			this.#detailOffset = Math.min(this.#detailOffset, Math.max(0, allDetails.length - detailCapacity));
			const lines = selectorFrame(
				width,
				this.rows(),
				"Tree node details",
				`Session tree · ${this.#detail.node.entry.id}`,
				[],
				actions.map((label, index) => selectorRow([label], [inner - 2], index === this.#detailAction)),
				allDetails.slice(this.#detailOffset, this.#detailOffset + detailCapacity),
				[
					selectorCancelHint("back"),
					...(allDetails.length > detailCapacity
						? [`${selectorKeys("pageUp")}/${selectorKeys("pageDown")}: details`]
						: []),
				],
				{ selectedBodyIndex: this.#detailAction },
			);
			this.#actionRows.clear();
			for (let index = 0; index < actions.length; index++) {
				const row = lines.findIndex(line => Bun.stripANSI(line).includes(actions[index]));
				if (row >= 0) this.#actionRows.set(row, index);
			}
			return lines;
		}

		const body = this.#browseBody(inner);
		const selected = this.#filtered[this.#selected];
		const lines = selectorFrame(
			width,
			this.rows(),
			"Session tree",
			"Inspect an exact node before navigating or labeling",
			[
				theme.fg(
					"muted",
					["default", "no-tools", "user-only", "labeled-only", "all"]
						.map(mode => (mode === this.#filterMode ? `[${mode}]` : mode))
						.join("  "),
				),
			],
			body,
			selected ? wrapTextWithAnsi(`${entryRole(selected.node)} · ${entryText(selected.node)}`, inner) : [],
			[
				"Ctrl+O / Shift+Ctrl+O: switch view · Shift+L: edit selected label",
				selectorCancelHint("back"),
				...(this.#filtered.length > this.#capacity
					? [`${selectorKeys("pageUp")}/${selectorKeys("pageDown")}: page`]
					: []),
			],
			{ selectedBodyIndex: this.#selected - this.#browseStart + 1, stickyBodyRows: 1 },
		);
		this.#hitRows.clear();
		for (
			let index = this.#browseStart;
			index < Math.min(this.#filtered.length, this.#browseStart + this.#capacity);
			index++
		) {
			const marker = this.#filtered[index].node.entry.id.slice(-8);
			const row = lines.findIndex(line => Bun.stripANSI(line).includes(marker));
			if (row >= 0) this.#hitRows.set(row, index);
		}
		return lines;
	}

	async #saveLabel(): Promise<void> {
		if (!this.#detail || !this.#labelEditor || this.#savingLabel) return;
		this.#savingLabel = true;
		this.#labelError = "";
		try {
			const value = this.#labelEditor.input.getValue().trim() || undefined;
			const saved = await this.onLabelChangeCallback?.(this.#detail.node.entry.id, value);
			if (saved === false) return;
			this.#detail.node.label = value;
			this.#labelEditor = undefined;
			this.#applyFilter(this.#detail.node.entry.id);
		} catch (error) {
			this.#labelError = error instanceof Error ? error.message : String(error);
		} finally {
			this.#savingLabel = false;
		}
	}

	handleInput(data: string): void {
		if (this.#labelEditor) {
			if (this.#savingLabel || matchesKey(data, "ctrl+c")) return;
			if (matchesSelectorKey(data, "cancel")) {
				this.#labelEditor = undefined;
				this.#labelError = "";
			} else if (matchesSelectorKey(data, "confirm")) void this.#saveLabel();
			else this.#labelEditor.handleInput(data);
			return;
		}
		if (this.#detail) {
			if (matchesKey(data, "ctrl+c")) return;
			if (matchesSelectorKey(data, "cancel")) {
				this.#detail = undefined;
				this.#detailOffset = 0;
				return;
			}
			if (matchesSelectorKey(data, "pageUp") || matchesSelectorKey(data, "pageDown")) {
				this.#detailOffset = Math.max(0, this.#detailOffset + (matchesSelectorKey(data, "pageUp") ? -3 : 3));
				return;
			}
			if (matchesSelectorKey(data, "up") || matchesSelectorKey(data, "down")) {
				this.#detailAction = 1 - this.#detailAction;
				return;
			}
			if (matchesSelectorKey(data, "confirm")) {
				if (this.#detailAction === 0) void this.onSelect(this.#detail.node.entry.id);
				else this.#labelEditor = new LabelEditor(this.#detail.node.label);
			}
			return;
		}

		if (matchesSelectorKey(data, "cancel")) {
			if (this.#search.getValue()) {
				this.#search.setValue("");
				this.#applyFilter();
			} else this.onCancel();
			return;
		}
		if (matchesKey(data, "ctrl+c")) return;
		if (matchesKey(data, "shift+ctrl+o") || matchesKey(data, "ctrl+shift+o")) this.#cycleFilter(-1);
		else if (matchesKey(data, "ctrl+o")) this.#cycleFilter(1);
		else if (matchesKey(data, "alt+d")) {
			this.#filterMode = "default";
			this.#applyFilter();
		} else if (matchesKey(data, "alt+t")) {
			this.#filterMode = "no-tools";
			this.#applyFilter();
		} else if (matchesKey(data, "alt+u")) {
			this.#filterMode = "user-only";
			this.#applyFilter();
		} else if (matchesKey(data, "alt+l")) {
			this.#filterMode = "labeled-only";
			this.#applyFilter();
		} else if (matchesKey(data, "alt+a")) {
			this.#filterMode = "all";
			this.#applyFilter();
		} else if (matchesKey(data, "shift+l") && !this.#search.getValue()) {
			const item = this.#filtered[this.#selected];
			if (item) {
				this.#detail = item;
				this.#detailAction = 1;
				this.#labelEditor = new LabelEditor(item.node.label);
			}
		} else if (matchesSelectorKey(data, "up") || matchesSelectorKey(data, "down")) {
			if (!this.#filtered.length) return;
			const delta = matchesSelectorKey(data, "up") ? -1 : 1;
			this.#selected = (this.#selected + delta + this.#filtered.length) % this.#filtered.length;
		} else if (matchesSelectorKey(data, "pageUp") || matchesSelectorKey(data, "pageDown")) {
			const delta = matchesSelectorKey(data, "pageUp") ? -this.#capacity : this.#capacity;
			this.#selected = Math.max(0, Math.min(this.#filtered.length - 1, this.#selected + delta));
		} else if (matchesSelectorKey(data, "confirm")) {
			this.#detail = this.#filtered[this.#selected];
			this.#detailAction = 0;
			this.#detailOffset = 0;
		} else {
			this.#search.handleInput(data);
			this.#applyFilter();
		}
	}

	routeMouse(event: SgrMouseEvent, _line: number, _col: number): void {
		if (this.#labelEditor) return;
		if (event.wheel !== null) {
			this.handleInput(event.wheel < 0 ? "\x1b[A" : "\x1b[B");
			return;
		}
		if (!event.leftClick) return;
		if (this.#detail) {
			const action = this.#actionRows.get(event.row);
			if (action === undefined) return;
			this.#detailAction = action;
			this.handleInput("\r");
			return;
		}
		const index = this.#hitRows.get(event.row);
		if (index === undefined) return;
		this.#selected = index;
		this.#detail = this.#filtered[index];
		this.#detailAction = 0;
	}

	/** Kept for focused component tests and extension-internal diagnostics. */
	getTreeList(): TreeSelectorComponent {
		return this;
	}

	getSearchQuery(): string {
		return this.#search.getValue();
	}

	getSelectedNode(): SessionTreeNode | undefined {
		return this.#filtered[this.#selected]?.node;
	}

	invalidate(): void {}
}
