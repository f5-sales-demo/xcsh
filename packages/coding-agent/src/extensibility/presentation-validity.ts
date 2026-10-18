import type { PluginView } from "@f5-sales-demo/pi-agent-core/plugin-presentation";

/** A control flag alone must never suppress execution evidence or completion warnings. */
export function usablePluginView(input: unknown): input is PluginView {
	try {
		if (!input || typeof input !== "object" || Array.isArray(input)) return false;
		const view = input as PluginView;
		if (view.summary !== undefined && typeof view.summary !== "string") return false;
		if (
			view.warnings !== undefined &&
			(!Array.isArray(view.warnings) || view.warnings.some(w => typeof w !== "string"))
		)
			return false;
		if (view.sections !== undefined && !Array.isArray(view.sections)) return false;
		let nonempty = Boolean(view.summary?.trim() || view.warnings?.some(w => w.trim()));
		for (const section of view.sections ?? []) {
			if (!section || typeof section !== "object") return false;
			if (section.title !== undefined && typeof section.title !== "string") return false;
			if (section.kind === "fields") {
				if (!section.values || typeof section.values !== "object" || Array.isArray(section.values)) return false;
				nonempty ||= Object.keys(section.values).length > 0;
			} else if (section.kind === "table") {
				if (
					!Array.isArray(section.columns) ||
					!Array.isArray(section.rows) ||
					section.columns.some(
						(c: { key?: unknown; label?: unknown }) =>
							!c || typeof c.key !== "string" || (c.label !== undefined && typeof c.label !== "string"),
					) ||
					section.rows.some((r: unknown) => !r || typeof r !== "object" || Array.isArray(r))
				)
					return false;
				nonempty ||= section.columns.length > 0;
			} else if (section.kind === "code" || section.kind === "markdown") {
				if (typeof section.text !== "string") return false;
				if (
					section.kind === "code" &&
					section.argv !== undefined &&
					(!Array.isArray(section.argv) || section.argv.some((a: unknown) => typeof a !== "string"))
				)
					return false;
				nonempty ||= Boolean(section.text.trim() || (section.kind === "code" && section.argv?.length));
			} else return false;
		}
		return nonempty;
	} catch {
		return false;
	}
}
