/**
 * DOM context scoping for XC component classes.
 * Pure module — no Puppeteer imports. Works under linkedom in tests and
 * the live document in page.evaluate in the resolver (Task 5).
 *
 * We define minimal structural interfaces instead of relying on the DOM lib
 * (the project tsconfig does not include DOM types globally).
 */

/** Minimal structural interface matching both linkedom and browser Element. */
export interface DomElement {
	tagName: string;
	textContent: string | null;
	className: string | { toString(): string };
	parentElement: DomElement | null;
	querySelector(sel: string): DomElement | null;
	querySelectorAll(sel: string): ArrayLike<DomElement>;
}

/** Minimal structural interface matching both linkedom and browser Document. */
export interface DomDocument {
	body: DomElement | null;
	documentElement: DomElement;
	querySelectorAll(sel: string): ArrayLike<DomElement>;
}

/** Strip a leading asterisk, trim, and collapse internal whitespace. */
export function normLabel(s: string): string {
	return s.trim().replace(/^\*/, "").trim().replace(/\s+/g, " ");
}

/** Suffixes we strip before matching a label phrase. */
export const STRIP_SUFFIX = / (?:section|table|table row|selector)$/i;

/** CSS selectors that identify XC field/section labels. */
export const LABEL_SELECTORS = [
	"label.ves-label_level_3_label",
	"label[class*='ves-label_level_3_label']",
	".datatable-header-cell-label",
	".tile-header__name",
	"label.form-control-label",
];

/** CSS that identifies "interactive" controls — presence means the ancestor is the section container. */
export const CONTROL_SELECTOR = "button, [role='listbox'], .listbox, input";

/**
 * Find the nearest ancestor element that:
 *   1. Is an ancestor of the matched label element, AND
 *   2. Contains at least one interactive control (button / listbox / input).
 *
 * Walk up from the label, stopping at `document.body` (or `documentElement`).
 */
export function findControlBearingAncestor(label: DomElement, doc: DomDocument): DomElement | null {
	const body = doc.body ?? doc.documentElement;
	let current: DomElement | null = label.parentElement;
	while (current && current !== body) {
		if (current.querySelector(CONTROL_SELECTOR)) {
			return current;
		}
		current = current.parentElement;
	}
	return null;
}

/**
 * Given a phrase like "Domains table" or "Origin Pools section",
 * strip the trailing qualifier, find the matching label element in the DOM,
 * then return the nearest ancestor that contains an interactive control.
 *
 * Returns `null` if no label or no control-bearing ancestor is found.
 */
export function findSectionContainer(doc: DomDocument, phrase: string): DomElement | null {
	const bare = phrase.replace(STRIP_SUFFIX, "").trim();
	const want = normLabel(bare);

	// Try each label selector in priority order
	for (const sel of LABEL_SELECTORS) {
		const candidates = Array.from(doc.querySelectorAll(sel));
		for (const el of candidates) {
			if (normLabel(el.textContent ?? "") === want) {
				const container = findControlBearingAncestor(el, doc);
				if (container) return container;
			}
		}
	}

	return null;
}
