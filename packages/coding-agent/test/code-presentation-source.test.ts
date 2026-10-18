import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseAllDocuments } from "yaml";
import { normalizeCodeLanguage, presentCode } from "../../utils/src/code-presentation";
import { codeLanguageCatalog } from "../../utils/test/fixtures/code-language.catalog";

test("copied catalog examples pass independent offline syntax checks without execution", async () => {
	const directory = await mkdtemp(join(tmpdir(), "xcsh-code-source-"));
	try {
		for (const item of codeLanguageCatalog) {
			if (!item.valid) continue;
			const source = presentCode(item.source, item.language).source;
			const language = normalizeCodeLanguage(item.language);
			if (language === "json") expect(() => JSON.parse(source), item.id).not.toThrow();
			else if (language === "yaml")
				expect(
					parseAllDocuments(source).every(doc => !doc.errors.length),
					item.id,
				).toBe(true);
			else if (language === "bash")
				expect(Bun.spawnSync(["bash", "-n"], { stdin: Buffer.from(source) }).exitCode, item.id).toBe(0);
			else if (language === "python")
				expect(
					Bun.spawnSync(["python3", "-c", "import ast,sys; ast.parse(sys.stdin.read())"], {
						stdin: Buffer.from(source),
					}).exitCode,
					item.id,
				).toBe(0);
			else if (language === "hcl") {
				const path = join(directory, "example.tf");
				await Bun.write(path, source);
				// Formatting parses HCL without init, planning, providers, or evaluation.
				expect(Bun.spawnSync(["terraform", "fmt", "-write=false", path]).exitCode, item.id).toBe(0);
			} else if (language === "http") {
				const [headers, body] = source.split(/\r?\n\r?\n/);
				expect(/^(?:[A-Z]+ \/\S+(?: HTTP\/\d(?:\.\d)?)?|HTTP\/\d(?:\.\d)? \d{3} .*)/.test(headers), item.id).toBe(
					true,
				);
				for (const header of headers.split("\n").slice(1)) expect(/^[\w-]+:/.test(header), item.id).toBe(true);
				if (/Content-Type: application\/json/i.test(headers)) expect(() => JSON.parse(body), item.id).not.toThrow();
				if (/Content-Type: application\/yaml/i.test(headers))
					expect(
						parseAllDocuments(body).every(doc => !doc.errors.length),
						item.id,
					).toBe(true);
			}
		}
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
