import { Database } from "bun:sqlite";

// Query compatibility with the build-only QMD 2.8.3 index. The production
// reader uses Bun SQLite and never indexes, loads extensions, or runs models.
const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const cjkRuns = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu;
const clean = (value: string) => value.replace(/[^\p{L}\p{N}'_]/gu, "").toLowerCase();
const dotted = (value: string) => {
	const parts = value.split(".");
	return parts.length > 1 && parts.every(p => /^[\p{L}\p{N}_]+$/u.test(p));
};
const phrase = (value: string) =>
	value
		.replace(cjkRuns, run => ` ${Array.from(run).join(" ")} `)
		.split(/\s+/)
		.flatMap(part => (dotted(part) ? part.split(".").map(clean).filter(Boolean) : [clean(part)].filter(Boolean)))
		.join(" ");

function lexicalQuery(value: string): string | undefined {
	const positive: string[] = [],
		negative: string[] = [];
	for (const match of value.trim().matchAll(/-?"[^"]*(?:"|$)|-?[^\s"]+/g)) {
		const raw = match[0],
			excluded = raw.startsWith("-");
		const token = excluded ? raw.slice(1) : raw;
		let expressions: string[];
		if (token.startsWith('"')) {
			const text = phrase(token.slice(1).replace(/"$/, "").trim());
			expressions = text ? [`"${text}"`] : [];
		} else if (/^[\p{L}\p{N}][\p{L}\p{N}'-]*-[\p{L}\p{N}][\p{L}\p{N}'-]*$/u.test(token)) {
			const text = token.split("-").map(clean).filter(Boolean).join(" ");
			expressions = text ? [`"${text}"`] : [];
		} else if (dotted(token)) {
			expressions = token
				.split(".")
				.map(clean)
				.filter(Boolean)
				.map(part => `"${part}"*`);
			if (excluded) expressions = [`(${expressions.join(" AND ")})`];
		} else if (cjk.test(token)) {
			const text = phrase(token);
			expressions = text ? [`"${text}"`] : [];
		} else {
			const text = clean(token);
			expressions = text ? [`"${text}"*`] : [];
		}
		(excluded ? negative : positive).push(...expressions);
	}
	if (!positive.length) return undefined;
	return positive.join(" AND ") + negative.map(term => ` NOT ${term}`).join("");
}

export function openQmdBm25Index(databasePath: string) {
	const database = new Database(databasePath, { readonly: true, create: false });
	return {
		searchLex(query: string, options?: { limit?: number }): Array<{ body: string }> {
			const expression = lexicalQuery(query);
			if (!expression) return [];
			const limit = options?.limit ?? 20;
			if (!Number.isSafeInteger(limit) || limit < 0) throw new Error("Invalid BM25 result limit");
			return database
				.query(`WITH fts_matches AS (
     SELECT rowid, bm25(documents_fts, 1.5, 4.0, 1.0) AS bm25_score
     FROM documents_fts WHERE documents_fts MATCH ?
     ORDER BY bm25_score ASC LIMIT ?
    )
    SELECT content.doc AS body FROM fts_matches fm
    JOIN documents d ON d.id = fm.rowid
    JOIN content ON content.hash = d.hash WHERE d.active = 1
    ORDER BY fm.bm25_score ASC LIMIT ?`)
				.all(expression, limit, limit) as Array<{ body: string }>;
		},
		close() {
			database.close();
		},
	};
}
