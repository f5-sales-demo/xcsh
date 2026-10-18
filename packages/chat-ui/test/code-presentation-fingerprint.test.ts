import { expect, test } from "bun:test";
import { codePresentationFingerprint } from "../scripts/code-presentation-fingerprint";

const bytes = (text: string) => new TextEncoder().encode(text);
const sources = [bytes("presentation policy"), bytes("browser adapter")];
const manifest = (version: string, yaml = "2.9.0") =>
	bytes(
		JSON.stringify({
			name: "@f5-sales-demo/pi-utils",
			version,
			dependencies: { yaml, "highlight.js": "11.11.1" },
		}),
	);

test("release version changes preserve the code-presentation fingerprint", () => {
	expect(codePresentationFingerprint(sources, manifest("23.8.0"))).toBe(
		codePresentationFingerprint(sources, manifest("23.9.0")),
	);
});

test("source and dependency changes still invalidate the adapter", () => {
	const current = codePresentationFingerprint(sources, manifest("23.8.0"));
	expect(codePresentationFingerprint([bytes("changed policy"), sources[1]], manifest("23.8.0"))).not.toBe(current);
	expect(codePresentationFingerprint(sources, manifest("23.8.0", "2.10.0"))).not.toBe(current);
});
