import {
	Input,
	type SelectItem,
	SelectList,
	type SelectListTheme,
	type SgrMouseEvent,
	truncateToWidth,
} from "@f5-sales-demo/pi-tui";
import {
	matchesSelectorKey,
	selectorCancelHint,
	selectorFrame,
	selectorFrameContentWidth,
	selectorKeys,
	selectorNavigationHint,
	selectorRow,
} from "./selector-frame";

/**
 * Selector-frame implementation used by legacy first-party selector exports.
 * It remains a SelectList subtype so existing consumers keep their API while
 * first-party screens gain shared search, framing, paging, and mouse behavior.
 */
export class SearchableSelectList extends SelectList {
	readonly #search = new Input();
	#selectedIndex = 0;
	#searchOrigin = 0;
	#visible = 1;
	#hitRows = new Map<number, number>();

	constructor(
		private readonly title: string,
		private readonly purpose: string,
		private readonly sourceItems: ReadonlyArray<SelectItem>,
		private readonly maxVisibleRows: number,
		theme: SelectListTheme,
	) {
		super(sourceItems, maxVisibleRows, theme);
	}

	override setFilter(filter: string): void {
		this.#search.setValue(filter);
		this.#selectedIndex = this.#filtered()[0] ?? -1;
	}

	override setSelectedIndex(index: number): void {
		this.#selectedIndex = Math.max(0, Math.min(index, this.sourceItems.length - 1));
		this.#searchOrigin = this.#selectedIndex;
	}

	override getSelectedItem(): SelectItem | null {
		return this.sourceItems[this.#selectedIndex] ?? null;
	}

	#filtered(): number[] {
		const query = this.#search.getValue().trim().toLocaleLowerCase();
		return this.sourceItems.flatMap((item, index) =>
			!query || `${item.label}\n${item.value}\n${item.description ?? ""}`.toLocaleLowerCase().includes(query)
				? [index]
				: [],
		);
	}

	override render(width: number): string[] {
		const rows = process.stdout.rows || 24;
		const inner = selectorFrameContentWidth(width);
		const filtered = this.#filtered();
		const position = filtered.indexOf(this.#selectedIndex);
		this.#visible = Math.max(1, Math.min(this.maxVisibleRows, rows - 13));
		const start = Math.max(0, Math.min(position - Math.floor(this.#visible / 2), filtered.length - this.#visible));
		const visible = filtered.slice(start, start + this.#visible);
		const selected = this.sourceItems[this.#selectedIndex];
		const body = visible.length
			? visible.map(index => {
					const item = this.sourceItems[index]!;
					return selectorRow([item.label], [inner - 2], index === this.#selectedIndex);
				})
			: [this.sourceItems.length ? "No matching options." : "No options available."];
		const lines = selectorFrame(
			width,
			rows,
			this.title,
			this.purpose,
			[`${filtered.length} of ${this.sourceItems.length} options`, ...this.#search.render(inner)],
			body,
			selected
				? [selected.description ?? "", selected.value !== selected.label ? `Identity: ${selected.value}` : ""]
				: [],
			[
				selectorNavigationHint(),
				selectorCancelHint(this.#search.getValue() ? "clear search" : "back"),
				...(filtered.length > this.#visible
					? [`${selectorKeys("pageUp")}/${selectorKeys("pageDown")}: options`]
					: []),
			],
			{ selectedBodyIndex: visible.indexOf(this.#selectedIndex) },
		);
		this.#hitRows.clear();
		let cursor = 0;
		for (const index of visible) {
			const label = truncateToWidth(this.sourceItems[index]!.label, inner - 2);
			const line = lines.findIndex((candidate, row) => row >= cursor && Bun.stripANSI(candidate).includes(label));
			if (line >= 0) {
				this.#hitRows.set(line, index);
				cursor = line + 1;
			}
		}
		return lines;
	}

	override hitTest(line: number): number | undefined {
		return this.#hitRows.get(line);
	}

	override setHoverIndex(_index: number | null): void {}

	override handleWheel(delta: -1 | 1): void {
		this.#move(delta);
	}

	override clickItem(index: number): void {
		const item = this.sourceItems[index];
		if (!item || !this.#filtered().includes(index)) return;
		if (index !== this.#selectedIndex) {
			this.#selectedIndex = index;
			this.onSelectionChange?.(item);
		}
		this.onSelect?.(item);
	}

	override routeMouse(event: SgrMouseEvent, line: number): void {
		if (event.release) return;
		if (event.wheel !== null) this.handleWheel(event.wheel);
		else if (event.leftClick) {
			const index = this.hitTest(line);
			if (index !== undefined) this.clickItem(index);
		}
	}

	#move(delta: number): void {
		const filtered = this.#filtered();
		if (!filtered.length) return;
		const position = Math.max(0, filtered.indexOf(this.#selectedIndex));
		const next = Math.max(0, Math.min(filtered.length - 1, position + delta));
		this.#selectedIndex = filtered[next]!;
		this.onSelectionChange?.(this.sourceItems[this.#selectedIndex]!);
	}

	override handleInput(data: string): void {
		const filtered = this.#filtered();
		if (matchesSelectorKey(data, "cancel")) {
			if (this.#search.getValue()) {
				this.#search.setValue("");
				this.#selectedIndex = this.#searchOrigin;
			} else this.onCancel?.();
			return;
		}
		if (matchesSelectorKey(data, "up") || matchesSelectorKey(data, "down")) {
			this.#move(matchesSelectorKey(data, "up") ? -1 : 1);
			return;
		}
		if (matchesSelectorKey(data, "pageUp") || matchesSelectorKey(data, "pageDown")) {
			this.#move((matchesSelectorKey(data, "pageUp") ? -1 : 1) * this.#visible);
			return;
		}
		if (matchesSelectorKey(data, "confirm")) {
			const selected = this.sourceItems[this.#selectedIndex];
			if (selected && filtered.includes(this.#selectedIndex)) this.onSelect?.(selected);
			return;
		}
		const before = this.#search.getValue();
		this.#search.handleInput(data);
		if (this.#search.getValue() !== before) {
			if (!before) this.#searchOrigin = this.#selectedIndex;
			const next = this.#filtered();
			if (!this.#search.getValue()) this.#selectedIndex = this.#searchOrigin;
			else if (!next.includes(this.#selectedIndex)) this.#selectedIndex = next[0] ?? -1;
			const selected = this.sourceItems[this.#selectedIndex];
			if (selected) this.onSelectionChange?.(selected);
		}
	}
}
