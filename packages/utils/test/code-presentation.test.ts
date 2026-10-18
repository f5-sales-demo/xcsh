import { expect, test } from "bun:test";
import { parseAllDocuments } from "yaml";
import {
	isCodeBlockComplete,
	mapHttpCode,
	normalizeCodeLanguage,
	presentCode,
	wrapCodeLine,
} from "../src/code-presentation";

test("normalizes only explicit language metadata", () => {
	for (const [alias, canonical] of Object.entries({
		yml: "yaml",
		tf: "hcl",
		terraform: "hcl",
		sh: "bash",
		shell: "bash",
		py: "python",
	}))
		expect(normalizeCodeLanguage(alias.toUpperCase())).toBe(canonical);
	expect(presentCode('{"a":1}', "unknown").display).toBe('{"a":1}');
	expect(presentCode('{"a":1}').display).toBe('{"a":1}');
});

test("JSON formatting is lossless for order, duplicates, numbers and string escapes", () => {
	const source = '{"z":9007199254740993,"z":-0,"n":1.2300e+400,"s":"\\u0061\\/","a":[true,null]}';
	const view = presentCode(source, "json");
	expect(view.source).toBe(source);
	expect(view.display).toBe(
		'{\n  "z": 9007199254740993,\n  "z": -0,\n  "n": 1.2300e+400,\n  "s": "\\u0061\\/",\n  "a": [\n    true,\n    null\n  ]\n}',
	);
	for (const span of view.mapping)
		expect(view.display.slice(span.displayStart, span.displayEnd)).toBe(
			source.slice(span.sourceStart, span.sourceEnd),
		);
});

test("invalid and streaming JSON retain original layout until completion", () => {
	for (const source of ['{"a":', '{"a":1,}', '{"a":01}', '{"a":"\\x"}', "true false", "[1\u00a0,2]"])
		expect(presentCode(source, "json").display).toBe(source);
	expect(presentCode('{"a":1}', "json", false).display).toBe('{"a":1}');
	expect(isCodeBlockComplete('```json\n{"a":1}')).toBe(false);
	expect(isCodeBlockComplete('~~~~json\n{"a":1}\n~~~')).toBe(false);
	expect(isCodeBlockComplete('~~~~json\n{"a":1}\n~~~~')).toBe(true);
});

test("YAML expands compact manifests without changing types or scalar spellings", () => {
	const source = "metadata: {name: f5-demo, count: 2, enabled: true}\nspec: {ports: [443, 8443]}";
	const view = presentCode(source, "yml");
	expect(view.formatted).toBe(true);
	expect(view.display).toContain("metadata:\n  name: f5-demo\n  count: 2");
	expect(parseAllDocuments(view.display).map(d => d.toJS())).toEqual(parseAllDocuments(source).map(d => d.toJS()));
});

test("YAML preserves comments, anchors, aliases, tags, documents and scalar contents or falls back", () => {
	for (const source of [
		"# demo\nmetadata: &meta {name: f5-demo} # keep\ncopy: *meta",
		'---\nvalue: !!str 123\n...\n---\nvalue: "true"\n',
		'script: |\n  echo "hello"\n\n  echo "again"\n',
		"big: 9007199254740993\nsmall: 1.2300\n",
	]) {
		const view = presentCode(source, "yaml");
		expect(view.source).toBe(source);
		expect(parseAllDocuments(view.display, { intAsBigInt: true }).map(d => d.toJS())).toEqual(
			parseAllDocuments(source, { intAsBigInt: true }).map(d => d.toJS()),
		);
	}
	for (const source of ["name: [incomplete", "a: 1\na: 2", "value: !unsupported 1"])
		expect(presentCode(source, "yaml").display).toBe(source);
});

test("scripts and HCL are never reformatted", () => {
	const source = `	# comment

  value = "\${var.name}"
  script = <<EOF
hello
EOF
`;
	for (const language of ["hcl", "terraform", "bash", "python", "http", "unknown"])
		expect(presentCode(source, language).display).toBe(source);
});

test("code wrapping prefers boundaries outside literals and maps exact slices", () => {
	const source = 'name = "a long literal with spaces" + value';
	const parts = wrapCodeLine(source, 18);
	expect(parts[0].end).toBe(7);
	expect(parts.map(p => source.slice(p.start, p.end)).join("")).toBe(source);
	expect(parts.slice(1).every(p => p.continuation)).toBe(true);
	expect(
		wrapCodeLine("界🙂界🙂", 1)
			.map(p => "界🙂界🙂".slice(p.start, p.end))
			.join(""),
	).toBe("界🙂界🙂");
});

test("HTTP bodies require an explicit supported media type", () => {
	for (const [type, expected] of [
		["application/json", "json"],
		["application/vnd.api+json; charset=utf-8", "json"],
		["application/json+unknown", ""],
		["application/x-yaml", "yaml"],
		["text/yaml", "yaml"],
		["application/octet-stream", ""],
	]) {
		let language = "";
		mapHttpCode(
			`POST /api/example\nContent-Type: ${type}\n\n{}`,
			text => text,
			(text, lang) => {
				language = lang;
				return text;
			},
		);
		expect(language).toBe(expected);
	}
});
