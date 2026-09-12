import { Container, Input, type SelectItem, wrapTextWithAnsi } from "@f5-sales-demo/pi-tui";
import { matchesSelectorKey, selectorFrame, selectorFrameContentWidth, selectorRow } from "./selector-frame";

export class SettingsTextEditor extends Container {
	#input = new Input();
	#error = "";
	#offset = 0;
	#capacity = 1;
	#length = 0;
	constructor(
		private readonly title: string,
		private readonly description: string,
		current: string,
		onSubmit: (value: string) => void,
		private readonly onCancel: () => void,
		private readonly options: { masked?: boolean; purpose?: string } = {},
	) {
		super();
		this.#input.setValue(current);
		this.#input.setMasked(Boolean(options.masked));
		this.#input.handleInput("\x05");
		this.#input.onSubmit = value => {
			try {
				onSubmit(value);
				this.#error = "";
			} catch (error) {
				this.#error = options.masked
					? "Could not apply this value."
					: error instanceof Error
						? error.message
						: String(error);
				this.#offset = 0;
			}
		};
	}
	override render(width: number): string[] {
		const rows = process.stdout.rows || 24;
		const details = wrapTextWithAnsi(
			[this.#error, this.description].filter(Boolean).join(" · "),
			selectorFrameContentWidth(width),
		);
		this.#capacity = Math.max(1, rows - 10);
		this.#length = details.length;
		this.#offset = Math.min(this.#offset, Math.max(0, details.length - this.#capacity));
		return selectorFrame(
			width,
			rows,
			this.title,
			this.options.purpose ?? "Edit draft · Clear field to unset",
			[],
			this.#input.render(selectorFrameContentWidth(width)),
			details.slice(this.#offset, this.#offset + this.#capacity),
			details.length > this.#capacity ? ["PgUp/PgDn: details"] : [],
		);
	}
	handleInput(data: string): void {
		if (matchesSelectorKey(data, "cancel")) this.onCancel();
		else if (matchesSelectorKey(data, "pageDown"))
			this.#offset = Math.min(Math.max(0, this.#length - this.#capacity), this.#offset + this.#capacity);
		else if (matchesSelectorKey(data, "pageUp")) this.#offset = Math.max(0, this.#offset - this.#capacity);
		else this.#input.handleInput(data);
	}
}

/** Search and preview are local; only the caller's draft callback changes a proposed value. */
export class SettingsChoiceEditor extends Container {
	#search = new Input();
	#selected: string;
	#offset = 0;
	#capacity = 1;
	#detailLength = 0;
	#previewQueue: Promise<void> = Promise.resolve();
	#generation = 0;
	#finishing = false;
	#error = "";
	constructor(
		private readonly title: string,
		private readonly description: string,
		private readonly options: ReadonlyArray<SelectItem>,
		private readonly current: string,
		private readonly onSelect: (value: string) => void | Promise<void>,
		private readonly onCancel: () => void | Promise<void>,
		private readonly onPreview?: (value: string) => void | Promise<void>,
		private readonly getPreview?: () => string,
		private readonly requestRender?: () => void,
	) {
		super();
		this.#selected = options.find(option => option.value === current)?.value ?? options[0]?.value ?? "";
	}
	#items(): ReadonlyArray<SelectItem> {
		const words = this.#search.getValue().toLowerCase().trim().split(/\s+/);
		return this.options.filter(option =>
			words.every(word =>
				`${option.label} ${option.value} ${option.description ?? ""}`.toLowerCase().includes(word),
			),
		);
	}
	#selection(): SelectItem | undefined {
		const items = this.#items();
		return items.find(item => item.value === this.#selected) ?? items[0];
	}
	#preview(value: string): void {
		if (!this.onPreview) return;
		const generation = ++this.#generation;
		this.#previewQueue = this.#previewQueue.then(async () => {
			if (generation !== this.#generation) return;
			try {
				await this.onPreview?.(value);
				this.#error = "";
			} catch (error) {
				this.#error = `Preview unavailable: ${error instanceof Error ? error.message : String(error)}`;
			} finally {
				this.requestRender?.();
			}
		});
	}
	#finish(value?: string): void {
		if (this.#finishing) return;
		this.#finishing = true;
		// Stop queued previews; an already-running preview must settle before restoring or accepting.
		++this.#generation;
		const finish = async () => {
			try {
				if (value === undefined) await this.onCancel();
				else {
					if (this.onPreview) await this.onPreview(value);
					await this.onSelect(value);
				}
			} catch (error) {
				this.#error = `Could not finish editing: ${error instanceof Error ? error.message : String(error)}`;
			} finally {
				this.#finishing = false;
				this.requestRender?.();
			}
		};
		if (this.onPreview) void this.#previewQueue.then(finish);
		else void finish();
	}
	override render(width: number): string[] {
		const inner = selectorFrameContentWidth(width);
		const rows = process.stdout.rows || 24;
		const items = this.#items();
		const selected = this.#selection();
		const details = wrapTextWithAnsi(
			[this.description, selected?.description, this.getPreview?.(), this.#error].filter(Boolean).join(" · "),
			inner,
		);
		this.#capacity = Math.max(1, Math.floor(rows / 4));
		this.#detailLength = details.length;
		this.#offset = Math.min(this.#offset, Math.max(0, details.length - this.#capacity));
		return selectorFrame(
			width,
			rows,
			this.title,
			"Choose a draft value · Saved only after combined review",
			this.#search.render(Math.max(1, inner - 8)).map(line => `Search: ${line}`),
			this.#finishing
				? ["Finishing preview…"]
				: items.length
					? items.map(item =>
							selectorRow(
								[`${item.label}${item.value === this.current ? " (current)" : ""}`],
								[inner - 2],
								item === selected,
							),
						)
					: [this.options.length ? "No matching values" : "No values available"],
			details.slice(this.#offset, this.#offset + this.#capacity),
			details.length > this.#capacity ? ["PgUp/PgDn: details"] : [],
			{ selectedBodyIndex: selected ? items.indexOf(selected) : 0 },
		);
	}
	handleInput(data: string): void {
		if (this.#finishing) return;
		if (matchesSelectorKey(data, "cancel")) {
			if (this.#search.getValue()) this.#search.setValue("");
			else this.#finish();
		} else if (matchesSelectorKey(data, "confirm")) {
			const selected = this.#selection();
			if (selected) this.#finish(selected.value);
		} else if (matchesSelectorKey(data, "up") || matchesSelectorKey(data, "down")) {
			const items = this.#items();
			const current = this.#selection();
			const index = current ? items.indexOf(current) : 0;
			const delta = matchesSelectorKey(data, "up") ? -1 : 1;
			const selected = items[(index + delta + items.length) % items.length];
			if (selected) {
				this.#selected = selected.value;
				this.#preview(selected.value);
				this.#offset = 0;
			}
		} else if (matchesSelectorKey(data, "pageDown"))
			this.#offset = Math.min(Math.max(0, this.#detailLength - this.#capacity), this.#offset + this.#capacity);
		else if (matchesSelectorKey(data, "pageUp")) this.#offset = Math.max(0, this.#offset - this.#capacity);
		else {
			this.#search.handleInput(data);
			this.#offset = 0;
		}
	}
}
