import type { Database } from "bun:sqlite";

/** Verified peer meanings are navigation context, never inferred requirements. */
export function terraformConflictContext(db: Database, path: string, anchor: string): string {
	if (
		!db
			.query(
				'SELECT 1 FROM terraform_relationships WHERE path=? AND anchor=? AND type="conflicts" AND enforcement="provider-schema"',
			)
			.get(path, anchor)
	)
		return "";
	const rows = db
		.query(`SELECT DISTINCT dest.schema_path,dest.description,r.target_path,r.target_anchor FROM terraform_relationships r
 JOIN terraform_destinations own ON own.path=r.path AND own.anchor=r.anchor
 JOIN terraform_destinations dest ON dest.path=r.target_path AND dest.anchor=r.target_anchor AND dest.provider_type=own.provider_type AND dest.provider_name=own.provider_name
 JOIN terraform_sections s ON s.path=dest.path AND s.anchor=dest.anchor
 WHERE r.path=? AND r.anchor=? AND r.type='conflicts' AND r.enforcement='provider-schema' AND r.choice_group IS NOT NULL
 AND r.target_path=r.path AND r.target_anchor LIKE 'schema-%' AND NOT(r.target_path=r.path AND r.target_anchor=r.anchor)
 ORDER BY dest.schema_path COLLATE BINARY,r.target_path COLLATE BINARY,r.target_anchor COLLATE BINARY LIMIT 5`)
		.all(path, anchor) as Array<{
		schema_path: string;
		description: string;
		target_path: string;
		target_anchor: string;
	}>;
	if (!rows.length) return "";
	let content =
		"Documented same-document conflicting field choices (provider-schema, not prerequisites). Compare their meaning before choosing; ask a focused question if the request does not distinguish them.";
	const recovery = `\n\nAdditional conflict choices or descriptions may be omitted. Read the complete containing document: xcsh://terraform-documentation/${path}?view=full`;
	if (Buffer.byteLength(content + recovery) > 2048) return "";
	let emitted = 0;
	for (const row of rows.slice(0, 4)) {
		const link = `xcsh://terraform-documentation/${row.target_path}?view=context#${encodeURIComponent(row.target_anchor)}`;
		let entry = `${row.schema_path}: ${row.description}\nRead: ${link}`;
		if (Buffer.byteLength(entry) > 1400)
			entry = `${row.schema_path}: Read its complete section for the field meaning.\nRead: ${link}`;
		if (Buffer.byteLength(`${content}\n\n${entry}${recovery}`) > 2048) break;
		content += `\n\n${entry}`;
		emitted++;
	}
	if (emitted < rows.length) content += recovery;
	if (Buffer.byteLength(content) > 2048) throw new Error("Conflict comparison recovery exceeds budget");
	return content;
}
