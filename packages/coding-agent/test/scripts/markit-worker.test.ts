import { expect, test } from "bun:test";
import { ToolAbortError } from "../../src/tools/tool-errors";
import { convertInMarkitWorker } from "../../src/utils/markit-worker-client";

test("current native conversion executes in an isolated worker", async () => {
	const markdown = await convertInMarkitWorker({
		operation: "buffer",
		data: Buffer.from("<h1>Isolated conversion</h1><p>Synthetic native content.</p>").toString("base64"),
		extension: ".html",
	});
	expect(markdown).toContain("# Isolated conversion");
	expect(markdown).toContain("Synthetic native content.");
	expect(markdown).not.toContain("<h1>");
}, 20000);

test("cancelled native conversion never starts a worker", async () => {
	const controller = new AbortController();
	controller.abort();
	await expect(
		convertInMarkitWorker({ operation: "buffer", data: "", extension: ".html" }, controller.signal),
	).rejects.toBeInstanceOf(ToolAbortError);
});

test("native conversion failures propagate rather than returning successful empty output", async () => {
	await expect(
		convertInMarkitWorker({ operation: "file", path: "/nonexistent/synthetic-conversion-input.html" }),
	).rejects.toThrow();
}, 20000);
