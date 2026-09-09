import {
	Container,
	getKeybindings,
	matchesKey,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@f5-sales-demo/pi-tui";
import { theme } from "../theme/theme";

/** A single bounded frame shared by provider, model and connection choices. */
export function selectorFrame(
	width: number,
	height: number,
	title: string,
	purpose: string,
	navigation: string[],
	body: string[],
	details: string[],
	footer: string[],
): string[] {
	const columns = Math.max(4, Math.min(100, width));
	const inner = columns - 4;
	const box = theme.boxSharp;
	const edge = theme.fg("border", box.vertical);
	const horizontal = theme.fg("border", box.horizontal.repeat(columns));
	const line = (value: string) => {
		const fitted = truncateToWidth(value.replace(/[\r\n]+/g, " · "), inner);
		return `${edge} ${fitted}${" ".repeat(Math.max(0, inner - visibleWidth(fitted)))} ${edge}`;
	};
	const head = [theme.bold(title), ...(purpose ? [theme.fg("muted", purpose)] : []), ...navigation];
	const tail = [
		...details.slice(0, Math.max(0, height - head.length - footer.length - 5)),
		...footer.map(value => theme.fg("muted", value)),
	];
	const budget = Math.max(0, height - head.length - tail.length - 3);
	return [
		horizontal,
		...head.map(line),
		horizontal,
		...body.slice(0, budget).map(line),
		...tail.map(line),
		horizontal,
	];
}

export function selectorRow(cells: string[], widths: number[], selected = false): string {
	const row = cells
		.map((cell, index) => {
			const width = widths[index];
			const fitted = truncateToWidth(cell, width);
			return fitted + " ".repeat(Math.max(0, width - visibleWidth(fitted)));
		})
		.join("  ");
	const text = `${selected ? theme.nav.cursor : " "} ${row}`;
	return selected ? theme.bg("selectedBg", theme.fg("text", text)) : theme.fg("text", text);
}

type SelectorAction = "up" | "down" | "confirm" | "cancel" | "pageUp" | "pageDown";
export function selectorKeys(action: SelectorAction): string {
	return getKeybindings()
		.getKeys(`tui.select.${action}`)
		.map(key =>
			key === "escape"
				? "Esc"
				: key
						.split("+")
						.map(part => part.charAt(0).toUpperCase() + part.slice(1))
						.join("+"),
		)
		.join("/");
}
export function matchesSelectorKey(data: string, action: SelectorAction): boolean {
	const keybindings = getKeybindings();
	return (
		keybindings.matches(data, `tui.select.${action}`) ||
		(action === "confirm" && data === "\n" && keybindings.getKeys("tui.select.confirm").includes("enter"))
	);
}
export function selectorNavigationHint(confirm = "select"): string {
	return `${selectorKeys("up")}/${selectorKeys("down")}: navigate · ${selectorKeys("confirm")}: ${confirm}`;
}
export function selectorCancelHint(action = "back"): string {
	return `${selectorKeys("cancel")}: ${action}`;
}

export interface SelectorChoice {
	label: string;
	description?: string;
}
export class ConnectionChoiceComponent extends Container {
	#selected = 0;
	constructor(
		private title: string,
		private purpose: string,
		private choices: SelectorChoice[],
		private onSelect: (index: number) => void,
		private onCancel: () => void,
		private rows: () => number = () => process.stdout.rows || 24,
	) {
		super();
	}
	override render(width: number): string[] {
		const available = Math.max(1, this.rows() - 10);
		const start = Math.max(0, this.#selected - available + 1);
		return selectorFrame(
			width,
			this.rows(),
			this.title,
			this.purpose,
			[],
			this.choices
				.slice(start, start + available)
				.map((choice, index) =>
					selectorRow([choice.label], [Math.min(100, width) - 6], start + index === this.#selected),
				),
			[this.choices[this.#selected]?.description ?? ""],
			[selectorNavigationHint(), selectorCancelHint()],
		);
	}
	handleInput(data: string): void {
		if (matchesSelectorKey(data, "cancel")) this.onCancel();
		else if (matchesSelectorKey(data, "up"))
			this.#selected = (this.#selected - 1 + this.choices.length) % this.choices.length;
		else if (matchesSelectorKey(data, "down")) this.#selected = (this.#selected + 1) % this.choices.length;
		else if (matchesSelectorKey(data, "confirm")) this.onSelect(this.#selected);
	}
}

/** Keep links, masked input and cancellation in one connection frame. */
export class ConnectionInputComponent extends Container {
	constructor(
		private title: string,
		public purpose: string,
		public input: import("@f5-sales-demo/pi-tui").Input,
		private rows: () => number,
		public content = new Container(),
	) {
		super();
	}
	override render(width: number): string[] {
		const inner = Math.max(1, Math.min(100, width) - 4);
		return selectorFrame(
			width,
			this.rows(),
			this.title,
			"",
			[],
			this.content.render(inner),
			[...wrapTextWithAnsi(this.purpose, inner).slice(0, 3), ...this.input.render(inner)],
			[`${selectorKeys("confirm")}: submit · ${selectorCancelHint("cancel")}`],
		);
	}
	handleInput(data: string): void {
		if (matchesSelectorKey(data, "cancel")) this.input.onEscape?.();
		else if (matchesSelectorKey(data, "confirm")) this.input.onSubmit?.(this.input.getValue());
		else if (!matchesKey(data, "enter")) this.input.handleInput(data);
	}
}
