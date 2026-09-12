import { Container, Input, type SgrMouseEvent, truncateToWidth } from "@f5-sales-demo/pi-tui";
import type { HistoryEntry, HistoryStorage } from "../../session/history-storage";
import { matchesAppInterrupt } from "../utils/keybinding-matchers";
import {
	matchesSelectorKey,
	selectorCancelHint,
	selectorFrame,
	selectorFrameContentWidth,
	selectorKeys,
	selectorNavigationHint,
	selectorRow,
} from "./selector-frame";

export class HistorySearchComponent extends Container {
	readonly #searchInput = new Input();
	#results: HistoryEntry[] = [];
	#selectedIndex = 0;
	#searchOrigin = 0;
	#visible = 1;
	#hitRows = new Map<number, number>();
	readonly #resultLimit = 100;

	constructor(
		private readonly historyStorage: HistoryStorage,
		private readonly onSelect: (prompt: string) => void,
		private readonly onCancel: () => void,
	) {
		super();
		this.#updateResults();
	}

	override render(width: number): string[] {
		const rows = process.stdout.rows || 24;
		const inner = selectorFrameContentWidth(width);
		this.#visible = Math.max(1, Math.min(12, rows - 13));
		const start = Math.max(
			0,
			Math.min(this.#selectedIndex - Math.floor(this.#visible / 2), this.#results.length - this.#visible),
		);
		const visible = this.#results.slice(start, start + this.#visible);
		const selected = this.#results[this.#selectedIndex];
		const lines = selectorFrame(
			width,
			rows,
			"Search history",
			"Find a previous prompt and return it to the editor without submitting it.",
			[`${this.#results.length} result${this.#results.length === 1 ? "" : "s"}`, ...this.#searchInput.render(inner)],
			visible.length
				? visible.map((entry, index) =>
						selectorRow(
							[entry.prompt.replace(/\s+/gu, " ").trim()],
							[inner - 2],
							start + index === this.#selectedIndex,
						),
					)
				: ["No matching history."],
			selected
				? [
						selected.prompt,
						selected.cwd ? `Working directory: ${selected.cwd}` : "",
						`Saved: ${new Date(selected.created_at * 1000).toISOString()}`,
					]
				: [],
			[
				selectorNavigationHint("restore prompt"),
				selectorCancelHint(this.#searchInput.getValue() ? "clear search" : "back"),
				...(this.#results.length > this.#visible
					? [`${selectorKeys("pageUp")}/${selectorKeys("pageDown")}: results`]
					: []),
			],
			{ selectedBodyIndex: this.#selectedIndex - start },
		);
		this.#hitRows.clear();
		let cursor = 0;
		for (let index = 0; index < visible.length; index++) {
			const label = truncateToWidth(visible[index]!.prompt.replace(/\s+/gu, " ").trim(), inner - 2);
			const row = lines.findIndex((line, candidate) => candidate >= cursor && Bun.stripANSI(line).includes(label));
			if (row >= 0) {
				this.#hitRows.set(row, start + index);
				cursor = row + 1;
			}
		}
		return lines;
	}

	#move(delta: number): void {
		if (!this.#results.length) return;
		this.#selectedIndex = Math.max(0, Math.min(this.#results.length - 1, this.#selectedIndex + delta));
	}

	handleInput(keyData: string): void {
		if (matchesSelectorKey(keyData, "up") || matchesSelectorKey(keyData, "down")) {
			this.#move(matchesSelectorKey(keyData, "up") ? -1 : 1);
			return;
		}
		if (matchesSelectorKey(keyData, "pageUp") || matchesSelectorKey(keyData, "pageDown")) {
			this.#move((matchesSelectorKey(keyData, "pageUp") ? -1 : 1) * this.#visible);
			return;
		}
		if (matchesSelectorKey(keyData, "confirm")) {
			const selected = this.#results[this.#selectedIndex];
			if (selected) this.onSelect(selected.prompt);
			return;
		}
		if (matchesSelectorKey(keyData, "cancel")) {
			if (this.#searchInput.getValue()) {
				this.#searchInput.setValue("");
				this.#updateResults(this.#searchOrigin);
			} else this.onCancel();
			return;
		}
		if (matchesAppInterrupt(keyData)) return;
		const hadQuery = Boolean(this.#searchInput.getValue());
		this.#searchInput.handleInput(keyData);
		if (!hadQuery && this.#searchInput.getValue()) this.#searchOrigin = this.#selectedIndex;
		this.#updateResults();
	}

	routeMouse(event: SgrMouseEvent, line: number): void {
		if (event.release) return;
		if (event.wheel !== null) this.#move(event.wheel);
		else if (event.leftClick) {
			const index = this.#hitRows.get(line);
			if (index !== undefined) {
				if (index === this.#selectedIndex) this.onSelect(this.#results[index]!.prompt);
				else this.#selectedIndex = index;
			}
		}
	}

	#updateResults(selectedIndex = 0): void {
		const query = this.#searchInput.getValue().trim();
		this.#results = query
			? this.historyStorage.search(query, this.#resultLimit)
			: this.historyStorage.getRecent(this.#resultLimit);
		this.#selectedIndex = Math.max(0, Math.min(selectedIndex, this.#results.length - 1));
	}
}
