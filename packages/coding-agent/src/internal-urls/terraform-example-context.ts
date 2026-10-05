import type { Database } from "bun:sqlite";
export function terraformExampleContext(db: Database, path: string): string {
	const source = db
		.query("SELECT provider_type,provider_name,role FROM terraform_documents WHERE path=?")
		.get(path) as { provider_type: string; provider_name: string; role: string } | null;
	if (source?.role !== "example") return "";
	const rows = db
		.query(
			"SELECT d.path,s.anchor FROM terraform_documents d JOIN terraform_sections s ON s.path=d.path WHERE d.provider_type=? AND d.provider_name=? AND d.role='fundamentals' AND s.anchor IN ('root-configuration','prerequisites') ORDER BY s.anchor,d.path",
		)
		.all(source.provider_type, source.provider_name) as { path: string; anchor: string }[];
	if (!rows.length) return "";
	const lines = rows.map(r => `Read ${r.anchor}: xcsh://terraform-documentation/${r.path}?view=context#${r.anchor}`);
	const result = `Complete declaration context; read before drafting:\n${lines.join("\n")}`;
	return Buffer.byteLength(result) <= 1500 ? result : "";
}
