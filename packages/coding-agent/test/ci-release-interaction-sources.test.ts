import { expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
		for (const file of [
			"contract",
			"transport",
			"async-answer",
			"conversation-plan",
			"question-form",
			"answer-recap",
			"question-reply",
		]) {
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

test("published documentation modules import without the build-only QMD package", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-headless-documentation-"));
	try {
		for (const module of ["documentation-repository", "terraform-documentation"]) {
			const entry = new URL(`../src/internal-urls/${module}.ts`, import.meta.url).pathname;
			const built = await Bun.build({ entrypoints: [entry], target: "bun", external: ["@tobilu/qmd"] });
			expect(built.success).toBe(true);
			const artifact = join(root, `${module}.js`);
			await Bun.write(artifact, built.outputs[0]!);
			const imported = Bun.spawnSync(
				[process.execPath, "--no-install", "--eval", `await import(${JSON.stringify(artifact)})`],
				{ cwd: root },
			);
			expect(imported.exitCode, imported.stderr.toString()).toBe(0);
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
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

test("the packed interaction closure renders canonical replies without the private UI workspace", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-recap-package-"));
	try {
		const pkg = join(root, "coding-agent");
		const shared = join(root, "chat-ui/src/interactions");
		await mkdir(join(pkg, "src/session"), { recursive: true });
		await cp(new URL("../../chat-ui/src/interactions", import.meta.url).pathname, shared, { recursive: true });
		const consumer = join(pkg, "src/session/consumer.ts");
		const source =
			'export { asyncReplyRecap, recapText } from "../../../chat-ui/src/interactions/answer-recap";\nexport { createQuestionReply } from "../../../chat-ui/src/interactions/async-answer";\n';
		await writeFile(consumer, source);
		const restore = preparePublishedInteractionSources(pkg, shared);
		try {
			const manifest = await Bun.file(new URL("../package.json", import.meta.url)).json();
			await writeFile(
				join(pkg, "package.json"),
				JSON.stringify({ name: "synthetic-recap", version: "1.0.0", files: manifest.files }),
			);
			const packed = Bun.spawnSync(["npm", "pack", "--ignore-scripts", "--json"], { cwd: pkg });
			expect(packed.exitCode, packed.stderr.toString()).toBe(0);
			const unpacked = join(root, "unpacked");
			await mkdir(unpacked);
			const extracted = Bun.spawnSync([
				"tar",
				"xzf",
				join(pkg, JSON.parse(packed.stdout.toString())[0].filename),
				"-C",
				unpacked,
			]);
			expect(extracted.exitCode).toBe(0);
			await rm(join(root, "chat-ui"), { recursive: true });
			const entry = join(unpacked, "package/src/session/consumer.ts");
			const built = await Bun.build({ entrypoints: [entry], target: "bun" });
			expect(built.success, JSON.stringify(built.logs)).toBe(true);
			const api = await import(entry);
			const answer = "Developers — 東京\n  $(printf noop)";
			const recap = api.asyncReplyRecap(
				api.createQuestionReply("audience", "Audience", answer),
				undefined,
				"delivered",
			);
			expect(recap.state).toBe("delivered");
			expect(api.recapText(recap)).toContain(answer);
		} finally {
			restore();
		}
		expect(await readFile(consumer, "utf8")).toBe(source);
		expect(await Bun.file(join(pkg, "src/shared-interactions/answer-recap.ts")).exists()).toBe(false);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}, 30_000);
