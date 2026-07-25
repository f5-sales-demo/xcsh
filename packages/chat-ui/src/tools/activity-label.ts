/**
 * Humanize a host-tool name into a compact activity label for the transcript —
 * the "Read data ›" affordance Claude for Office shows while it works. The Office
 * host tools have an explicit, curated mapping (present-tense, no raw function
 * names); anything else (browser-automation tools, future tools) falls back to a
 * Title-cased de-snake of the name so the line is never a bare identifier.
 *
 * Pure and framework-free — unit-tested in isolation.
 */

/** Curated labels for the Office.js host tools (Excel / Word / PowerPoint). */
const LABELS: Readonly<Record<string, string>> = {
	// Excel
	get_workbook_info: "Reading workbook structure",
	list_sheets: "Listing sheets",
	read_range: "Reading cells",
	read_table: "Reading table",
	get_formulas: "Reading formulas",
	get_cell_metadata: "Reading cell formatting",
	read_named_range: "Reading named range",
	write_range: "Writing cells",
	sort_filter_table: "Sorting table",
	// Word
	read_document: "Reading document",
	get_document_info: "Reading document structure",
	read_paragraphs: "Reading paragraphs",
	read_selection: "Reading selection",
	get_comments: "Reading comments",
	get_tracked_changes: "Reading tracked changes",
	insert_text: "Inserting text",
	insert_paragraph: "Inserting paragraph",
	// PowerPoint
	read_slides: "Reading slides",
	get_presentation_info: "Reading presentation structure",
	read_slide_shapes: "Reading slide shapes",
	read_slide_layout: "Reading slide layout",
	add_slide: "Adding slide",
	add_text_box: "Adding text box",
	modify_shape_text: "Editing shape text",
	// Provider-side ("server") tools: the model's own built-ins, which the provider executes
	// rather than the host. Named for what the user is waiting on (#2340).
	web_search: "Searching the web",
	web_fetch: "Fetching a page",
};

/** Title-case the first word of a de-snaked name: `take_screenshot` → `Take screenshot`. */
function humanize(name: string): string {
	const words = name.split("_").filter(Boolean).join(" ");
	return words.charAt(0).toUpperCase() + words.slice(1);
}

/** A friendly, compact activity label for a host-tool call. */
export function toolActivityLabel(toolName: string): string {
	const key = toolName.trim();
	if (!key) return "Working";
	return LABELS[key] ?? humanize(key);
}
