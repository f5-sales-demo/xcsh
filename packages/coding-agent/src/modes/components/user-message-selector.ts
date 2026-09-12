import {
	Container,
	Input,
	type MouseRoutable,
	matchesKey,
	type SgrMouseEvent,
	wrapTextWithAnsi,
} from "@f5-sales-demo/pi-tui";
import { theme } from "../../modes/theme/theme";
import { fuzzyFilter } from "../../utils/fuzzy";
import {
	matchesSelectorKey,
	type SelectorFrameLine,
	selectorCancelHint,
	selectorFrame,
	selectorFrameContentWidth,
	selectorKeys,
	selectorRow,
} from "./selector-frame";

interface UserMessageItem {
	id: string;
	text: string;
	timestamp?: string;
}

export class UserMessageSelectorComponent extends Container implements MouseRoutable {
	#filtered: UserMessageItem[];
	#selected = 0;
	#search = new Input();
	#detail: UserMessageItem | undefined;
	#capacity = 1;
	#hitRows = new Map<number, number>();
	constructor(
		private readonly messages: UserMessageItem[],
		private readonly onSelect: (entryId: string) => void | Promise<void>,
		private readonly onCancel: () => void,
		private readonly rows: () => number = () => process.stdout.rows || 24,
	) {
		super();
		this.#filtered = messages;
		this.#selected = Math.max(0, messages.length - 1);
		this.#search.onEscape = () => {};
		if (messages.length === 0) setTimeout(onCancel, 100);
	}

	#filter(): void {
		this.#filtered = fuzzyFilter(this.messages, this.#search.getValue(), message => `${message.id} ${message.text}`);
		this.#selected = Math.min(this.#selected, Math.max(0, this.#filtered.length - 1));
	}

	override render(width: number): string[] {
		const inner = selectorFrameContentWidth(width);
		if (this.#detail) {
			return selectorFrame(
				width,
				this.rows(),
				"Branch point details",
				`Session node · ${this.#detail.id}`,
				[],
				[selectorRow(["Create branch here"], [inner - 2], true)],
				wrapTextWithAnsi(this.#detail.text, inner),
				[selectorCancelHint("back")],
				{ selectedBodyIndex: 0 },
			);
		}
		this.#capacity = Math.max(1, this.rows() - 10);
		const start = Math.max(
			0,
			Math.min(this.#selected - Math.floor(this.#capacity / 2), this.#filtered.length - this.#capacity),
		);
		const end = Math.min(this.#filtered.length, start + this.#capacity);
		const body: SelectorFrameLine[] = [
			`Search: ${theme.nav.cursor} ${this.#search.render(Math.max(1, inner - 10))[0] ?? ""}`,
		];
		if (this.#filtered.length === 0)
			body.push(theme.fg("muted", this.#search.getValue() ? "No matching branch points" : "No user messages"));
		else
			body.push(
				...this.#filtered
					.slice(start, end)
					.map((message, index) =>
						selectorRow(
							[`${start + index + 1}. ${message.text.replace(/\s+/g, " ").trim()}`, message.id.slice(-8)],
							[Math.max(8, inner - 14), 10],
							start + index === this.#selected,
						),
					),
			);
		const lines = selectorFrame(
			width,
			this.rows(),
			"Branch from message",
			"Inspect an exact user-message node before creating a new session branch",
			[],
			body,
			[],
			[
				selectorCancelHint("back"),
				...(this.#filtered.length > this.#capacity
					? [`${selectorKeys("pageUp")}/${selectorKeys("pageDown")}: page`]
					: []),
			],
			{ selectedBodyIndex: this.#selected - start + 1, stickyBodyRows: 1 },
		);
		this.#hitRows.clear();
		for (let index = start; index < end; index++) {
			const marker = this.#filtered[index].id.slice(-8);
			const row = lines.findIndex(line => Bun.stripANSI(line).includes(marker));
			if (row >= 0) this.#hitRows.set(row, index);
		}
		return lines;
	}

	handleInput(data: string): void {
		if (this.#detail) {
			if (matchesSelectorKey(data, "cancel")) this.#detail = undefined;
			else if (matchesSelectorKey(data, "confirm")) void this.onSelect(this.#detail.id);
			return;
		}
		if (matchesSelectorKey(data, "cancel")) {
			if (this.#search.getValue()) {
				this.#search.setValue("");
				this.#filter();
			} else this.onCancel();
			return;
		}
		if (matchesKey(data, "ctrl+c")) return;
		if (matchesSelectorKey(data, "up") || matchesSelectorKey(data, "down")) {
			if (this.#filtered.length === 0) return;
			const delta = matchesSelectorKey(data, "up") ? -1 : 1;
			this.#selected = (this.#selected + delta + this.#filtered.length) % this.#filtered.length;
			return;
		}
		if (matchesSelectorKey(data, "pageUp") || matchesSelectorKey(data, "pageDown")) {
			const delta = matchesSelectorKey(data, "pageUp") ? -this.#capacity : this.#capacity;
			this.#selected = Math.max(0, Math.min(this.#filtered.length - 1, this.#selected + delta));
			return;
		}
		if (matchesSelectorKey(data, "confirm")) {
			this.#detail = this.#filtered[this.#selected];
			return;
		}
		this.#search.handleInput(data);
		this.#filter();
	}

	routeMouse(event: SgrMouseEvent, _line: number, _col: number): void {
		if (this.#detail || !event.leftClick) return;
		const index = this.#hitRows.get(event.row);
		if (index === undefined) return;
		this.#selected = index;
		this.#detail = this.#filtered[index];
	}

	getMessageList(): UserMessageSelectorComponent {
		return this;
	}
}
