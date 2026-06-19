import type { ElementHandle, Page, SerializedAXNode } from "puppeteer";
import { type AxNode, matchNode, matchNodes, NotFoundError } from "./ax";
import {
	CONTROL_SELECTOR,
	findControlBearingAncestor,
	findSectionContainer,
	LABEL_SELECTORS,
	normLabel,
	STRIP_SUFFIX,
} from "./dom-context";
import { normLabel as dtNormLabel, findDatatableColumnInput } from "./dt-context";
import { parseLocator } from "./selector";

/** ARIA input roles treated as datatable column targets. */
const DATATABLE_INPUT_ROLES = new Set(["textbox", "spinbutton", "searchbox", "combobox"]);

/** Regex to detect a datatable-column context phrase (ends with " table" or " table row"). */
const DATATABLE_CONTEXT_RE = /\s+table(?:\s+row)?$/i;

/**
 * Attempt to resolve a datatable column input by injecting the SAME
 * (unit-tested) findDatatableColumnInput/normLabel into the live page via
 * evaluateHandle — their source is reflected via .toString() of the real
 * dt-context exports, so there is one canonical implementation with zero
 * hand-copied logic here.
 *
 * Returns null (without throwing) when the datatable element is not found,
 * so the caller can fall through to the generic context-scoping path.
 */
async function findDatatableColumnInputHandle(
	page: Page,
	columnName: string,
	which: "first" | "last",
): Promise<ElementHandle | null> {
	const expr = `(() => {
  const normLabel = ${dtNormLabel.toString()};
  const findDatatableColumnInput = ${findDatatableColumnInput.toString()};
  return findDatatableColumnInput(document, ${JSON.stringify(columnName)}, ${JSON.stringify(which)});
})()`;

	const handle = await page.evaluateHandle(expr);
	const el = handle.asElement() as ElementHandle | null;
	if (!el) {
		await handle.dispose();
		return null;
	}
	return el;
}

/**
 * Resolve the section container for a `context` phrase by running the SAME
 * (unit-tested) findSectionContainer/normLabel in the live page — their source
 * is reflected via .toString() / JSON.stringify of the real dom-context exports,
 * so there is one canonical implementation with zero hand-copied logic here.
 */
async function findSectionContainerHandle(page: Page, phrase: string): Promise<ElementHandle> {
	// Build the injected IIFE entirely from the real dom-context exports.
	// Declare dependencies before dependents (normLabel before findSectionContainer, etc.).
	const expr = `(() => {
  const STRIP_SUFFIX = ${STRIP_SUFFIX.toString()};
  const LABEL_SELECTORS = ${JSON.stringify(LABEL_SELECTORS)};
  const CONTROL_SELECTOR = ${JSON.stringify(CONTROL_SELECTOR)};
  const normLabel = ${normLabel.toString()};
  const findControlBearingAncestor = ${findControlBearingAncestor.toString()};
  const findSectionContainer = ${findSectionContainer.toString()};
  return findSectionContainer(document, ${JSON.stringify(phrase)});
})()`;

	const handle = await page.evaluateHandle(expr);
	const el = handle.asElement() as ElementHandle | null;
	if (!el) {
		await handle.dispose();
		throw new Error(`context container not found for "${phrase}"`);
	}
	return el;
}

export async function resolve(page: Page, selector: string, context?: string): Promise<ElementHandle> {
	const loc = parseLocator(selector);
	if (loc.kind === "css") {
		const h = (await page.$(loc.css)) as ElementHandle | null;
		if (!h) throw new Error(`CSS selector matched nothing: ${loc.css}`);
		return h;
	}

	// Datatable column path — try BEFORE the generic context-scoping path.
	// Triggered when: context ends with " table" or " table row" AND the
	// locator targets an input-like ARIA role.
	if (
		context &&
		DATATABLE_CONTEXT_RE.test(context) &&
		(loc.kind === "role" || loc.kind === "roleName") &&
		DATATABLE_INPUT_ROLES.has(loc.role)
	) {
		const columnName = context.replace(DATATABLE_CONTEXT_RE, "").trim();
		const which: "first" | "last" = /row$/i.test(context) ? "last" : "first";
		const dtHandle = await findDatatableColumnInputHandle(page, columnName, which);
		if (dtHandle) return dtHandle;
		// Fall through to the generic path if not found
	}

	let root: ElementHandle | undefined;
	try {
		if (context) root = await findSectionContainerHandle(page, context);
		const snapshot = (await page.accessibility.snapshot({
			interestingOnly: false,
			...(root ? { root } : {}),
		})) as SerializedAXNode | null;
		if (!snapshot) throw new Error("accessibility snapshot unavailable");
		let node: SerializedAXNode;
		if (context) {
			const axSnapshot = snapshot as unknown as AxNode;
			const nodes = matchNodes(axSnapshot, loc);
			if (nodes.length === 0)
				throw new NotFoundError(`No AX node found for ${JSON.stringify(loc)} in context "${context}"`);
			node = nodes[0] as unknown as SerializedAXNode;
		} else {
			node = matchNode(snapshot as unknown as AxNode, loc) as unknown as SerializedAXNode;
		}
		const handle = await node.elementHandle();
		if (!handle) throw new Error(`matched AX node for "${selector}" has no backing DOM element`);
		return handle as ElementHandle;
	} finally {
		if (root) await root.dispose().catch(() => {});
	}
}
