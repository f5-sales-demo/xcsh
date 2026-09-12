import { type Component, Input, routeSgrMouseInput, truncateToWidth, wrapTextWithAnsi } from "@f5-sales-demo/pi-tui";
import type { SessionMessageEntry } from "../../session/session-manager";
import { buildCopyTargets, type CopyTarget, initialCopyEntries } from "../utils/copy-targets";
import {
	matchesSelectorKey,
	selectorCancelHint,
	selectorFrame,
	selectorFrameContentWidth,
	selectorKeys,
	selectorNavigationHint,
	selectorRow,
} from "./selector-frame";

export interface CopySelectorDeps {
	requestRender: () => void;
	onPick: (content: string, label: string) => void | Promise<void>;
	onOpen?: (href: string, label: string) => void;
	onCancel: () => void;
	viewportRows?: () => number;
	initialHistoryTruncated?: boolean;
	loadAllEntries?: () => readonly SessionMessageEntry[];
}

interface CopyAction {
	id: string;
	kind: "copy" | "open";
	label: string;
	callbackLabel: string;
	content: string;
	blockIndex?: number;
	href?: string;
}

const INITIAL_ENTRIES = 600;
const LOAD_EARLIER_ID = "__xcsh_load_earlier_transcript__";

function preview(text: string): string {
	return text.replace(/\s+/gu, " ").trim() || "(empty)";
}

function targetText(target: CopyTarget): string {
	return target.content || target.blocks.map(block => block.content).join("\n\n");
}

function actionsFor(target: CopyTarget): CopyAction[] {
	const actions: CopyAction[] = [];
	const whole = targetText(target);
	if (whole) {
		actions.push({
			id: `copy:${target.id}:turn`,
			kind: "copy",
			label: `Copy ${target.label}`,
			callbackLabel: target.label,
			content: whole,
		});
	}
	for (let index = 0; index < target.blocks.length; index++) {
		const block = target.blocks[index]!;
		actions.push({
			id: `copy:${target.id}:block:${index}`,
			kind: "copy",
			label: `Copy ${block.label}`,
			callbackLabel: block.label,
			content: block.content,
			blockIndex: index,
		});
		if (block.href) {
			actions.push({
				id: `open:${target.id}:block:${index}`,
				kind: "open",
				label: `Open ${block.label}`,
				callbackLabel: block.label,
				content: block.href,
				blockIndex: index,
				href: block.href,
			});
		}
	}
	return actions;
}

/** Searchable, identity-preserving transcript browser with explicit copy/open actions. */
export class CopySelectorComponent implements Component {
	readonly #allEntries: readonly SessionMessageEntry[];
	readonly #deps: CopySelectorDeps;
	readonly #search = new Input();
	#targets: CopyTarget[];
	#truncated: boolean;
	#requiresAllHistory: boolean;
	#selectedTargetId: string;
	#priorTargetId: string | undefined;
	#phase: "browse" | "actions" = "browse";
	#selectedActionId: string | undefined;
	#detailOffset = 0;
	#detailCapacity = 1;
	#detailLength = 0;
	#browseCapacity = 1;
	#mouseRows = new Map<number, { kind: "target" | "action"; id: string }>();
	#disposed = false;

	constructor(entries: readonly SessionMessageEntry[], deps: CopySelectorDeps) {
		this.#allEntries = entries;
		this.#deps = deps;
		const initial = initialCopyEntries(entries, INITIAL_ENTRIES, deps.initialHistoryTruncated);
		this.#truncated = initial.truncated;
		this.#requiresAllHistory = initial.requiresAllHistory;
		this.#targets = buildCopyTargets(initial.entries);
		this.#selectedTargetId = this.#targets.at(-1)?.id ?? (this.#truncated ? LOAD_EARLIER_ID : "");
		this.#priorTargetId = this.#targets.at(-1)?.id;
	}

	get targetCount(): number {
		return this.#targets.length;
	}

	get selectedCopySource(): { targetId: string; blockIndex?: number } | undefined {
		if (this.#selectedTargetId === LOAD_EARLIER_ID) return undefined;
		if (this.#phase === "browse") return { targetId: this.#selectedTargetId };
		const action = this.#selectedAction();
		if (action?.kind !== "copy") return undefined;
		return action.blockIndex === undefined
			? { targetId: this.#selectedTargetId }
			: { targetId: this.#selectedTargetId, blockIndex: action.blockIndex };
	}

	get canLoadEarlier(): boolean {
		return this.#truncated;
	}

	get touchedEntryCount(): number {
		return this.#requiresAllHistory
			? INITIAL_ENTRIES
			: this.#targets.reduce((count, target) => count + target.entries.length, 0);
	}

	invalidate(): void {}

	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		this.#mouseRows.clear();
	}

	#query(): string {
		return this.#search.getValue().toLocaleLowerCase().trim();
	}

	#matchingTargets(): CopyTarget[] {
		const words = this.#query().split(/\s+/u).filter(Boolean);
		return this.#targets.filter(target => {
			const haystack = `${target.id} ${target.label} ${target.content} ${target.blocks
				.map(block => `${block.label} ${block.content}`)
				.join(" ")}`.toLocaleLowerCase();
			return words.every(word => haystack.includes(word));
		});
	}

	#browseIds(): string[] {
		const targets = this.#matchingTargets().map(target => target.id);
		const earlierMatches = !this.#query() || "load earlier transcript".includes(this.#query());
		return this.#truncated && earlierMatches ? [LOAD_EARLIER_ID, ...targets] : targets;
	}

	#selectedTarget(): CopyTarget | undefined {
		return this.#targets.find(target => target.id === this.#selectedTargetId);
	}

	#actions(): CopyAction[] {
		const target = this.#selectedTarget();
		return target ? actionsFor(target) : [];
	}

	#selectedAction(): CopyAction | undefined {
		const actions = this.#actions();
		return actions.find(action => action.id === this.#selectedActionId) ?? actions[0];
	}

	#loadAll(): void {
		if (!this.#truncated) return;
		const restoreId = this.#priorTargetId;
		this.#targets = buildCopyTargets(this.#deps.loadAllEntries?.() ?? this.#allEntries);
		this.#selectedTargetId =
			(restoreId && this.#targets.some(target => target.id === restoreId) ? restoreId : undefined) ??
			this.#targets.at(-1)?.id ??
			"";
		this.#priorTargetId = this.#selectedTargetId === LOAD_EARLIER_ID ? undefined : this.#selectedTargetId;
		this.#truncated = false;
		this.#requiresAllHistory = false;
		this.#detailOffset = 0;
		this.#deps.requestRender();
	}

	#move(ids: string[], delta: number): boolean {
		if (ids.length === 0) return false;
		const selectedId = this.#phase === "browse" ? this.#selectedTargetId : (this.#selectedActionId ?? "");
		const current = Math.max(0, ids.indexOf(selectedId));
		const next = Math.max(0, Math.min(ids.length - 1, current + delta));
		if (next === current && ids[current] === selectedId) return false;
		if (this.#phase === "browse") {
			if (this.#selectedTargetId !== LOAD_EARLIER_ID) this.#priorTargetId = this.#selectedTargetId;
			this.#selectedTargetId = ids[next]!;
		} else {
			this.#selectedActionId = ids[next];
			this.#detailOffset = 0;
		}
		return true;
	}

	#openTarget(): void {
		if (this.#selectedTargetId === LOAD_EARLIER_ID) return this.#loadAll();
		const first = this.#actions()[0];
		if (!first) return;
		this.#phase = "actions";
		this.#selectedActionId = first.id;
		this.#detailOffset = 0;
		this.#deps.requestRender();
	}

	#activateAction(): void {
		const action = this.#selectedAction();
		if (!action) return;
		if (action.kind === "open" && action.href) this.#deps.onOpen?.(action.href, action.callbackLabel);
		else void this.#deps.onPick(action.content, action.callbackLabel);
	}

	#activateMouse(row: number): void {
		const item = this.#mouseRows.get(row);
		if (!item) return;
		if (item.kind === "target") {
			if (this.#selectedTargetId !== LOAD_EARLIER_ID) this.#priorTargetId = this.#selectedTargetId;
			this.#selectedTargetId = item.id;
			this.#openTarget();
		} else {
			this.#selectedActionId = item.id;
			this.#detailOffset = 0;
			this.#activateAction();
		}
	}

	handleInput(data: string): void {
		if (this.#disposed) return;
		if (data.startsWith("\x1b[<")) {
			routeSgrMouseInput(data, event => {
				if (event.wheel !== null) {
					const ids = this.#phase === "browse" ? this.#browseIds() : this.#actions().map(action => action.id);
					if (this.#move(ids, event.wheel)) this.#deps.requestRender();
					return true;
				}
				if (event.leftClick) this.#activateMouse(event.row);
				return true;
			});
			return;
		}
		if (matchesSelectorKey(data, "cancel")) {
			if (this.#phase === "actions") {
				this.#phase = "browse";
				this.#selectedActionId = undefined;
				this.#detailOffset = 0;
				this.#deps.requestRender();
			} else if (this.#search.getValue()) {
				this.#search.setValue("");
				this.#deps.requestRender();
			} else this.#deps.onCancel();
			return;
		}
		const ids = this.#phase === "browse" ? this.#browseIds() : this.#actions().map(action => action.id);
		if (matchesSelectorKey(data, "up") || matchesSelectorKey(data, "down")) {
			if (this.#move(ids, matchesSelectorKey(data, "up") ? -1 : 1)) this.#deps.requestRender();
			return;
		}
		if (matchesSelectorKey(data, "pageUp") || matchesSelectorKey(data, "pageDown")) {
			if (this.#phase === "actions") {
				const delta = matchesSelectorKey(data, "pageUp") ? -this.#detailCapacity : this.#detailCapacity;
				const next = Math.max(
					0,
					Math.min(Math.max(0, this.#detailLength - this.#detailCapacity), this.#detailOffset + delta),
				);
				if (next !== this.#detailOffset) {
					this.#detailOffset = next;
					this.#deps.requestRender();
				}
			} else if (this.#move(ids, (matchesSelectorKey(data, "pageUp") ? -1 : 1) * this.#browseCapacity)) {
				this.#deps.requestRender();
			}
			return;
		}
		if (matchesSelectorKey(data, "confirm")) {
			if (this.#phase === "browse") this.#openTarget();
			else this.#activateAction();
			return;
		}
		if (this.#phase === "browse") {
			const before = this.#search.getValue();
			this.#search.handleInput(data);
			if (before !== this.#search.getValue()) {
				const matches = this.#browseIds();
				if (!matches.includes(this.#selectedTargetId) && matches[0]) this.#selectedTargetId = matches[0];
				this.#deps.requestRender();
			}
		}
	}

	#mapMouseRows(rendered: string[], items: Array<{ id: string; token: string }>, kind: "target" | "action"): void {
		this.#mouseRows.clear();
		const used = new Set<number>();
		for (const item of items) {
			const row = rendered.findIndex((line, index) => !used.has(index) && Bun.stripANSI(line).includes(item.token));
			if (row >= 0) {
				used.add(row);
				this.#mouseRows.set(row, { kind, id: item.id });
			}
		}
	}

	#renderBrowse(width: number, height: number): string[] {
		const inner = selectorFrameContentWidth(width);
		const ids = this.#browseIds();
		const selectedIndex = Math.max(0, ids.indexOf(this.#selectedTargetId));
		const idWidth = Math.min(26, Math.max(12, Math.floor(inner * 0.28)));
		const labelWidth = Math.min(22, Math.max(12, Math.floor(inner * 0.24)));
		const body = ids.map(id => {
			if (id === LOAD_EARLIER_ID) {
				return selectorRow(
					["Load earlier transcript", "Fetch omitted session entries"],
					[idWidth + labelWidth + 2, Math.max(1, inner - idWidth - labelWidth - 6)],
					id === this.#selectedTargetId,
				);
			}
			const target = this.#targets.find(candidate => candidate.id === id)!;
			return selectorRow(
				[target.label, target.id, preview(targetText(target))],
				[labelWidth, idWidth, Math.max(1, inner - labelWidth - idWidth - 8)],
				id === this.#selectedTargetId,
			);
		});
		const selected = ids.includes(this.#selectedTargetId) ? this.#selectedTarget() : undefined;
		const details =
			ids.length === 0 && this.#query()
				? ["Clear search to restore the previous selection."]
				: selected
					? [
							`Identity: ${selected.id}`,
							`${selected.blocks.length} extracted ${selected.blocks.length === 1 ? "item" : "items"}`,
						]
					: this.#truncated && this.#selectedTargetId === LOAD_EARLIER_ID
						? ["Load the omitted transcript entries, then remain at the previous stable entry identity."]
						: this.#targets.length === 0
							? ["Nothing can be copied from this session yet."]
							: [];
		this.#browseCapacity = Math.max(1, height - 11 - details.length);
		const remapped = selectorNavigationHint("open");
		const overflow = ids.length > this.#browseCapacity;
		const rendered = selectorFrame(
			width,
			height,
			"Copy transcript",
			"Choose a session-qualified transcript entry to inspect",
			this.#search.render(Math.max(1, inner - 8)).map(line => `Search: ${line}`),
			body.length
				? body
				: [
						this.#targets.length || this.#truncated
							? "No matching transcript entries"
							: "No transcript entries available",
					],
			details,
			[
				...(remapped ? [remapped] : []),
				...(overflow ? [`${selectorKeys("pageUp")}/${selectorKeys("pageDown")}: transcript entries`] : []),
				selectorCancelHint(this.#search.getValue() ? "clear search" : "close"),
			],
			{ selectedBodyIndex: selectedIndex, stickyBodyRows: this.#truncated ? 1 : 0 },
		);
		this.#mapMouseRows(
			rendered,
			ids.map(id => ({
				id,
				token: id === LOAD_EARLIER_ID ? "Load earlier transcript" : truncateToWidth(id, idWidth),
			})),
			"target",
		);
		return rendered;
	}

	#renderActions(width: number, height: number): string[] {
		const target = this.#selectedTarget()!;
		const inner = selectorFrameContentWidth(width);
		const actions = this.#actions();
		const selectedIndex = Math.max(
			0,
			actions.findIndex(action => action.id === this.#selectedActionId),
		);
		const selected = actions[selectedIndex];
		const details = (selected?.content ?? "").split("\n").flatMap(line => wrapTextWithAnsi(line || " ", inner));
		this.#detailCapacity = Math.max(1, height - 13 - Math.min(actions.length, 7));
		this.#detailLength = details.length;
		this.#detailOffset = Math.min(this.#detailOffset, Math.max(0, this.#detailLength - this.#detailCapacity));
		const overflow = details.length > this.#detailCapacity;
		const remapped = selectorNavigationHint("activate action");
		const rendered = selectorFrame(
			width,
			height,
			`Copy transcript · ${target.label}`,
			`Session entry ${target.id} · Choose an explicitly labelled action`,
			[`Transcript > ${target.label}`],
			actions.map((action, index) =>
				selectorRow([`${index + 1}. ${action.label}`], [inner - 2], index === selectedIndex),
			),
			details.slice(this.#detailOffset, this.#detailOffset + this.#detailCapacity),
			[
				...(remapped ? [remapped] : []),
				...(overflow
					? [
							`${selectorKeys("pageUp")}/${selectorKeys("pageDown")}: details ${this.#detailOffset + 1}–${Math.min(details.length, this.#detailOffset + this.#detailCapacity)} of ${details.length}`,
						]
					: []),
				selectorCancelHint("back to transcript"),
			],
			{ selectedBodyIndex: selectedIndex, maxBodyRows: 7 },
		);
		this.#mapMouseRows(
			rendered,
			actions.map((action, index) => ({ id: action.id, token: `${index + 1}. ${action.label}` })),
			"action",
		);
		return rendered;
	}

	render(width: number): string[] {
		const height = Math.max(8, this.#deps.viewportRows?.() ?? process.stdout.rows ?? 40);
		return this.#phase === "browse" ? this.#renderBrowse(width, height) : this.#renderActions(width, height);
	}
}
