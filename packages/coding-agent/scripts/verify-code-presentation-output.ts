/** Validate synthetic assistant output offline against an exact published request schema. */
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Ajv from "ajv";
import { Marked } from "marked";
import { parse } from "yaml";
import { normalizeCodeLanguage } from "../../utils/src/code-presentation";

const [outputPath, specPath] = process.argv.slice(2);
if (!outputPath || !specPath) throw new Error("Pass assistant Markdown and the exact published CSD specification");
const bytes = await Bun.file(specPath).bytes();
const spec = JSON.parse(new TextDecoder().decode(bytes));
const path = "/api/shape/csd/namespaces/{namespace}/testjs";
if (!spec.paths[path]?.post) throw new Error("Published specification lacks the requested operation");
const schema = spec.components.schemas.client_side_defenseTestJSRequest;
const validate = new Ajv({ strict: false }).compile(schema);
const results: { language: string; syntax: boolean; schema: boolean }[] = [];
const directory = await mkdtemp(join(tmpdir(), "xcsh-assistant-source-"));
try {
	for (const token of new Marked().lexer(await Bun.file(outputPath).text())) {
		if (token.type !== "code") continue;
		const language = normalizeCodeLanguage(token.lang);
		let body: Record<string, unknown> | undefined;
		if (language === "json") body = JSON.parse(token.text);
		else if (language === "yaml") body = parse(token.text);
		else if (language === "bash") {
			if (Bun.spawnSync(["bash", "-n"], { stdin: Buffer.from(token.text) }).exitCode)
				throw new Error("Invalid shell syntax");
			const payload = /--data(?:-raw)?\s+'([\s\S]*?)'/.exec(token.text)?.[1];
			if (!payload || !token.text.includes("/api/shape/csd/namespaces/demo/testjs"))
				throw new Error("Shell example omits a verifiable TestJS request");
			body = JSON.parse(payload);
		} else if (language === "python") {
			const python = Bun.spawnSync(
				[
					"python3",
					"-c",
					"import ast,json,sys; tree=ast.parse(sys.stdin.read()); payload=next(n.value for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='payload' for t in n.targets)); print(json.dumps(ast.literal_eval(payload)))",
				],
				{ stdin: Buffer.from(token.text) },
			);
			if (python.exitCode || !token.text.includes("/api/shape/csd/namespaces/demo/testjs"))
				throw new Error("Python example omits a verifiable TestJS request");
			body = JSON.parse(python.stdout.toString());
		} else if (language === "hcl") {
			const file = join(directory, "example.tf");
			await Bun.write(file, token.text);
			if (Bun.spawnSync(["terraform", "fmt", "-write=false", file]).exitCode) throw new Error("Invalid HCL syntax");
			body = Object.fromEntries(
				[...token.text.matchAll(/\b(domain|namespace|pageURL)\s*=\s*("(?:[^"\\]|\\.)*")/g)].map(match => [
					match[1],
					JSON.parse(match[2]),
				]),
			);
			if (!token.text.includes("jsonencode(")) throw new Error("HCL example omits JSON serialization");
		} else if (language === "http") {
			const [headers, payload] = token.text.split(/\r?\n\r?\n/);
			if (!headers.startsWith(`POST ${path}\n`) || !/Content-Type: application\/json/i.test(headers))
				throw new Error("HTTP example has an incorrect operation or media type");
			body = JSON.parse(payload);
		} else continue;
		if (!body || !validate(body)) throw new Error(`Schema validation failed: ${language}`);
		if (body.domain !== "example.com" || body.pageURL !== "https://checkout.example.com/")
			throw new Error(`Synthetic request semantics differ: ${language}`);
		if (
			typeof body.domain !== "string" ||
			!body.domain ||
			body.domain.length > 256 ||
			new URL(String(body.pageURL)).hostname !== `checkout.${body.domain}`
		)
			throw new Error(`Documented synthetic domain/URL relationship failed: ${language}`);
		results.push({ language, syntax: true, schema: true });
	}
	for (const language of ["json", "yaml", "hcl", "bash", "python", "http"])
		if (!results.some(result => result.language === language))
			throw new Error(`Missing language coverage: ${language}`);
	console.log(
		JSON.stringify(
			{
				specSha256: createHash("sha256").update(bytes).digest("hex"),
				results,
				coverageFailures: [
					"optional-property omission",
					"negative vendor-validation cases",
					"response bodies and errors",
					"live authorization and injection behavior",
				],
				executedExamples: false,
			},
			null,
			2,
		),
	);
} finally {
	await rm(directory, { recursive: true, force: true });
}
