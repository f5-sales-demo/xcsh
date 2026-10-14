import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { preparePublishedInteractionSources } from "../../../scripts/prepare-published-interactions";

test("published interaction imports survive absence of the private workspace and restore source", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-published-interactions-"));
	try {
		const pkg = join(root, "coding-agent");
		const shared = join(root, "chat-ui/src/interactions");
		await mkdir(join(pkg, "src/session"), { recursive: true });
		await mkdir(shared, { recursive: true });
		const source = 'export { validInputResponse } from "../../../chat-ui/src/interactions/contract";\n';
		await writeFile(join(pkg, "src/session/consumer.ts"), source);
		for (const file of ["contract", "transport", "async-answer", "conversation-plan", "question-form"]) {
			await writeFile(
				join(shared, `${file}.ts`),
				file === "contract" ? "export const validInputResponse = () => true;\n" : "export {};\n",
			);
		}
		const restore = preparePublishedInteractionSources(pkg, shared);
		await rm(join(root, "chat-ui"), { recursive: true });
		const published = await import(join(pkg, "src/session/consumer.ts"));
		expect(published.validInputResponse()).toBe(true);
		expect(await readFile(join(pkg, "src/session/consumer.ts"), "utf8")).not.toContain("chat-ui");
		restore();
		expect(await readFile(join(pkg, "src/session/consumer.ts"), "utf8")).toBe(source);
		expect(await Bun.file(join(pkg, "src/shared-interactions/contract.ts")).exists()).toBe(false);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("unexpected private UI imports fail before altering any source", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-private-ui-"));
	try {
		await mkdir(join(root, "src"));
		const source = 'export * from "../../chat-ui/src/interactions/QuestionCard";\n';
		await writeFile(join(root, "src/index.ts"), source);
		expect(() => preparePublishedInteractionSources(root, join(root, "missing"))).toThrow();
		expect(await readFile(join(root, "src/index.ts"), "utf8")).toBe(source);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("the QMD runtime import is declared as a production dependency", async () => {
	const pkg = await Bun.file(new URL("../package.json", import.meta.url)).json();
	expect(pkg.dependencies["@tobilu/qmd"]).toBeString();
});

test("the npm file envelope retains the ignored Terraform index", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-npm-envelope-"));
	try {
		const pkg = await Bun.file(new URL("../package.json", import.meta.url)).json();
		const asset = "src/internal-urls/.documentation-generated/terraform/terraform-documentation.sqlite.gz";
		await mkdir(join(root, "src/internal-urls/.documentation-generated/terraform"), { recursive: true });
		await writeFile(join(root, asset), "synthetic-index");
		await writeFile(join(root, ".gitignore"), ".documentation-generated/\n");
		await writeFile(
			join(root, "package.json"),
			JSON.stringify({ name: "synthetic-envelope", version: "1.0.0", files: pkg.files }),
		);
		const packed = Bun.spawnSync([process.execPath, "pm", "pack", "--ignore-scripts", "--filename", "fixture.tgz"], {
			cwd: root,
		});
		expect(packed.exitCode).toBe(0);
		const archive = Bun.spawnSync(["tar", "tzf", join(root, "fixture.tgz")]);
		expect(archive.exitCode).toBe(0);
		expect(new TextDecoder().decode(archive.stdout)).toContain(`package/${asset}`);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
