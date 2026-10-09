import { createHash } from "node:crypto";
import type { createStore } from "@tobilu/qmd";

export function insertApiQmdDocuments(
	store: Awaited<ReturnType<typeof createStore>>,
	documents: readonly { categoryName: string; markdown: string }[],
): void {
	const time = "2000-01-01T00:00:00.000Z";
	for (const document of [...documents].sort((a, b) => a.categoryName.localeCompare(b.categoryName))) {
		const hash = createHash("sha256").update(document.markdown).digest("hex");
		const title = /^#\s+(.+)$/m.exec(document.markdown)?.[1] ?? document.categoryName;
		store.internal.insertContent(hash, document.markdown, time);
		store.internal.insertDocument("catalog", `${document.categoryName}.md`, title, hash, time, time);
	}
}
