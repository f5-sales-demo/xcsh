/**
 * Types for the embedded console field-requirements registry.
 *
 * Source of truth: `api-specs-enriched/config/console_field_metadata.yaml` — a
 * purpose-built, console-form-shaped registry mapping each resource's API field
 * paths to the console form field that edits them (label, section, required,
 * widget, validation, mutually-exclusive groups). Generated at build time by
 * `scripts/generate-console-field-metadata.ts`. Surfaced to the agent through
 * `xcsh://console/<resource>` so it knows every form's required fields and
 * constraints before driving a create workflow.
 */

export interface ConsoleFieldValidation {
	readonly pattern?: string;
	readonly max_length?: number;
	readonly [key: string]: unknown;
}

export interface ConsoleFieldMeta {
	/** Human-readable form field label, e.g. "Domains". */
	readonly label?: string;
	/** Console form section id, e.g. "domains-and-lb-type". */
	readonly form_section?: string;
	/** True when the console form requires this field for create. */
	readonly required?: boolean;
	/** Widget kind: textbox, listbox, table, spinbutton, checkbox, etc. */
	readonly widget_type?: string;
	/** Default value shown in the console form, if any. */
	readonly default?: unknown;
	/** Enumerated options (for listbox/combobox widgets). */
	readonly options?: readonly string[];
	/** Field constraints (regex pattern, max length, …). */
	readonly validation?: ConsoleFieldValidation;
	/** Other API field paths this one is mutually exclusive with (OneOf group). */
	readonly mutually_exclusive_with?: readonly string[];
	readonly notes?: string;
	readonly description?: string;
	/** Remaining upstream keys are preserved verbatim (add_action, nested_*, …). */
	readonly [key: string]: unknown;
}

export interface ConsoleFieldMetadataData {
	/** Version stamp from the api-specs-enriched artifact, or "local". */
	readonly version: string;
	/** Field metadata keyed by snake_case API kind (e.g. "http_loadbalancer"). */
	readonly resources: Readonly<Record<string, Readonly<Record<string, ConsoleFieldMeta>>>>;
}

export const EMPTY_CONSOLE_FIELD_METADATA: ConsoleFieldMetadataData = {
	version: "unavailable",
	resources: {},
};
