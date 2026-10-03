import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createGzip, gzipSync } from "node:zlib";
import tar from "tar-stream";
import {
	buildTerraformIndex,
	TerraformDocumentationRepository,
	type TerraformMetadata,
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

async function fixtureRepository(
	root: string,
	pin: TerraformPin,
	indexPath: string,
): Promise<TerraformDocumentationRepository> {
	const bytes = await readFile(indexPath);
	const compressed = gzipSync(bytes);
	const indexGzipPath = path.join(root, "index.gz");
	await writeFile(indexGzipPath, compressed);
	return new TerraformDocumentationRepository(
		{
			indexGzipPath,
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
			await buildTerraformIndex(
				documents,
				Object.fromEntries(Object.entries(pin).reverse()) as TerraformPin,
				path.join(root, "second.sqlite"),
			);
			expect(terraformHash(await readFile(path.join(root, "first.sqlite")))).toBe(
				terraformHash(await readFile(path.join(root, "second.sqlite"))),
			);
			const prepared = new Database(path.join(root, "first.sqlite"), { readonly: true });
			expect(prepared.query("SELECT schema_version FROM property_index_provenance").get()).toEqual({
				schema_version: 2,
			});
			expect(prepared.query("SELECT COUNT(*) count FROM property_terms").get()).toEqual(
				prepared.query("SELECT COUNT(*) count FROM terraform_destinations").get(),
			);
			prepared.close();
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
			expect(
				(
					await resolve(
						"xcsh://terraform-documentation/?search=I%20need%20help%20with%20Terraform%20fixture.%20Should%20I%20use%20a%20resource%20or%20a%20data%20source%3F",
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
				"/documentation/resources/fixture/index.md?view=hint&after=schema-value",
				"/documentation/resources/fixture/index.md?view=hint&cursor=fixture",
				"/docs/%2e%2e/outside.md",
				"/documentation/resources/fixture/index.md?search=x",
			])
				await expect(resolve(`xcsh://terraform-documentation/${request}`)).rejects.toThrow();
			(await repository.database()).close();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
	test("discovery preserves distinct relevant property anchors sharing one file", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "terraform-fields-"));
		try {
			const pin = await fixture(root);
			const docs = await verifyTerraformSnapshot(root, pin);
			const body =
				'# Retry configuration\n\n<a id="schema-retry_count"></a>\n### retry_count\nRetry count for failed requests.\n\n<a id="schema-retry_interval"></a>\n### retry_interval\nRetry interval between failed requests.\n';
			docs[0]!.body = body;
			docs[0]!.markdown = body;
			docs[0]!.sha256 = terraformHash(body);
			docs[0]!.body_sha256 = terraformHash(body);
			docs[0]!.metadata.role = "reference";
			await buildTerraformIndex(docs, pin, path.join(root, "index.sqlite"));
			const repo = await fixtureRepository(root, pin, path.join(root, "index.sqlite"));
			const url = Object.assign(
				new URL("xcsh://terraform-documentation/?search=fixture%20retry&provider_type=resources&role=reference"),
				{ rawHost: "terraform-documentation" },
			) as InternalUrl;
			const response = (await repo.resolve(url)).content;
			expect(response).toContain("#schema-retry_count");
			expect(response).toContain("#schema-retry_interval");
			expect(response.match(/^Read: /gm)?.length).toBeGreaterThanOrEqual(2);
			expect(response).toContain("Narrowing choices");
			(await repo.database()).close();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
	test("sibling discovery preserves absent branch choices and applies category scope", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "terraform-sibling-"));
		try {
			const pin = await fixture(root);
			const original = (await verifyTerraformSnapshot(root, pin))[0]!;
			const docs = ["single_lb_app.enable_discovery.login.password", "enable_api_discovery.login.password"].map(
				(schema, index) => {
					const path = `documentation/resources/fixture/properties/${schema.split(".").join("/")}/index.md`;
					const body = '<a id="section"></a>\n# Password\nDiscovery password secret.\n';
					const id = `branch-${index}`;
					return {
						...original,
						path,
						body,
						markdown: body,
						sha256: terraformHash(body),
						body_sha256: terraformHash(body),
						size_bytes: body.length,
						metadata: {
							...original.metadata,
							id,
							canonical_id: id,
							path,
							provider_type: "resources",
							role: "properties",
							category: index === 0 ? "security" : "dns",
							schema_path: schema.split("."),
							aliases: index === 0 ? ["discovery password"] : ["password"],
							sections: [
								{
									schema_path: schema.split("."),
									document_id: id,
									anchor: "section",
									description: "Discovery password secret",
									aliases: [],
									relationships: [],
									flags: [],
								},
							],
						},
					};
				},
			);
			await buildTerraformIndex(docs, pin, path.join(root, "index.sqlite"));
			const repo = await fixtureRepository(root, pin, path.join(root, "index.sqlite"));
			const read = (suffix: string) =>
				repo.resolve(
					Object.assign(
						new URL(
							"xcsh://terraform-documentation/?search=configure%20discovery%20password&provider_name=fixture&provider_type=resources" +
								suffix,
						),
						{ rawHost: "terraform-documentation" },
					) as InternalUrl,
				);
			const all = (await read("")).content;
			expect(all).toContain("Narrowing choices");
			const limited = (await read("&limit=1")).content;
			expect(limited).toContain("Narrowing choices");
			expect(all).toContain("single_lb_app/enable_discovery/login/password");
			expect(all).toContain("properties/enable_api_discovery/login/password");
			const scoped = (await read("&category=security")).content;
			expect(scoped).toContain("Selected leaf;");
			expect(scoped).not.toContain("properties/enable_api_discovery/login/password");
			(await repo.database()).close();
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
			const repository = await fixtureRepository(root, pin, path.join(root, "index.sqlite"));
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

test("provider setup resolves exact maintained authentication sections and honors caller facets", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "terraform-setup-"));
	try {
		const pin = await fixture(root);
		const docs = await verifyTerraformSnapshot(root, pin);
		const original = docs[0]!;
		const body =
			"# Provider setup\n\n## Authentication Options\nChoose documented credentials.\n\n## Option 1: API Token Authentication\napi_token is the credential.\n\n## Option 2: P12 Certificate Authentication\np12_file is the credential.\n\n## Option 3: PEM Certificate Authentication\ncert and key are credentials.\n";
		const setupPath = "documentation/provider/setup/index.md";
		docs.push({
			...original,
			path: setupPath,
			body,
			sha256: terraformHash(body),
			metadata: {
				...original.metadata,
				id: "setup",
				canonical_id: "setup",
				path: setupPath,
				provider_type: "provider",
				provider_name: "setup",
				role: "overview",
				category: "administration",
				capabilities: ["administration"],
				tasks: ["authentication"],
				aliases: ["credential setup"],
				summary: "Provider authentication.",
			},
		});
		const file = path.join(root, "index.sqlite");
		await buildTerraformIndex(docs, pin, file);
		const repository = await fixtureRepository(root, pin, file);
		const resolve = (query: string, extra = "") =>
			repository.resolve(
				Object.assign(new URL(`xcsh://terraform-documentation/?search=${encodeURIComponent(query)}${extra}`), {
					rawHost: "terraform-documentation",
				}) as InternalUrl,
			);
		const token = (await resolve("API token authentication in the xcsh provider block")).content;
		expect(token).toContain("Selected leaf;");
		expect(token).toContain("#option-1-api-token-authentication");
		expect(Buffer.byteLength(token)).toBeLessThanOrEqual(4096);
		expect((await resolve("credential setup for provider using P12 certificate")).content).toContain(
			"#option-2-p12-certificate-authentication",
		);
		expect((await resolve("provider authentication using PEM certificate")).content).toContain(
			"#option-3-pem-certificate-authentication",
		);
		expect((await resolve("set up provider authentication")).content).toContain("#authentication-options");
		expect((await resolve("provider API token authentication impossible_credential_flag")).content).toContain(
			"No results.",
		);
		expect((await resolve("provider API token authentication", "&category=security")).content).toContain(
			"No results.",
		);
		expect((await resolve("provider API token authentication", "&provider_type=resources")).content).toContain(
			"No results.",
		);
		(await repository.database()).close();
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("selected property blocks refine to direct fields without changing explicit block reads", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "terraform-direct-property-"));
	try {
		const pin = await fixture(root);
		const docs = await verifyTerraformSnapshot(root, pin);
		const doc = docs[0]!;
		const body =
			'<a id="section"></a>\n# Public IP\nPublic IP origin server.\n\n<a id="schema-origin_servers--public_ip--ip"></a>\n### ip\nPublic IPv4 address.\n';
		doc.body = body;
		doc.markdown = body;
		doc.sha256 = terraformHash(body);
		doc.metadata.role = "properties";
		doc.metadata.schema_path = ["origin_servers", "public_ip"];
		doc.metadata.aliases = ["public ip"];
		doc.metadata.sections = [
			{
				schema_path: ["origin_servers", "public_ip", "ip"],
				document_id: doc.metadata.id,
				anchor: "schema-origin_servers--public_ip--ip",
				description: "Public IPv4 address.",
				aliases: [],
				relationships: [],
				flags: [],
			},
		];
		const index = path.join(root, "index.sqlite");
		await buildTerraformIndex(docs, pin, index);
		const repo = await fixtureRepository(root, pin, index);
		const read = (query: string) =>
			repo.resolve(
				Object.assign(
					new URL(
						`xcsh://terraform-documentation/?search=${encodeURIComponent(query)}&provider_name=fixture&provider_type=resources`,
					),
					{ rawHost: "terraform-documentation" },
				) as InternalUrl,
			);
		expect((await read("specify public IP address for origin server")).content).toContain(
			"#schema-origin_servers--public_ip--ip",
		);
		expect((await read("configure public IP origin server block")).content).toContain("#section");
		(await repo.database()).close();
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("verified parent choice groups return storage alternatives instead of a false selected leaf", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "terraform-storage-choice-"));
	try {
		const pin = await fixture(root);
		const original = (await verifyTerraformSnapshot(root, pin))[0]!;
		const docs = ["private_key", "private_key.clear_secret_info", "private_key.blindfold_secret_info"].map(
			(schema, index) => {
				const docPath = `documentation/resources/fixture/properties/${schema.replaceAll(".", "/")}/index.md`;
				const body = `<a id="section"></a>\n# ${schema}\nPrivate key storage.\n`;
				return {
					...original,
					path: docPath,
					body,
					markdown: body,
					sha256: terraformHash(body),
					metadata: {
						...original.metadata,
						id: `choice-${index}`,
						canonical_id: `choice-${index}`,
						path: docPath,
						role: "properties",
						schema_path: schema.split("."),
						aliases: index === 0 ? ["private key"] : [],
						relationships:
							index === 0
								? [1, 2].map(i => ({
										type: "conflicts" as const,
										target_id: `choice-${i}`,
										anchor: "section",
										enforcement: "provider-schema" as const,
										source: "fixture-validator",
										group: "private_key:storage-choice",
									}))
								: [],
					},
				};
			},
		);
		const index = path.join(root, "index.sqlite");
		await buildTerraformIndex(docs, pin, index);
		const repo = await fixtureRepository(root, pin, index);
		const content = (
			await repo.resolve(
				Object.assign(
					new URL(
						"xcsh://terraform-documentation/?search=configure%20private%20key%20storage&provider_name=fixture&provider_type=resources",
					),
					{ rawHost: "terraform-documentation" },
				) as InternalUrl,
			)
		).content;
		expect(content).toContain("Narrowing choices");
		expect(content).toContain("private_key/clear_secret_info/index.md");
		expect(content).toContain("private_key/blindfold_secret_info/index.md");
		expect(content).not.toContain("Selected leaf;");
		expect(content).not.toContain("Broader word matching was needed");
		const scoped = (
			await repo.resolve(
				Object.assign(
					new URL(
						"xcsh://terraform-documentation/?search=configure%20private%20key%20storage&provider_name=fixture&provider_type=resources&category=dns",
					),
					{ rawHost: "terraform-documentation" },
				) as InternalUrl,
			)
		).content;
		expect(scoped).toContain("No results.");
		const explicit = (
			await repo.resolve(
				Object.assign(
					new URL(
						"xcsh://terraform-documentation/?search=configure%20private_key.clear_secret_info&provider_name=fixture&provider_type=resources",
					),
					{ rawHost: "terraform-documentation" },
				) as InternalUrl,
			)
		).content;
		expect(explicit).not.toContain("private_key/blindfold_secret_info/index.md");
		(await repo.database()).close();
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("verified sibling type choices remain undecided without an exact type identifier", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "terraform-type-choice-"));
	try {
		const pin = await fixture(root);
		const original = (await verifyTerraformSnapshot(root, pin))[0]!;
		const modes = ["manual_tls", "automatic_tls"];
		const docs = modes.map((mode, index) => {
			const docPath = `documentation/resources/fixture/properties/${mode}/index.md`;
			const body = `<a id="section"></a>\n# TLS mode\nTLS encryption.\n`;
			return {
				...original,
				path: docPath,
				body,
				markdown: body,
				sha256: terraformHash(body),
				metadata: {
					...original.metadata,
					id: mode,
					canonical_id: mode,
					path: docPath,
					role: "properties",
					schema_path: [mode],
					aliases:
						index === 0
							? ["tls encryption", "existing certificates"]
							: ["tls encryption", "automatic certificate management"],
					relationships: [
						{
							type: "choice" as const,
							target_id: modes[1 - index]!,
							anchor: "section",
							enforcement: "provider-choice" as const,
							source: "receipt-pinned-immutable-oneof",
							group: "type",
						},
					],
				},
			};
		});
		const index = path.join(root, "index.sqlite");
		await buildTerraformIndex(docs, pin, index);
		const repo = await fixtureRepository(root, pin, index);
		const read = (query: string) =>
			repo.resolve(
				Object.assign(
					new URL(
						`xcsh://terraform-documentation/?search=${encodeURIComponent(query)}&provider_name=fixture&provider_type=resources`,
					),
					{ rawHost: "terraform-documentation" },
				) as InternalUrl,
			);
		const vague = (await read("configure TLS encryption")).content;
		expect(vague).toContain("Narrowing choices");
		expect(vague).toContain("manual_tls/index.md");
		expect(vague).toContain("automatic_tls/index.md");
		const explicit = (await read("configure automatic_tls")).content;
		expect(explicit).toContain("Selected leaf;");
		expect(explicit).toContain("automatic_tls/index.md");
		const prose = (await read("configure automatic certificate management")).content;
		expect(prose).toContain("Selected leaf;");
		expect(prose).toContain("automatic_tls/index.md");
		(await repo.database()).close();
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("provider type choices take precedence over unrelated child conflict groups", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "terraform-type-choice-"));
	try {
		const pin = await fixture(root);
		const original = (await verifyTerraformSnapshot(root, pin))[0]!;
		const modes = ["https", "https_auto_cert"];
		const docs = modes.map((mode, index) => {
			const docPath = `documentation/resources/fixture/properties/${mode}/index.md`;
			const body = `<a id="section"></a>\n# TLS mode\nTLS encryption.\n`;
			return {
				...original,
				path: docPath,
				body,
				markdown: body,
				sha256: terraformHash(body),
				metadata: {
					...original.metadata,
					id: mode,
					canonical_id: mode,
					path: docPath,
					role: "properties",
					schema_path: [mode],
					aliases: index === 0 ? ["https", "existing certificates"] : ["automatic certificate management"],
					relationships: [
						{
							type: "choice" as const,
							target_id: modes[1 - index]!,
							anchor: "section",
							enforcement: "provider-choice" as const,
							source: "receipt-pinned-immutable-oneof",
							group: "type",
						},
					],
				},
			};
		});
		for (const [i, child] of ["first_a", "first_b", "second_a", "second_b"].entries()) {
			const parent = docs[0]!;
			const childPath = `documentation/resources/fixture/properties/https/${child}/index.md`;
			docs.push({
				...parent,
				path: childPath,
				metadata: {
					...parent.metadata,
					id: child,
					canonical_id: child,
					path: childPath,
					schema_path: ["https", child],
					aliases: [],
					relationships: [],
				},
			});
			(parent.metadata.relationships as NonNullable<TerraformMetadata["relationships"]>).push({
				type: "conflicts",
				target_id: child,
				anchor: "section",
				enforcement: "provider-schema",
				source: "ast-validator",
				group: i < 2 ? "first" : "second",
			});
		}
		const index = path.join(root, "index.sqlite");
		await buildTerraformIndex(docs, pin, index);
		const repo = await fixtureRepository(root, pin, index);
		const read = (query: string) =>
			repo.resolve(
				Object.assign(
					new URL(
						`xcsh://terraform-documentation/?search=${encodeURIComponent(query)}&provider_name=fixture&provider_type=resources`,
					),
					{ rawHost: "terraform-documentation" },
				) as InternalUrl,
			);
		const vague = (await read("configure HTTPS")).content;
		expect(vague).toContain("Narrowing choices");
		expect(vague).toContain("https/index.md");
		expect(vague).toContain("https_auto_cert/index.md");
		const explicit = (await read("configure https_auto_cert")).content;
		expect(explicit).toContain("Selected leaf;");
		expect(explicit).toContain("https_auto_cert/index.md");
		const prose = (await read("configure automatic certificate management")).content;
		expect(prose).toContain("Selected leaf;");
		expect(prose).toContain("https_auto_cert/index.md");
		(await repo.database()).close();
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("unsupported exact fields fail closed within the selected provider scope", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "terraform-field-scope-"));
	try {
		const pin = await fixture(root);
		const docs = await verifyTerraformSnapshot(root, pin);
		const original = docs[0]!;
		const body =
			'# Other provider\n\n<a id="schema-foreign_flag"></a>\n### foreign_flag\nA setting for the other provider.\n';
		const docPath = "documentation/resources/other/properties/index.md";
		docs.push({
			...original,
			path: docPath,
			body,
			markdown: body,
			sha256: terraformHash(body),
			metadata: {
				...original.metadata,
				id: "other",
				canonical_id: "other",
				path: docPath,
				provider_name: "other",
				role: "properties",
				aliases: [],
			},
		});
		const index = path.join(root, "index.sqlite");
		await buildTerraformIndex(docs, pin, index);
		const repo = await fixtureRepository(root, pin, index);
		const uri =
			"xcsh://terraform-documentation/?search=configure%20foreign_flag%20on%20xcsh_fixture&provider_type=resources";
		const content = (
			await repo.resolve(Object.assign(new URL(uri), { rawHost: "terraform-documentation" }) as InternalUrl)
		).content;
		expect(content).toContain("No results.");
		expect(content).not.toContain("Selected leaf;");
		(await repo.database()).close();
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("property page title navigation is not indexed beside its canonical section", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "terraform-title-index-"));
	try {
		const pin = await fixture(root);
		const docs = await verifyTerraformSnapshot(root, pin);
		const doc = docs[0]!;
		const body =
			'# TLS\n\nBreadcrumbs:\n\n- navigation phrase\n\n<a id="section"></a>\n\nType: object.\nTLS configuration.\n\n<a id="schema-port"></a>\n### port\nListening port.\n';
		doc.body = body;
		doc.markdown = body;
		doc.sha256 = terraformHash(body);
		doc.metadata.role = "properties";
		const index = path.join(root, "index.sqlite");
		await buildTerraformIndex(docs, pin, index);
		const repo = await fixtureRepository(root, pin, index);
		const db = await repo.database();
		const passages = db
			.query("SELECT anchor FROM terraform_passages WHERE path=? ORDER BY ordinal")
			.all(doc.path) as { anchor: string }[];
		expect(passages.map(p => p.anchor)).toEqual(["section", "schema-port"]);
		const exact = (
			await repo.resolve(
				Object.assign(new URL(`xcsh://terraform-documentation/${doc.path}`), {
					rawHost: "terraform-documentation",
				}) as InternalUrl,
			)
		).content;
		expect(exact).toContain("navigation phrase");
		db.close();
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("property search excludes validator code while exact context preserves it", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "terraform-prose-index-"));
	try {
		const pin = await fixture(root);
		const docs = await verifyTerraformSnapshot(root, pin);
		const doc = docs[0]!;
		const body =
			'<a id="section"></a>\n# Limit\nConnection limit.\n\n<a id="schema-value"></a>\n### value\nMaximum connections.\n\n```go\nvalidatornoise.Between(1,65535)\n```\n';
		doc.body = body;
		doc.markdown = body;
		doc.sha256 = terraformHash(body);
		doc.metadata.role = "properties";
		const file = path.join(root, "index.sqlite");
		await buildTerraformIndex(docs, pin, file);
		const repo = await fixtureRepository(root, pin, file);
		const db = await repo.database();
		expect(
			db.query("SELECT count(*) count FROM documents_fts WHERE documents_fts MATCH ?").get("validatornoise"),
		).toEqual({ count: 0 });
		const full = (
			await repo.resolve(
				Object.assign(new URL(`xcsh://terraform-documentation/${doc.path}#schema-value`), {
					rawHost: "terraform-documentation",
				}) as InternalUrl,
			)
		).content;
		expect(full).toContain("validatornoise.Between");
		db.close();
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("exact scalar field identifiers retain all branches before context selection", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "terraform-scalar-destinations-"));
	try {
		const pin = await fixture(root);
		const original = (await verifyTerraformSnapshot(root, pin))[0]!;
		const branches = ["branch_a", "branch_b", "branch_c", "branch_d", "branch_e", "branch_f", "branch_z"];
		const docs = branches.map(branch => {
			const docPath = `documentation/resources/fixture/properties/${branch}/index.md`;
			const anchor = `schema-${branch}--shared_flag`;
			const body = `# ${branch}\n\n<a id="${anchor}"></a>\n### shared_flag\nA flag setting.\n`;
			return {
				...original,
				path: docPath,
				body,
				markdown: body,
				sha256: terraformHash(body),
				metadata: {
					...original.metadata,
					id: branch,
					canonical_id: branch,
					path: docPath,
					role: "properties",
					schema_path: [branch],
					aliases: [],
					sections: [
						{
							schema_path: [branch, "shared_flag"],
							document_id: branch,
							anchor,
							description: "A flag setting.",
							aliases: [],
							flags: [],
							relationships: [],
						},
					],
				},
			};
		});
		const file = path.join(root, "index.sqlite");
		await buildTerraformIndex(docs, pin, file);
		const repo = await fixtureRepository(root, pin, file);
		const read = (query: string) =>
			repo.resolve(
				Object.assign(
					new URL(
						`xcsh://terraform-documentation/?search=${encodeURIComponent(query)}&provider_name=fixture&provider_type=resources`,
					),
					{ rawHost: "terraform-documentation" },
				) as InternalUrl,
			);
		const precise = (await read("configure shared_flag under branch_z")).content;
		expect(precise).toContain("Selected leaf;");
		expect(precise).toContain("#schema-branch_z--shared_flag");
		const vague = (await read("configure shared_flag")).content;
		expect(vague).toContain("Narrowing choices");
		expect(vague).not.toContain("Selected leaf;");
		(await repo.database()).close();
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("schema identifier underscores are literal rather than SQL wildcards", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "terraform-literal-field-"));
	try {
		const pin = await fixture(root);
		const original = (await verifyTerraformSnapshot(root, pin))[0]!;
		const docs = [
			{ branch: "branch_a", field: "shared_flag", description: "A scalar flag." },
			{
				branch: "branch_z.more_context.deep_nested.another_level",
				field: "sharedxflag",
				description: "This differs from shared_flag.",
			},
		].map(record => {
			const docPath = `documentation/resources/fixture/properties/${record.branch}/index.md`;
			const anchor = `schema-${record.branch}--${record.field}`;
			const body = `# ${record.branch}\n\n<a id="${anchor}"></a>\n### ${record.field}\n${record.description}\n`;
			return {
				...original,
				path: docPath,
				body,
				markdown: body,
				sha256: terraformHash(body),
				metadata: {
					...original.metadata,
					id: record.branch,
					canonical_id: record.branch,
					path: docPath,
					role: "properties",
					schema_path: [record.branch],
					aliases: [],
					sections: [
						{
							schema_path: [...record.branch.split("."), record.field],
							document_id: record.branch,
							anchor,
							description: record.description,
							aliases: [],
							flags: [],
							relationships: [],
						},
					],
				},
			};
		});
		const file = path.join(root, "index.sqlite");
		await buildTerraformIndex(docs, pin, file);
		const repo = await fixtureRepository(root, pin, file);
		const content = (
			await repo.resolve(
				Object.assign(
					new URL(
						"xcsh://terraform-documentation/?search=shared_flag%20under%20branch_z%20more_context%20deep_nested%20another_level&provider_name=fixture&provider_type=resources",
					),
					{ rawHost: "terraform-documentation" },
				) as InternalUrl,
			)
		).content;
		expect(content).not.toContain("sharedxflag");
		(await repo.database()).close();
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("direct field refinement preserves literal schema branch prefixes", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "terraform-literal-prefix-"));
	try {
		const pin = await fixture(root);
		const original = (await verifyTerraformSnapshot(root, pin))[0]!;
		const docs = ["branch_a", "branchxa"].map((branch, index) => {
			const docPath = `documentation/resources/fixture/properties/${branch}/index.md`;
			const anchor = `schema-${branch}--port`;
			const body = `<a id="section"></a>\n# Backend servers\nServer configuration.\n${index ? `<a id="${anchor}"></a>\n### port\nListening port.\n` : ""}`;
			return {
				...original,
				path: docPath,
				body,
				markdown: body,
				sha256: terraformHash(body),
				metadata: {
					...original.metadata,
					id: branch,
					canonical_id: branch,
					path: docPath,
					role: "properties",
					schema_path: [branch],
					aliases: index ? [] : ["backend servers"],
					sections: index
						? [
								{
									schema_path: [branch, "port"],
									document_id: branch,
									anchor,
									description: "Listening port.",
									aliases: [],
									flags: [],
									relationships: [],
								},
							]
						: [],
				},
			};
		});
		const file = path.join(root, "index.sqlite");
		await buildTerraformIndex(docs, pin, file);
		const repo = await fixtureRepository(root, pin, file);
		const content = (
			await repo.resolve(
				Object.assign(
					new URL(
						"xcsh://terraform-documentation/?search=configure%20backend%20servers%20port&provider_name=fixture&provider_type=resources",
					),
					{ rawHost: "terraform-documentation" },
				) as InternalUrl,
			)
		).content;
		expect(content).not.toContain("#schema-branchxa--port");
		expect(content).toContain("branch_a/index.md?view=context#section");
		(await repo.database()).close();
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("expiration timestamp wording resolves the exact time field before token", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "terraform-expiration-wording-"));
	try {
		const pin = await fixture(root);
		const docs = await verifyTerraformSnapshot(root, pin);
		const doc = docs[0]!;
		const body =
			'<a id="schema-token"></a>\n### token\nAccess token.\n<a id="schema-expiration_time"></a>\n### expiration_time\nExpiration time of the token.\n';
		doc.body = body;
		doc.markdown = body;
		doc.sha256 = terraformHash(body);
		doc.metadata.role = "properties";
		doc.metadata.schema_path = [];
		doc.metadata.aliases = [];
		doc.metadata.sections = ["token", "expiration_time"].map(name => ({
			schema_path: [name],
			document_id: doc.metadata.id,
			anchor: `schema-${name}`,
			description: name === "token" ? "Access token." : "Expiration time of the token.",
			aliases: [],
			relationships: [],
			flags: [],
		}));
		const file = path.join(root, "index.sqlite");
		await buildTerraformIndex(docs, pin, file);
		const repo = await fixtureRepository(root, pin, file);
		const content = (
			await repo.resolve(
				Object.assign(
					new URL(
						"xcsh://terraform-documentation/?search=expiration%20timestamp%20of%20token&provider_name=fixture&provider_type=resources",
					),
					{ rawHost: "terraform-documentation" },
				) as InternalUrl,
			)
		).content;
		expect(content).toContain("#schema-expiration_time");
		(await repo.database()).close();
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("prepared production retrieval selects a paraphrased field and retains scoped exact reads", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "terraform-prepared-route-"));
	try {
		const pin = await fixture(root);
		const docs = await verifyTerraformSnapshot(root, pin);
		const body = `<a id="schema-listen_port"></a>
### listen_port
HTTPS listening port for inbound requests.

<a id="schema-idle_timeout"></a>
### idle_timeout
Idle connection timeout.
`;
		Object.assign(docs[0]!, { body, markdown: body, sha256: terraformHash(body), body_sha256: terraformHash(body) });
		Object.assign(docs[0]!.metadata, {
			role: "properties",
			category: "networking",
			capabilities: ["tls"],
			tasks: ["configuration"],
			sections: [
				{
					schema_path: ["listen_port"],
					document_id: "fixture",
					anchor: "schema-listen_port",
					description: "HTTPS listening port for inbound requests.",
					aliases: [],
					relationships: [],
					flags: ["optional"],
				},
				{
					schema_path: ["idle_timeout"],
					document_id: "fixture",
					anchor: "schema-idle_timeout",
					description: "Idle connection timeout.",
					aliases: [],
					relationships: [],
					flags: ["optional"],
				},
			],
		});
		const index = path.join(root, "index.sqlite");
		await buildTerraformIndex(docs, pin, index);
		const repo = await fixtureRepository(root, pin, index);
		const read = (suffix: string) =>
			repo.resolve(
				Object.assign(new URL(`xcsh://terraform-documentation/${suffix}`), {
					rawHost: "terraform-documentation",
				}) as InternalUrl,
			);
		const response = (
			await read(
				"?search=" +
					encodeURIComponent(
						"Which property on the fixture resource sets the HTTPS listening port for inbound requests?",
					) +
					"&category=networking&capability=tls&task=configuration",
			)
		).content;
		expect(response).toContain("Reason: Separated candidate");
		expect(response).toContain("Selected leaf;");
		const configured = (
			await read(
				"?search=" +
					encodeURIComponent("How do I configure the idle connection timeout for the fixture resource?") +
					"&category=networking",
			)
		).content;
		expect(configured).toContain("Reason: Separated candidate");
		expect(configured).toContain("Selected leaf;");
		expect(configured).toContain("#schema-idle_timeout");
		expect(response).toContain("#schema-listen_port");
		expect(Buffer.byteLength(response)).toBeLessThanOrEqual(4096);
		expect((await read("?search=fixture%20resource%20property%20listen_port&limit=1")).content).toContain(
			"Selected leaf;",
		);
		const excluded = (
			await read(
				"?search=" +
					encodeURIComponent("Which fixture resource property sets the HTTPS listening port?") +
					"&category=security",
			)
		).content;
		expect(excluded).toContain("No results.");
		const exact = (await read("documentation/resources/fixture/index.md#schema-listen_port")).content;
		expect(exact).toContain("HTTPS listening port for inbound requests.");
		(await repo.database()).close();
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("equivalent leaf discovery refines through indexed branches within response budgets", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "terraform-branch-refine-"));
	try {
		const pin = await fixture(root);
		const original = (await verifyTerraformSnapshot(root, pin))[0]!;
		const docs = [];
		for (const outer of ["and", "or", "none"]) {
			const parentId = `cookies_${outer}`;
			const parentPath = `documentation/resources/fixture/properties/cookies_${outer}/index.md`;
			const body = `<a id="section"></a>\n# cookies ${outer}\nCookie match choices.\n`;
			docs.push({
				...original,
				path: parentPath,
				body,
				markdown: body,
				sha256: terraformHash(body),
				metadata: {
					...original.metadata,
					id: parentId,
					canonical_id: parentId,
					path: parentPath,
					role: "properties",
					schema_path: [parentId],
					summary: `cookies ${outer}`,
					aliases: [],
					parent_id: null,
					sections: [],
				},
			});
			for (const inner of ["and", "or", "none"]) {
				const parts = [parentId, `cookie_${inner}`];
				const id = parts.join(".");
				const docPath = `documentation/resources/fixture/properties/${parts.join("/")}/index.md`;
				const anchor = `schema-${parts.join("--")}--case_sensitive`;
				const text = `<a id="section"></a>\n# Cookie match\n\n<a id="${anchor}"></a>\n### case_sensitive\nCookie case sensitivity.\n`;
				docs.push({
					...original,
					path: docPath,
					body: text,
					markdown: text,
					sha256: terraformHash(text),
					metadata: {
						...original.metadata,
						id,
						canonical_id: id,
						path: docPath,
						role: "properties",
						schema_path: parts,
						summary: "Cookie match",
						aliases: [],
						parent_id: parentId,
						sections: [
							{
								schema_path: [...parts, "case_sensitive"],
								document_id: id,
								anchor,
								description: "Cookie case sensitivity.",
								aliases: [],
								flags: ["optional"],
								relationships: [],
							},
						],
					},
				});
			}
		}
		const rootBody = '<a id="section"></a>\n# Cookie settings\nCookie match choices.\n';
		docs.push({
			...original,
			body: rootBody,
			markdown: rootBody,
			sha256: terraformHash(rootBody),
			metadata: {
				...original.metadata,
				id: "cookie-root",
				canonical_id: "cookie-root",
				role: "properties",
				schema_path: [],
				summary: "Cookie settings",
				aliases: [],
				parent_id: null,
				sections: ["and", "or", "none"].map(outer => ({
					schema_path: [`cookies_${outer}`],
					document_id: `cookies_${outer}`,
					anchor: "section",
					description: "Cookie match choices.",
					aliases: [],
					flags: ["optional"],
					relationships: [],
				})),
			},
		});
		const index = path.join(root, "index.sqlite");
		await buildTerraformIndex(docs, pin, index);
		const repo = await fixtureRepository(root, pin, index);
		const query = "which field sets cookie case sensitivity";
		const url = Object.assign(
			new URL(
				`xcsh://terraform-documentation/?search=${encodeURIComponent(query)}&provider_name=fixture&provider_type=resources`,
			),
			{ rawHost: "terraform-documentation" },
		) as InternalUrl;
		const response = (await repo.resolve(url)).content;
		expect(response).toContain("missing schema branch");
		expect(Buffer.byteLength(response)).toBeLessThanOrEqual(4096);
		const refinements = [...response.matchAll(/^Refine: (.+)$/gm)].map(match => match[1]!);
		expect(refinements).toHaveLength(3);
		for (const ref of refinements) {
			const next = new URL(ref);
			expect(next.searchParams.get("search")).toBe(query);
			expect(next.searchParams.get("provider_type")).toBe("resources");
			const content = (
				await repo.resolve(Object.assign(next, { rawHost: "terraform-documentation" }) as InternalUrl)
			).content;
			expect(Buffer.byteLength(content)).toBeLessThanOrEqual(4096);
			expect([...content.matchAll(/^Read: /gm)]).toHaveLength(3);
			expect(content).not.toContain("Selected leaf;");
		}
		(await repo.database()).close();
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
