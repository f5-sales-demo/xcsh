import {
	Container,
	getKeybindings,
	matchesKey,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@f5-sales-demo/pi-tui";
import { theme } from "../theme/theme";

export interface SelectorFrameRow {
	content: string;
	selected: boolean;
}

export type SelectorFrameLine = string | SelectorFrameRow;

export interface SelectorFrameOptions {
	/** Index of the selected row in `body`; used to retain it when the frame is height-constrained. */
	selectedBodyIndex?: number;
	/** Leading body rows, such as table headings, that remain visible while the choices scroll. */
	stickyBodyRows?: number;
	/** Optional upper bound for body rows in otherwise tall terminals. */
	maxBodyRows?: number;
	/** Intentional stable detail area for asynchronous status updates. Empty caller entries are still discarded. */
	minimumDetailRows?: number;
}

function selectorFrameColumns(width: number): number {
	return Math.max(4, Math.min(100, width));
}

export function selectorFramePadding(width: number): number {
	return selectorFrameColumns(width) >= 80 ? 2 : 1;
}

/** Width available to aligned headings, rows, details and controls inside the shared gutters. */
export function selectorFrameContentWidth(width: number): number {
	const columns = selectorFrameColumns(width);
	return Math.max(1, columns - 2 - selectorFramePadding(columns) * 2);
}

function hasVisibleContent(value: string): boolean {
	return visibleWidth(value.replace(/[\r\n]+/g, "").trim()) > 0;
}

function normalizeLine(value: string): string {
	return value.replace(/[\r\n]+/g, " · ");
}

function wrapSection(values: string[], width: number): string[] {
	return values.flatMap(value => {
		if (!hasVisibleContent(value)) return [];
		return wrapTextWithAnsi(normalizeLine(value), width).filter(hasVisibleContent);
	});
}

function windowBody(
	body: SelectorFrameLine[],
	visibleRows: number,
	selectedIndex: number | undefined,
	stickyRows: number,
): SelectorFrameLine[] {
	if (visibleRows <= 0) return [];
	if (body.length <= visibleRows) return body;
	const stickyCount = Math.min(stickyRows, visibleRows - 1, body.length);
	const capacity = visibleRows - stickyCount;
	const selected = Math.max(stickyCount, Math.min(selectedIndex ?? stickyCount, body.length - 1));
	const start = Math.max(stickyCount, Math.min(selected - capacity + 1, body.length - capacity));
	return [...body.slice(0, stickyCount), ...body.slice(start, start + capacity)];
}

/** A single bounded frame shared by provider, model and connection choices. */
export function selectorFrame(
	width: number,
	height: number,
	title: string,
	purpose: string,
	navigation: string[],
	body: SelectorFrameLine[],
	details: string[],
	footer: string[],
	options: SelectorFrameOptions = {},
): string[] {
	const columns = selectorFrameColumns(width);
	const padding = selectorFramePadding(columns);
	const contentWidth = selectorFrameContentWidth(columns);
	const box = theme.boxRound;
	const sharp = theme.boxSharp;
	const border = (value: string) => theme.fg("border", value);
	const edge = border(box.vertical);
	const top = border(`${box.topLeft}${box.horizontal.repeat(columns - 2)}${box.topRight}`);
	const divider = border(`${sharp.teeRight}${box.horizontal.repeat(columns - 2)}${sharp.teeLeft}`);
	const bottom = border(`${box.bottomLeft}${box.horizontal.repeat(columns - 2)}${box.bottomRight}`);
	const line = (value: SelectorFrameLine) => {
		const row = typeof value === "string" ? undefined : value;
		const fitted = truncateToWidth(normalizeLine(typeof value === "string" ? value : value.content), contentWidth);
		const content = `${" ".repeat(padding)}${fitted}${" ".repeat(
			Math.max(0, contentWidth - visibleWidth(fitted)),
		)}${" ".repeat(padding)}`;
		return row?.selected
			? `${edge}${theme.bg("selectedBg", theme.fg("text", content))}${edge}`
			: `${edge}${content}${edge}`;
	};

	const heading = [theme.bold(normalizeLine(title))];
	const purposeLines = wrapSection(purpose ? [purpose] : [], contentWidth)
		.slice(0, 2)
		.map(value => theme.fg("muted", value));
	const navigationLines = navigation.filter(hasVisibleContent).map(normalizeLine);
	const detailLines = wrapSection(details, contentWidth);
	while (detailLines.length < (options.minimumDetailRows ?? 0)) detailLines.push("");
	const footerLines = wrapSection(footer, contentWidth).map(value => theme.fg("muted", value));
	const normalizedBody = body.filter(value => typeof value !== "string" || hasVisibleContent(value));

	const gaps = {
		headingToNavigation: navigationLines.length > 0,
		bodyToDetails: normalizedBody.length > 0 && detailLines.length > 0,
		detailsToFooter: detailLines.length > 0 && footerLines.length > 0,
	};
	const gapCount = () => Object.values(gaps).filter(Boolean).length;
	const fixedRows = () =>
		2 +
		heading.length +
		purposeLines.length +
		navigationLines.length +
		1 +
		detailLines.length +
		footerLines.length +
		gapCount();
	const preferredBodyRows = Math.min(normalizedBody.length, options.maxBodyRows ?? normalizedBody.length);

	// Spacing is intentionally optional: preserve the information and controls before whitespace.
	for (const gap of ["headingToNavigation", "bodyToDetails", "detailsToFooter"] as const) {
		if (fixedRows() + preferredBodyRows <= height) break;
		gaps[gap] = false;
	}

	let bodyRows = Math.min(preferredBodyRows, Math.max(0, height - fixedRows()));
	let visibleBody = windowBody(
		normalizedBody,
		bodyRows,
		options.selectedBodyIndex,
		Math.max(0, options.stickyBodyRows ?? 0),
	);

	// Pathological tiny terminals still keep the enclosure intact. Normal supported sizes do not enter this branch.
	const nonBodyRows = fixedRows();
	if (nonBodyRows > height) {
		const overflow = nonBodyRows - height;
		detailLines.splice(Math.max(1, detailLines.length - overflow));
		bodyRows = Math.min(preferredBodyRows, Math.max(0, height - fixedRows()));
		visibleBody = windowBody(
			normalizedBody,
			bodyRows,
			options.selectedBodyIndex,
			Math.max(0, options.stickyBodyRows ?? 0),
		);
	}

	return [
		top,
		...heading.map(line),
		...purposeLines.map(line),
		...(gaps.headingToNavigation ? [line("")] : []),
		...navigationLines.map(line),
		divider,
		...visibleBody.map(line),
		...(gaps.bodyToDetails ? [line("")] : []),
		...detailLines.map(line),
		...(gaps.detailsToFooter ? [line("")] : []),
		...footerLines.map(line),
		bottom,
	];
}

export function selectorRow(
	cells: string[],
	widths: number[],
	selected = false,
	tone: "text" | "muted" = "text",
): SelectorFrameRow {
	const row = cells
		.map((cell, index) => {
			const width = Math.max(0, widths[index] ?? 0);
			const fitted = truncateToWidth(cell, width);
			return fitted + " ".repeat(Math.max(0, width - visibleWidth(fitted)));
		})
		.join("  ");
	const text = `${selected ? theme.nav.cursor : " "} ${row}`;
	return { content: theme.fg(tone, text), selected };
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
		const contentWidth = selectorFrameContentWidth(width);
		return selectorFrame(
			width,
			this.rows(),
			this.title,
			this.purpose,
			[],
			this.choices.map((choice, index) => selectorRow([choice.label], [contentWidth - 2], index === this.#selected)),
			[this.choices[this.#selected]?.description ?? ""],
			[selectorNavigationHint(), selectorCancelHint()],
			{ selectedBodyIndex: this.#selected },
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
		const inner = selectorFrameContentWidth(width);
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
