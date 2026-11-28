import { expect, it } from "bun:test";

it("keeps lexical search usable and closes the probe when optional vector loading fails", async () => {
	const code = `
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
let probe;
let probeCloseCount = 0;
const loadExtension = Database.prototype.loadExtension;
const close = Database.prototype.close;
Database.prototype.loadExtension = function () {
  probe = this;
  throw new Error("qualified optional vector load failure");
};
Database.prototype.close = function (...args) {
  if (this === probe) probeCloseCount++;
  return close.apply(this, args);
};
const warnings = [];
const warn = console.warn;
console.warn = (...args) => warnings.push(args.join(" "));
const { createStore } = await import("@tobilu/qmd");
Database.prototype.loadExtension = loadExtension;
const directory = await mkdtemp(path.join(os.tmpdir(), "qmd-optional-vector-"));
const content = "Customer Edge immutable topology qualification evidence";
let store;
try {
  store = await createStore({ dbPath: path.join(directory, "corpus.sqlite") });
  await store.addCollection("qualification", { path: directory, pattern: "**/*.md" });
  const hash = "a".repeat(64);
  const timestamp = new Date().toISOString();
  store.internal.insertContent(hash, content, timestamp);
  store.internal.insertDocument("qualification", "probe.md", "Qualification", hash, timestamp, timestamp);
  const results = await store.searchLex("immutable topology");
  const body = results.length ? await store.getDocumentBody(results[0].filepath) : null;
  let vectorRefused = false;
  try { store.internal.ensureVecTable(384); }
  catch (error) { vectorRefused = /sqlite-vec/.test(String(error)); }
  await store.close();
  console.log(JSON.stringify({ probeAttempted: Boolean(probe), probeCloseCount,
    resultCount: results.length, body, expectedContent: content, vectorRefused,
    vectorWarnings: warnings.filter(message => /sqlite-vec/.test(message)) }));
} finally {
  await store?.close();
  Database.prototype.close = close;
  console.warn = warn;
  await rm(directory, { recursive: true, force: true });
}
`;
	const child = Bun.spawn([process.execPath, "-e", code], {
		cwd: import.meta.dir + "/..",
		stdout: "pipe",
		stderr: "pipe",
	});
	const [status, output, error] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	expect({ status, error }).toEqual({ status: 0, error: "" });
	const result = JSON.parse(output.trim());
	expect(result.probeAttempted).toBe(true);
	expect(result.resultCount).toBe(1);
	expect(result.body).toBe(result.expectedContent);
	expect(result.vectorRefused).toBe(true);
	expect(result.vectorWarnings).toEqual([]);
	expect(result.probeCloseCount).toBe(1);
}, 30_000);
