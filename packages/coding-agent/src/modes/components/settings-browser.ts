import { Container, Input, type SettingItem, wrapTextWithAnsi } from "@f5-sales-demo/pi-tui";
import { matchesSelectorKey, selectorFrame, selectorFrameContentWidth, selectorRow } from "./selector-frame";

/** Internal settings navigation; paths, not row offsets, retain selection across searches. */
export class SettingsBrowser extends Container {
	#search = new Input();
	#selected: string | undefined;
	#editor: ReturnType<NonNullable<SettingItem["submenu"]>> | undefined;
	#detailOffset = 0;
	#detailCapacity = 1;
	#detailLength = 0;

	constructor(
		private items: SettingItem[],
		private readonly navigation: () => string[],
		private readonly onChange: (id: string, value: string) => void,
		private readonly onCancel: () => void,
		private readonly presentation: {
			title?: string;
			purpose?: string;
			footer?: string[];
			open?: (item: SettingItem) => void;
			details?: (item: SettingItem) => string;
		} = {},
	) {
		super();
		this.#selected = items[0]?.id;
	}
	updateItems(items: SettingItem[]): void {
		this.items = items;
	}

	#matches(): SettingItem[] {
		const words = this.#search.getValue().toLocaleLowerCase().trim().split(/\s+/);
		return this.items.filter(item =>
			words.every(word => `${item.id} ${item.label} ${item.description ?? ""}`.toLocaleLowerCase().includes(word)),
		);
	}

	override render(width: number): string[] {
		if (this.#editor) return this.#editor.render(width);
		const rows = process.stdout.rows || 24;
		const inner = selectorFrameContentWidth(width);
		const items = this.#matches();
		const index = Math.max(
			0,
			items.findIndex(item => item.id === this.#selected),
		);
		const selected = items[index];
		const details = selected
			? wrapTextWithAnsi(
					this.presentation.details?.(selected) ?? `${selected.id}: ${selected.description ?? ""}`,
					inner,
				)
			: [];
		this.#detailCapacity = Math.max(1, Math.floor(rows / 5));
		this.#detailLength = details.length;
		this.#detailOffset = Math.min(this.#detailOffset, Math.max(0, details.length - this.#detailCapacity));
		const labelWidth = Math.max(1, Math.floor((inner - 4) * 0.6));
		return selectorFrame(
			width,
			rows,
			this.presentation.title ?? "Settings",
			this.presentation.purpose ?? "Scope: user settings · Changes are drafts until saved",
			[...this.navigation(), ...this.#search.render(Math.max(1, inner - 8)).map(line => `Search: ${line}`)],
			items.length
				? items.map((item, i) =>
						selectorRow(
							[item.label, item.currentValue],
							[labelWidth, Math.max(1, inner - labelWidth - 4)],
							i === index,
						),
					)
				: [this.items.length ? "No matching settings" : "No settings available"],
			details.slice(this.#detailOffset, this.#detailOffset + this.#detailCapacity),
			[
				...(this.presentation.footer ?? ["Tab/Shift+Tab: section"]),
				...(details.length > this.#detailCapacity ? ["PgUp/PgDn: details"] : []),
			],
			{ selectedBodyIndex: index },
		);
	}

	handleInput(data: string): void {
		if (this.#editor) {
			this.#editor.handleInput?.(data);
			return;
		}
		const items = this.#matches();
		const index = Math.max(
			0,
			items.findIndex(item => item.id === this.#selected),
		);
		if (matchesSelectorKey(data, "cancel")) {
			if (this.#search.getValue()) {
				this.#search.setValue("");
				this.#detailOffset = 0;
			} else this.onCancel();
		} else if (matchesSelectorKey(data, "up") || matchesSelectorKey(data, "down")) {
			const delta = matchesSelectorKey(data, "up") ? -1 : 1;
			this.#selected = items[(index + delta + items.length) % items.length]?.id;
			this.#detailOffset = 0;
		} else if (matchesSelectorKey(data, "pageDown")) {
			this.#detailOffset = Math.min(
				Math.max(0, this.#detailLength - this.#detailCapacity),
				this.#detailOffset + this.#detailCapacity,
			);
		} else if (matchesSelectorKey(data, "pageUp")) {
			this.#detailOffset = Math.max(0, this.#detailOffset - this.#detailCapacity);
		} else if (matchesSelectorKey(data, "confirm")) {
			const item = items[index];
			if (item && this.presentation.open) {
				this.#selected = item.id;
				this.presentation.open(item);
				return;
			}
			if (!item?.submenu) return;
			this.#selected = item.id;
			this.#editor = item.submenu(item.currentValue, value => {
				if (value !== undefined) {
					item.currentValue = value;
					this.onChange(item.id, value);
				}
				this.#editor = undefined;
			});
		} else {
			const before = this.#search.getValue();
			this.#search.handleInput(data);
			if (before !== this.#search.getValue()) this.#detailOffset = 0;
		}
	}
}
