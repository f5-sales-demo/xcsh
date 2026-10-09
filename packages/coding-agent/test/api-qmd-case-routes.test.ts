import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createStore } from "@tobilu/qmd";
import { insertApiQmdDocuments } from "../scripts/api-qmd-documents";

test("API QMD indexes case-distinct category routes without filesystem collisions", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "xcsh-api-case-"));
	const store = await createStore({
		dbPath: path.join(root, "index.sqlite"),
		config: { collections: { catalog: { path: root, pattern: "*.md" } } },
	});
	try {
		insertApiQmdDocuments(store, [
			{ categoryName: "dataSets", markdown: "# Data Sets\n\nCamel route." },
			{ categoryName: "datasets", markdown: "# Datasets\n\nLowercase route." },
		]);
		const rows = store.internal.db
			.prepare("SELECT d.path,c.doc FROM documents d JOIN content c ON c.hash=d.hash ORDER BY d.path")
			.all();
		expect(rows).toEqual([
			{ path: "dataSets.md", doc: "# Data Sets\n\nCamel route." },
			{ path: "datasets.md", doc: "# Datasets\n\nLowercase route." },
		]);
	} finally {
		await store.close();
		await rm(root, { recursive: true, force: true });
	}
});
