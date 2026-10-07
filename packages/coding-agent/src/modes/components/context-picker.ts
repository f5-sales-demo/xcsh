import { Container, getKeybindings, Input, wrapTextWithAnsi } from "@f5-sales-demo/pi-tui";
import { formatKeyHints } from "../../config/keybindings";
import type { ContextChoice, ContextTarget } from "../../services/xcsh-context";
import {
	matchesSelectorKey,
	selectorCancelHint,
	selectorCompactRow,
	selectorFrame,
	selectorKeys,
	selectorProse,
} from "./selector-frame";

export type ContextPickerResult =
	| { target: ContextTarget; action: "activate" | "actions" }
	| { action: "create" | "manage" };
const identity = (target: ContextTarget) => `${target.source}:${target.name}`;
const clean = (value: string) => value.replace(/[\x00-\x1f\x7f]/g, "");

export interface ContextPickerState {
	search: string;
	selected: string;
}

export class ContextPicker extends Container {
	#search = new Input();
	#selected = "";
	#pageSize = 5;
	#detailOffset = 0;
	#detailLength = 0;
	#detailCapacity = 2;
	#error = "";
	constructor(
		private choices: ContextChoice[],
		private active: ContextTarget | null,
		private done: (value?: ContextPickerResult) => void,
		private rows: () => number = () => process.stdout.rows || 24,
		state?: ContextPickerState,
	) {
		super();
		if (state) this.#search.setValue(state.search);
		this.#selected =
			state?.selected ??
			(active && choices.some(choice => identity(choice.target) === identity(active))
				? identity(active)
				: choices[0]
					? identity(choices[0].target)
					: "create");
	}
	get state(): ContextPickerState {
		return { search: this.#search.getValue(), selected: this.#selected };
	}
	refresh(choices: ContextChoice[]): void {
		this.choices = choices;
		this.#ensureSelection();
	}
	#filtered(): ContextChoice[] {
		const query = this.#search.getValue().toLowerCase();
		return this.choices.filter(choice =>
			[
				choice.target.name,
				choice.target.source,
				choice.context?.apiUrl ?? "",
				choice.context?.defaultNamespace ?? "",
			].some(value => value.toLowerCase().includes(query)),
		);
	}
	#ids(): string[] {
		return [
			...this.#filtered().map(choice => identity(choice.target)),
			"create",
			"manage",
			...(this.#search.getValue() ? ["clear"] : []),
		];
	}
	#ensureSelection(): void {
		const ids = this.#ids();
		if (!ids.includes(this.#selected)) this.#selected = ids[0];
	}
	override render(width: number): string[] {
		this.#ensureSelection();
		const filtered = this.#filtered();
		const selected = filtered.find(choice => identity(choice.target) === this.#selected);
		this.#pageSize = Math.max(1, this.rows() - 14);
		const body = [
			selectorProse(`Search: ${clean(this.#search.getValue()) || "type to filter"}`),
			...filtered.map(choice => {
				const active = this.active && identity(this.active) === identity(choice.target);
				const label = `${clean(choice.target.name)} · ${choice.target.source}${active ? " · active" : ""} · ${choice.error ? "unavailable" : "unchecked"} · ${clean(choice.context?.apiUrl ?? "")} · ${clean(choice.context?.defaultNamespace ?? "")}`;
				return selectorCompactRow(label, identity(choice.target) === this.#selected, label);
			}),
			...(!filtered.length ? [selectorProse(this.choices.length ? "No matches" : "No saved contexts")] : []),
			...["Create context", "Manage contexts", ...(this.#search.getValue() ? ["Clear search"] : [])].map(
				(label, index) => selectorCompactRow(label, ["create", "manage", "clear"][index] === this.#selected),
			),
		];
		const keys = getKeybindings();
		const actionHint = keys.getDefinition("app.context.actions")
			? formatKeyHints(keys.getKeys("app.context.actions"))
			: "Ctrl+O";
		const details = wrapTextWithAnsi(
			this.#error ||
				selected?.error ||
				(selected?.context
					? `${clean(selected.context.apiUrl)} · namespace ${clean(selected.context.defaultNamespace)} · ${selected.target.source} · authentication unchecked`
					: ""),
			Math.max(1, Math.min(width, 100) - 6),
		);
		this.#detailCapacity = Math.max(2, Math.floor(this.rows() / 5));
		this.#detailLength = details.length;
		this.#detailOffset = Math.min(this.#detailOffset, Math.max(0, details.length - this.#detailCapacity));
		return selectorFrame(
			width,
			this.rows(),
			"Choose context",
			"Select the tenant for future turns",
			[],
			body,
			details.slice(this.#detailOffset, this.#detailOffset + this.#detailCapacity),
			[
				`${selectorKeys("up")}/${selectorKeys("down")}: navigate · ${selectorKeys("confirm")}: select`,
				`${actionHint}: context actions`,
				...(details.length > this.#detailCapacity ? ["Ctrl+N/Ctrl+P: endpoint details"] : []),
				selectorCancelHint("close"),
			],
			{
				stickyBodyRows: 1,
				selectedBodyIndex: body.findIndex(row => row.kind === "compact-row" && row.selected),
				minimumDetailRows: 2,
				selectedDetail: "provided",
			},
		);
	}
	handleInput(data: string): void {
		if (matchesSelectorKey(data, "cancel")) {
			this.done();
			return;
		}
		if (data === "\x0e" || data === "\x10") {
			this.#detailOffset = Math.max(
				0,
				Math.min(
					this.#detailLength - this.#detailCapacity,
					this.#detailOffset + (data === "\x0e" ? this.#detailCapacity : -this.#detailCapacity),
				),
			);
			return;
		}
		const ids = this.#ids();
		const index = ids.indexOf(this.#selected);
		if (
			matchesSelectorKey(data, "up") ||
			matchesSelectorKey(data, "down") ||
			matchesSelectorKey(data, "pageUp") ||
			matchesSelectorKey(data, "pageDown")
		) {
			const delta = matchesSelectorKey(data, "pageUp")
				? -this.#pageSize
				: matchesSelectorKey(data, "pageDown")
					? this.#pageSize
					: matchesSelectorKey(data, "up")
						? -1
						: 1;
			this.#selected = ids[Math.max(0, Math.min(ids.length - 1, index + delta))];
			this.#error = "";
			this.#detailOffset = 0;
			return;
		}
		const keys = getKeybindings();
		const actions = keys.getDefinition("app.context.actions")
			? keys.matches(data, "app.context.actions")
			: data === "\x0f";
		if (matchesSelectorKey(data, "confirm") || actions) {
			const choice = this.#filtered().find(choice => identity(choice.target) === this.#selected);
			if (choice) {
				if (!actions && (choice.error || process.env.XCSH_API_URL)) {
					this.#error = choice.error ?? "Unset XCSH_API_URL and restart to select a saved context.";
					return;
				}
				this.done({ target: choice.target, action: actions ? "actions" : "activate" });
			} else if (this.#selected === "clear") {
				this.#search.setValue("");
				this.#ensureSelection();
			} else this.done({ action: this.#selected as "create" | "manage" });
			return;
		}
		this.#search.handleInput(data);
		this.#ensureSelection();
		this.#error = "";
	}
}

/** Small shared adapter for guided text input and action choices. */
export class ContextInput extends Container {
	#input = new Input();
	constructor(
		private title: string,
		private detail: string,
		value: string,
		masked: boolean,
		private done: (value?: string) => void,
		private rows: () => number = () => process.stdout.rows || 24,
	) {
		super();
		this.#input.setValue(value);
		this.#input.setMasked(masked);
	}
	override render(width: number): string[] {
		return selectorFrame(
			width,
			this.rows(),
			this.title,
			"",
			[],
			this.#input.render(Math.max(1, width - 6)).map(line => selectorCompactRow(line)),
			[this.detail],
			["Enter: continue", selectorCancelHint("back")],
		);
	}
	handleInput(data: string): void {
		if (matchesSelectorKey(data, "cancel")) this.done();
		else if (matchesSelectorKey(data, "confirm")) this.done(this.#input.getValue());
		else this.#input.handleInput(data);
	}
}

export class ContextMenu extends Container {
	#selected = 0;
	constructor(
		private title: string,
		private options: string[],
		private done: (index?: number) => void,
		private rows: () => number = () => process.stdout.rows || 24,
	) {
		super();
	}
	override render(width: number): string[] {
		return selectorFrame(
			width,
			this.rows(),
			this.title,
			"",
			[],
			this.options.map((label, index) => selectorCompactRow(label, index === this.#selected)),
			[],
			[
				`${selectorKeys("up")}/${selectorKeys("down")}: navigate · ${selectorKeys("confirm")}: select`,
				selectorCancelHint("back"),
			],
			{ selectedBodyIndex: this.#selected },
		);
	}
	handleInput(data: string): void {
		if (matchesSelectorKey(data, "cancel")) this.done();
		else if (matchesSelectorKey(data, "confirm")) this.done(this.#selected);
		else if (matchesSelectorKey(data, "up")) this.#selected = Math.max(0, this.#selected - 1);
		else if (matchesSelectorKey(data, "down")) this.#selected = Math.min(this.options.length - 1, this.#selected + 1);
	}
}
