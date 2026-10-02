import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createGzip, gzipSync } from "node:zlib";
import tar from "tar-stream";
import {
	buildTerraformIndex,
	TerraformDocumentationRepository,
	type TerraformPin,
	terraformHash,
	verifyTerraformSnapshot,
} from "../../src/internal-urls/terraform-documentation";
import type { InternalUrl } from "../../src/internal-urls/types";

async function fixture(
	root: string,
	mutate?: (manifest: any, members: Map<string, Buffer>) => void,
): Promise<TerraformPin> {
	const body = '# Fixture\n\n<a id="schema-value"></a>\n### value\nComplete value.\n';
	const meta = {
		id: "fixture",
		canonical_id: "fixture",
		path: "documentation/resources/fixture/index.md",
		provider_type: "resources",
		provider_name: "fixture",
		role: "fundamentals",
		schema_path: [],
		summary: "Fixture",
		aliases: ["everyday fixture"],
		retrieval_version: 1,
		category: "security",
		capabilities: ["security.bot-defense"],
		tasks: ["configuration"],
		sections: [],
		relationships: [],
		parent_id: null,
		child_ids: [],
	};
	const members = new Map([[meta.path, Buffer.from(body)]]);
	const manifest = {
		schema_version: 2,
		source_root: "documentation",
		source_repository: "f5-sales-demo/terraform-provider-xcsh",
		provider_version: "v1.0.0",
		source_commit: "a".repeat(40),
		document_count: 1,
		provider_schema_digest: `sha256:${"b".repeat(64)}`,
		spec_pin_digest: `sha256:${"c".repeat(64)}`,
		documents: [
			{
				path: meta.path,
				size_bytes: Buffer.byteLength(body),
				sha256: terraformHash(body),
				body_sha256: terraformHash(body),
				metadata: meta,
			},
		],
	};
	mutate?.(manifest, members);
	const pack = tar.pack();
	const gzip = createGzip({ level: 9 });
	const chunks: Buffer[] = [];
	const done = new Promise<Buffer>((resolve, reject) => {
		pack.pipe(gzip);
		gzip.on("data", chunk => chunks.push(Buffer.from(chunk)));
		gzip.on("error", reject);
		gzip.on("end", () => resolve(Buffer.concat(chunks)));
	});
	for (const [name, bytes] of members) pack.entry({ name, mtime: new Date(0), mode: 0o644 }, bytes);
	pack.finalize();
	const assets: Record<string, Buffer> = {
		"terraform-docs.tar.gz": await done,
		"manifest.json": Buffer.from(JSON.stringify(manifest)),
	};
	const identity = {
		schema_version: 2 as const,
		source_repository: "f5-sales-demo/terraform-provider-xcsh" as const,
		provider_version: manifest.provider_version,
		source_root: "documentation" as const,
		release_tag: "documentation-v1.0.0",
		source_commit: manifest.source_commit,
		document_count: manifest.document_count,
		provider_schema_digest: manifest.provider_schema_digest,
		spec_pin_digest: manifest.spec_pin_digest,
	};
	const pins = () =>
		Object.fromEntries(
			Object.entries(assets).map(([name, bytes]) => [
				name,
				{ sha256: terraformHash(bytes), size_bytes: bytes.length },
			]),
		);
	assets["publication.json"] = Buffer.from(JSON.stringify({ ...identity, assets: pins() }));
	assets.SHA256SUMS = Buffer.from(
		Object.entries(assets)
			.sort()
			.map(([name, bytes]) => `${terraformHash(bytes)}  ${name}\n`)
			.join(""),
	);
	for (const [name, bytes] of Object.entries(assets)) await writeFile(path.join(root, name), bytes);
	return { ...identity, assets: pins(), receipt_sha256: terraformHash(assets["publication.json"]!) };
}

describe("Terraform snapshot ingestion", () => {
	test("plain Markdown is fully covered and produces deterministic QMD indexes", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "terraform-fixture-"));
		try {
			const pin = await fixture(root);
			const documents = await verifyTerraformSnapshot(root, pin);
			expect(documents).toHaveLength(1);
			const parent = structuredClone(documents[0]!);
			parent.path = "documentation/guides/parent/index.md";
			parent.metadata = {
				...parent.metadata,
				id: "parent",
				canonical_id: "parent",
				path: parent.path,
				child_ids: ["fixture"],
			};
			documents[0]!.metadata.parent_id = "parent";
			documents.push(parent);
			await buildTerraformIndex(documents, pin, path.join(root, "first.sqlite"));
			await buildTerraformIndex(documents, pin, path.join(root, "second.sqlite"));
			expect(terraformHash(await readFile(path.join(root, "first.sqlite")))).toBe(
				terraformHash(await readFile(path.join(root, "second.sqlite"))),
			);
			const bytes = await readFile(path.join(root, "first.sqlite"));
			const compressed = gzipSync(bytes);
			await writeFile(path.join(root, "index.gz"), compressed);
			const repository = new TerraformDocumentationRepository(
				{
					indexGzipPath: path.join(root, "index.gz"),
					pin: {
						...pin,
						index: {
							sha256: terraformHash(bytes),
							size_bytes: bytes.length,
							gzip_sha256: terraformHash(compressed),
							gzip_size_bytes: compressed.length,
						},
					},
				},
				path.join(root, "cache"),
			);
			const resolve = (uri: string) =>
				repository.resolve(
					Object.assign(new URL(uri), {
						rawHost: "terraform-documentation",
						rawPathname: uri.replace("xcsh://terraform-documentation", "").split(/[?#]/)[0],
					}) as InternalUrl,
				);
			expect(
				(
					await resolve(
						"xcsh://terraform-documentation/?search=fixture&provider_type=resources&provider_name=fixture&role=fundamentals",
					)
				).content,
			).toContain("documentation/resources/fixture/index.md");
			expect(
				(await resolve("xcsh://terraform-documentation/?search=fixture&provider_type=data-sources")).content,
			).toContain("No results.");
			expect(
				(await resolve("xcsh://terraform-documentation/documentation/resources/fixture/index.md#schema-value"))
					.content,
			).toContain("Complete value.");
			const result = (await resolve("xcsh://terraform-documentation/?search=fixture")).content;
			expect(result).toContain("Refine:");
			expect(result).toContain("xcsh://terraform-documentation/documentation/guides/parent/index.md");
			expect(
				(
					await resolve(
						"xcsh://terraform-documentation/?search=fixture&category=security&capability=security.bot-defense&task=configuration",
					)
				).content,
			).toContain("documentation/resources/fixture/index.md");
			expect((await resolve("xcsh://terraform-documentation/?search=fixture&category=dns")).content).toContain(
				"No results.",
			);
			expect((await resolve("xcsh://terraform-documentation/?facet=capability&limit=1")).content).toContain(
				"security.bot-defense",
			);
			expect((await resolve("xcsh://terraform-documentation/?node=parent&search=fixture")).content).toContain(
				"documentation/resources/fixture/index.md",
			);
			expect((await resolve("xcsh://terraform-documentation/?node=parent")).size).toBeLessThanOrEqual(4096);
			expect(
				(await resolve("xcsh://terraform-documentation/documentation/resources/fixture/index.md?view=hint")).size,
			).toBeLessThanOrEqual(4096);
			expect(
				(
					await resolve(
						"xcsh://terraform-documentation/documentation/resources/fixture/index.md?view=context#schema-value",
					)
				).content,
			).toContain("Complete value.");
			expect((await resolve("xcsh://terraform-documentation/?search=fixture&limit=10")).size).toBeLessThanOrEqual(
				4096,
			);
			expect(
				(
					await resolve(
						"xcsh://terraform-documentation/?search=I%20need%20Terraform%20guidance%20for%20fixture.%20Which%20documentation%20should%20I%20read%3F",
					)
				).content,
			).toContain("Narrowing choices");
			const broadened = (await resolve("xcsh://terraform-documentation/?search=fixture%20nonexistent")).content;
			expect(broadened).toContain("No results.");
			expect((await resolve("xcsh://terraform-documentation/?search=how%20do%20I")).content).toContain(
				"No results.",
			);
			const exact = (await resolve("xcsh://terraform-documentation/documentation/resources/fixture/index.md"))
				.content;
			expect(exact).toContain("Property sections:");
			expect(exact).toContain("#schema-value");
			for (const request of [
				"?search=",
				"?search=x&limit=11",
				"?search=x&limit=1&limit=2",
				"?role=fundamentals",
				"?unknown=x",
				"/docs/%2e%2e/outside.md",
				"/documentation/resources/fixture/index.md?search=x",
			])
				await expect(resolve(`xcsh://terraform-documentation/${request}`)).rejects.toThrow();
			(await repository.database()).close();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
	test("context returns whole fences, continuation sections and oversized notices", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "terraform-context-"));
		try {
			const pin = await fixture(root);
			const docs = await verifyTerraformSnapshot(root, pin);
			const body = `# Fixture\n\n<a id="schema-first"></a>\n### first\n\n\`\`\`terraform\n${"# preserved fixture line\n".repeat(350)}\`\`\`\n\n<a id="schema-second"></a>\n### second\n\n${"complete paragraph ".repeat(500)}\n\n<a id="schema-large"></a>\n### large\n\n${"oversized complete section ".repeat(1000)}\n`;
			docs[0]!.body = body;
			docs[0]!.markdown = body;
			docs[0]!.sha256 = terraformHash(body);
			docs[0]!.body_sha256 = terraformHash(body);
			await buildTerraformIndex(docs, pin, path.join(root, "index.sqlite"));
			const bytes = await readFile(path.join(root, "index.sqlite"));
			const compressed = gzipSync(bytes);
			await writeFile(path.join(root, "index.gz"), compressed);
			const repository = new TerraformDocumentationRepository(
				{
					indexGzipPath: path.join(root, "index.gz"),
					pin: {
						...pin,
						index: {
							sha256: terraformHash(bytes),
							size_bytes: bytes.length,
							gzip_sha256: terraformHash(compressed),
							gzip_size_bytes: compressed.length,
						},
					},
				},
				path.join(root, "cache"),
			);
			const read = (uri: string) =>
				repository.resolve(Object.assign(new URL(uri), { rawHost: "terraform-documentation" }) as InternalUrl);
			const base = "xcsh://terraform-documentation/documentation/resources/fixture/index.md";
			const first = await read(`${base}?view=context#schema-first`);
			expect(first.content).toContain("# preserved fixture line\n".repeat(350));
			expect(first.content.match(/```/g)).toHaveLength(2);
			const all = await read(`${base}?view=context`);
			expect(all.size).toBeLessThanOrEqual(16384);
			expect(all.content).toContain("Continue:");
			const continuation = /Continue: (\S+)/.exec(all.content)![1]!;
			const next = await read(continuation);
			expect(next.size).toBeLessThanOrEqual(16384);
			expect(next.content).toContain("complete paragraph ".repeat(500));
			const large = await read(`${base}?view=context#schema-large`);
			expect(large.content).toContain("Oversized section:");
			expect(large.content).toContain("view=full#schema-large");
			expect((await read(`${base}#schema-large`)).content).toContain("oversized complete section ".repeat(1000));
			(await repository.database()).close();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("rejects corrupt bytes, missing relationships and unexpected unsafe archive members", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "terraform-fixture-"));
		try {
			let pin = await fixture(root);
			await writeFile(path.join(root, "manifest.json"), "corrupt");
			await expect(verifyTerraformSnapshot(root, pin)).rejects.toThrow("asset verification failed");
			pin = await fixture(root, manifest => {
				manifest.documents[0].metadata.parent_id = "missing";
			});
			await expect(verifyTerraformSnapshot(root, pin)).rejects.toThrow("Missing Terraform relationship target");
			pin = await fixture(root, (_, members) => {
				members.set("../outside.md", Buffer.from("bad"));
			});
			await expect(verifyTerraformSnapshot(root, pin)).rejects.toThrow("Unsafe Terraform document path");
			pin = await fixture(root, manifest => {
				manifest.documents[0].metadata.role = null;
			});
			await expect(verifyTerraformSnapshot(root, pin)).rejects.toThrow("Invalid Terraform metadata");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
	test("continuation files share canonical identity without collapsing file coverage", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "terraform-fixture-"));
		try {
			const pin = await fixture(root, (manifest, members) => {
				const entry = structuredClone(manifest.documents[0]);
				entry.path = "documentation/guides/continuation/index.md";
				entry.metadata.path = entry.path;
				entry.metadata.projection_part = 2;
				manifest.documents.push(entry);
				manifest.document_count = 2;
				members.set(entry.path, members.values().next().value!);
			});
			expect(await verifyTerraformSnapshot(root, pin)).toHaveLength(2);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
