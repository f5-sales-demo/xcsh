/**
 * Shared searchable extension selector; caller option strings and callbacks are preserved.
 */
import {
	Container,
	Input,
	matchesKey,
	type SgrMouseEvent,
	type TUI,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@f5-sales-demo/pi-tui";
import { matchesAppExternalEditor } from "../utils/keybinding-matchers";
import { CountdownTimer } from "./countdown-timer";
import {
	matchesSelectorKey,
	selectorCancelHint,
	selectorFrame,
	selectorFrameContentWidth,
	selectorKeys,
	selectorNavigationHint,
	selectorRow,
} from "./selector-frame";

export interface HookSelectorOptions {
	tui?: TUI;
	timeout?: number;
	onTimeout?: () => void;
	initialIndex?: number;
	outline?: boolean;
	maxVisible?: number;
	onLeft?: () => void;
	onRight?: () => void;
	onExternalEditor?: () => void;
	helpText?: string;
}

export class HookSelectorComponent extends Container {
	#search = new Input();
	#selected: number;
	#searchOrigin = 0;
	#countdown: CountdownTimer | undefined;
	#remaining: number | undefined;
	#closed = false;
	#offset = 0;
	#capacity = 1;
	#detailLength = 0;
	#visible = 1;
	#hitRows = new Map<number, number>();
	constructor(
		private readonly title: string,
		private readonly options: string[],
		private readonly onSelect: (option: string) => void,
		private readonly onCancel: () => void,
		private readonly opts?: HookSelectorOptions,
	) {
		super();
		this.#selected = Math.max(0, Math.min(opts?.initialIndex ?? 0, options.length - 1));
		if (opts?.timeout && opts.timeout > 0 && opts.tui) {
			this.#countdown = new CountdownTimer(
				opts.timeout,
				opts.tui,
				seconds => {
					this.#remaining = seconds;
				},
				() => {
					if (this.#closed) return;
					this.#closed = true;
					opts.onTimeout?.();
					this.onCancel();
				},
			);
		}
	}
	#filtered(): number[] {
		const query = this.#search.getValue().trim().toLocaleLowerCase();
		return this.options.flatMap((value, index) =>
			!query || value.toLocaleLowerCase().includes(query) ? [index] : [],
		);
	}
	override render(width: number): string[] {
		const rows = this.opts?.tui?.terminal?.rows || process.stdout.rows || 24;
		const inner = selectorFrameContentWidth(width);
		const filtered = this.#filtered();
		const position = filtered.indexOf(this.#selected);
		this.#visible = Math.max(1, Math.min(this.opts?.maxVisible ?? 12, rows - 14));
		const start = Math.max(0, Math.min(position - Math.floor(this.#visible / 2), filtered.length - this.#visible));
		const visible = filtered.slice(start, start + this.#visible);
		const question = wrapTextWithAnsi(this.title, inner);
		const selected = this.options[this.#selected] ?? "";
		const detailText = [
			...(question.length > 2 ? [this.title] : []),
			...(selected.includes("\n") || visibleWidth(selected) > inner - 2 ? [selected] : []),
		].join("\n");
		const details = detailText ? wrapTextWithAnsi(detailText, inner) : [];
		this.#capacity = Math.max(1, rows - visible.length - 11);
		this.#detailLength = details.length;
		this.#offset = Math.min(this.#offset, Math.max(0, details.length - this.#capacity));
		const lines = selectorFrame(
			width,
			rows,
			"Choose an option",
			this.title,
			[`${filtered.length} of ${this.options.length} options`, ...this.#search.render(inner)],
			visible.length
				? visible.map(index => selectorRow([this.options[index]], [inner - 2], index === this.#selected))
				: [this.options.length ? "No matching options." : "No options available."],
			details.slice(this.#offset, this.#offset + this.#capacity),
			[
				...(this.#remaining === undefined ? [] : [`Closes after ${this.#remaining}s idle`]),
				selectorNavigationHint(),
				selectorCancelHint(this.#search.getValue() ? "clear search" : "back"),
				...((this.opts?.onLeft || this.opts?.onRight) && !this.opts?.helpText ? ["Tab/Shift+Tab: section"] : []),
				...(details.length > this.#capacity || filtered.length > this.#visible
					? [
							`${selectorKeys("pageUp")}/${selectorKeys("pageDown")}: ${details.length > this.#capacity ? "details" : "options"}`,
						]
					: []),
				...(this.opts?.helpText ? [this.opts.helpText] : []),
			],
			{ selectedBodyIndex: visible.indexOf(this.#selected) },
		);
		this.#hitRows.clear();
		let cursor = 0;
		for (const index of visible) {
			const label = truncateToWidth(this.options[index]?.split("\n")[0] ?? "", inner - 2);
			const row = lines.findIndex((candidate, line) => line >= cursor && Bun.stripANSI(candidate).includes(label));
			if (row >= 0) {
				this.#hitRows.set(row, index);
				cursor = row + 1;
			}
		}
		return lines;
	}
	routeMouse(event: SgrMouseEvent, row: number, _col: number): void {
		if (this.#closed || event.release) return;
		if (event.wheel !== null) {
			const filtered = this.#filtered();
			const next = Math.max(
				0,
				Math.min(filtered.length - 1, filtered.indexOf(this.#selected) + Math.sign(event.wheel)),
			);
			this.#selected = filtered[next] ?? -1;
			this.#offset = 0;
			this.opts?.tui?.requestRender();
			return;
		}
		if (!event.leftClick) return;
		const index = this.#hitRows.get(row);
		if (index === undefined || !this.#filtered().includes(index)) return;
		this.#selected = index;
		this.#closed = true;
		this.dispose();
		this.onSelect(this.options[index]);
	}
	handleInput(data: string): void {
		if (this.#closed) return;
		this.#countdown?.reset();
		const filtered = this.#filtered();
		const position = filtered.indexOf(this.#selected);
		if (matchesSelectorKey(data, "cancel")) {
			if (this.#search.getValue()) {
				this.#search.setValue("");
				this.#selected = this.#searchOrigin;
				this.#offset = 0;
			} else {
				this.#closed = true;
				this.dispose();
				this.onCancel();
			}
		} else if (matchesSelectorKey(data, "up") || matchesSelectorKey(data, "down")) {
			const next = Math.max(0, Math.min(filtered.length - 1, position + (matchesSelectorKey(data, "up") ? -1 : 1)));
			this.#selected = filtered[next] ?? -1;
			this.#offset = 0;
		} else if (matchesSelectorKey(data, "confirm")) {
			if (filtered.includes(this.#selected)) {
				this.#closed = true;
				this.dispose();
				this.onSelect(this.options[this.#selected]);
			}
		} else if (matchesSelectorKey(data, "pageDown") || matchesSelectorKey(data, "pageUp")) {
			const direction = matchesSelectorKey(data, "pageDown") ? 1 : -1;
			if (this.#detailLength > this.#capacity) {
				this.#offset = Math.max(
					0,
					Math.min(this.#detailLength - this.#capacity, this.#offset + direction * this.#capacity),
				);
			} else {
				this.#selected =
					filtered[Math.max(0, Math.min(filtered.length - 1, position + direction * this.#visible))] ?? -1;
				this.#offset = 0;
			}
		} else if (matchesKey(data, "tab") && this.opts?.onRight) this.opts.onRight();
		else if (matchesKey(data, "shift+tab") && this.opts?.onLeft) this.opts.onLeft();
		else if (this.opts?.onExternalEditor && matchesAppExternalEditor(data)) this.opts.onExternalEditor();
		else {
			const before = this.#search.getValue();
			this.#search.handleInput(data);
			if (this.#search.getValue() !== before) {
				if (!before) this.#searchOrigin = this.#selected;
				const next = this.#filtered();
				if (!this.#search.getValue()) this.#selected = this.#searchOrigin;
				else if (!next.includes(this.#selected)) this.#selected = next[0] ?? -1;
				this.#offset = 0;
			}
		}
	}
	dispose(): void {
		this.#countdown?.dispose();
	}
}
