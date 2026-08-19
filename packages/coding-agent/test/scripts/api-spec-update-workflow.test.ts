import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { calculateDeliveryIdForTarget } from "../../../../scripts/api-spec-delivery";

interface WorkflowStep {
	env?: Record<string, string>;
	name?: string;
	run?: string;
}

interface WorkflowDocument {
	jobs: Record<string, { steps: WorkflowStep[] }>;
}

const repoRoot = path.resolve(import.meta.dir, "../../../..");
const workflowPath = path.join(repoRoot, ".github/workflows/api-spec-update.yml");
const generatorPath = path.join(repoRoot, "packages/coding-agent/scripts/generate-api-spec-index.ts");

async function workflowSteps(): Promise<WorkflowStep[]> {
	const document = parseYaml(await Bun.file(workflowPath).text()) as WorkflowDocument;
	return document.jobs["update-api-specs"].steps;
}

function namedStep(steps: WorkflowStep[], name: string): WorkflowStep {
	const step = steps.find(candidate => candidate.name === name);
	if (!step) throw new Error(`Workflow step not found: ${name}`);
	return step;
}

describe("API spec dispatch workflow contract", () => {
	it("validates identity and the durable ledger before installing or generating", async () => {
		const steps = await workflowSteps();
		const names = steps.map(step => step.name ?? "");
		const validateIndex = names.indexOf("Validate dispatch identity");
		const releaseIndex = names.indexOf("Verify exact published release");
		const ledgerIndex = names.indexOf("Check durable delivery ledger on main");
		const providerIndex = names.indexOf("Resolve exact published provider release");
		const installIndex = names.indexOf("Install dependencies");
		const generateIndex = names.indexOf("Generate exact API spec and catalog indexes");

		expect(validateIndex).toBeGreaterThan(-1);
		expect(releaseIndex).toBeGreaterThan(validateIndex);
		expect(ledgerIndex).toBeGreaterThan(releaseIndex);
		expect(providerIndex).toBeGreaterThan(ledgerIndex);
		expect(installIndex).toBeGreaterThan(providerIndex);
		expect(generateIndex).toBeGreaterThan(installIndex);
		expect(namedStep(steps, "Check durable delivery ledger on main").env?.DELIVERY_LEDGER_FILE).toContain(
			"steps.delivery.outputs.ledger_path",
		);
		expect(namedStep(steps, "Check durable delivery ledger on main").env?.DELIVERY_PUBLICATION_LEDGER_FILE).toContain(
			"steps.delivery.outputs.publication_ledger_path",
		);
	});

	it("passes the validated exact tag and version to every API-spec consumer", async () => {
		const steps = await workflowSteps();
		for (const name of [
			"Generate exact API spec and catalog indexes",
			"Generate Terraform index",
			"Generate exact minimum-settings defaults table",
		]) {
			const env = namedStep(steps, name).env;
			expect(env?.API_SPECS_TAG).toContain("steps.delivery.outputs.release_tag");
			expect(env?.API_SPECS_VERSION).toContain("steps.delivery.outputs.version");
		}
		expect(namedStep(steps, "Generate Terraform index").env?.TERRAFORM_PROVIDER_TAG).toContain(
			"steps.provider_release.outputs.provider_tag",
		);
		expect(namedStep(steps, "Generate Terraform index").env?.TERRAFORM_PROVIDER_COMMIT).toContain(
			"steps.provider_release.outputs.provider_commit",
		);
		expect(namedStep(steps, "Generate exact API spec and catalog indexes").env?.API_SPECS_BUNDLE_SHA256).toContain(
			"steps.source_release.outputs.bundle_sha256",
		);
		expect(
			namedStep(steps, "Generate exact minimum-settings defaults table").env?.API_SPECS_DEFAULTS_SHA256,
		).toContain("steps.source_release.outputs.defaults_sha256");
	});

	it("waits for the provider's exact post-publication ledger before generating documentation", async () => {
		const steps = await workflowSteps();
		const provider = namedStep(steps, "Resolve exact published provider release").run ?? "";
		expect(provider).toContain("f5-sales-demo/terraform-provider-xcsh");
		expect(provider).toContain("git/ref/heads/main");
		expect(provider).toContain("tools/spec-deliveries.json?ref=$PROVIDER_MAIN_SHA");
		expect(provider).toContain("tools/provider-publication-receipts.json?ref=$PROVIDER_MAIN_SHA");
		expect(provider).toContain("tools/spec-version.txt?ref=$PROVIDER_COMMIT");
		expect(provider).toContain("Provider common and detailed ledgers have different delivery keys");
		expect(provider).toContain("Provider delivery ledger contains a noncanonical key");
		expect(provider).toContain("Provider release consumed different spec bytes from this receiver");
		expect(provider).toContain("Provider release receipt differs from durable publication evidence");
		expect(provider).toContain("Provider release bytes differ from publication evidence");
		expect(provider).not.toContain("gh release list");
		expect(namedStep(steps, "Verify exact regenerated delivery bytes").run).toContain("verify-generated");
	});

	it("records pending identity only after verification and resumes an existing branch and PR", async () => {
		const steps = await workflowSteps();
		const names = steps.map(step => step.name ?? "");
		const generationIndex = names.indexOf("Generate exact minimum-settings defaults table");
		const recordIndex = names.indexOf("Record exact generated delivery attestation");
		const verifyIndex = names.indexOf("Verify exact regenerated delivery bytes");
		const commitIndex = names.indexOf("Commit and push generated delivery");
		expect(recordIndex).toBeGreaterThan(generationIndex);
		expect(verifyIndex).toBeGreaterThan(recordIndex);
		expect(commitIndex).toBeGreaterThan(verifyIndex);
		expect(namedStep(steps, "Record exact generated delivery attestation").run).toContain("record-pending");

		const branch = namedStep(steps, "Prepare deterministic delivery branch").run ?? "";
		expect(branch).toContain("git ls-remote --exit-code --heads");
		expect(branch).toContain("verify-pending");
		expect(branch).toContain("Existing delivery branch contains unexpected paths");

		const publish = namedStep(steps, "Create or resume generated-artifact pull request").run ?? "";
		expect(publish).toContain('gh pr list --head "$BRANCH" --state all');
		expect(publish).toContain('gh pr reopen "$PR_NUMBER"');
		expect(publish).toContain('gh pr merge "$PR_NUMBER" --squash --auto');
	});

	it("acknowledges on main only after the generated release is published and measured", async () => {
		const steps = await workflowSteps();
		const names = steps.map(step => step.name ?? "");
		const commitIndex = names.indexOf("Commit and push generated delivery");
		const mergeIndex = names.indexOf("Wait for generated artifacts to merge");
		const publicationIndex = names.indexOf("Verify post-merge release publication");
		const acknowledgmentIndex = names.indexOf("Prepare post-publication acknowledgment");
		const mainIndex = names.indexOf("Verify acknowledgment reached main");
		expect(mergeIndex).toBeGreaterThan(commitIndex);
		expect(publicationIndex).toBeGreaterThan(mergeIndex);
		expect(acknowledgmentIndex).toBeGreaterThan(publicationIndex);
		expect(mainIndex).toBeGreaterThan(acknowledgmentIndex);

		const generatedCommit = namedStep(steps, "Commit and push generated delivery").run ?? "";
		expect(generatedCommit).toContain("tools/spec-delivery-pending.json");
		expect(generatedCommit).not.toContain("tools/spec-deliveries.json");

		const publication = namedStep(steps, "Verify post-merge release publication").run ?? "";
		expect(publication).toContain("gh run list --workflow ci.yml --event push");
		expect(publication).toContain("@f5-sales-demo/xcsh@$VERSION");
		expect(publication).toContain("@f5-sales-demo/pi-resource-management@$VERSION");
		expect(publication).toContain(".gitHead == $commit");
		expect(publication).toContain(".immutable == true");
		expect(publication).toContain("MERGE_BLOB");
		expect(publication).toContain("xcsh-publication-receipt.json");
		expect(namedStep(steps, "Prepare post-publication acknowledgment").run).toContain(
			"api-spec-delivery.ts acknowledge",
		);
		expect(namedStep(steps, "Prepare post-publication acknowledgment").run).toContain("xcsh-publication-receipts");
		expect(namedStep(steps, "Verify acknowledgment reached main").run).toContain("verify-ledger");
	});

	it("never interpolates raw dispatch payload values into shell scripts", async () => {
		for (const step of await workflowSteps()) {
			expect(step.run ?? "").not.toContain("github.event.client_payload");
		}
	});
});

describe("provider publication evidence gate", () => {
	it("resolves only the provider tag bound to the exact delivery and measured release bytes", async () => {
		const fixture = await providerEvidenceFixture();
		try {
			const result = await runProviderEvidenceStep(fixture);
			expect(result.exitCode).toBe(0);
			expect(await Bun.file(fixture.output).text()).toContain(`provider_tag=${fixture.providerTag}`);
		} finally {
			await fs.rm(fixture.root, { force: true, recursive: true });
		}
	}, 60_000);

	it("rejects durable evidence that does not match GitHub's release digest", async () => {
		const fixture = await providerEvidenceFixture(true);
		try {
			const result = await runProviderEvidenceStep(fixture);
			expect(result.exitCode).not.toBe(0);
			expect(result.output).toContain("Provider release bytes differ from publication evidence");
		} finally {
			await fs.rm(fixture.root, { force: true, recursive: true });
		}
	}, 60_000);

	it("rejects unqualified provider publication digests", async () => {
		const fixture = await providerEvidenceFixture();
		try {
			const detailed = await Bun.file(fixture.env.FIXTURE_DETAILED).json();
			const deliveryId = Object.keys(detailed.receipts)[0];
			const assets = detailed.receipts[deliveryId].publication.assets as Record<string, string>;
			for (const [name, digest] of Object.entries(assets)) {
				assets[name] = digest.replace(/^sha256:/, "");
			}
			await Bun.write(fixture.env.FIXTURE_DETAILED, `${JSON.stringify(detailed)}\n`);
			const result = await runProviderEvidenceStep(fixture);
			expect(result.exitCode).not.toBe(0);
			expect(result.output).toContain("Provider publication ledger contains malformed evidence");
		} finally {
			await fs.rm(fixture.root, { force: true, recursive: true });
		}
	}, 60_000);

	it("rejects unqualified provider spec pin digests", async () => {
		const fixture = await providerEvidenceFixture(false, true);
		try {
			const result = await runProviderEvidenceStep(fixture);
			expect(result.exitCode).not.toBe(0);
			expect(result.output).toContain("Provider release carries a malformed or mismatched spec pin");
		} finally {
			await fs.rm(fixture.root, { force: true, recursive: true });
		}
	}, 60_000);

	it("rejects noncanonical and mismatched provider ledgers", async () => {
		const noncanonical = await providerEvidenceFixture();
		try {
			const ledger = await Bun.file(noncanonical.env.FIXTURE_LEDGER).json();
			const detailed = await Bun.file(noncanonical.env.FIXTURE_DETAILED).json();
			const canonicalId = Object.keys(ledger.deliveries)[0];
			const forgedId = "0".repeat(64);
			ledger.deliveries[forgedId] = ledger.deliveries[canonicalId];
			detailed.receipts[forgedId] = detailed.receipts[canonicalId];
			delete ledger.deliveries[canonicalId];
			delete detailed.receipts[canonicalId];
			await Bun.write(noncanonical.env.FIXTURE_LEDGER, `${JSON.stringify(ledger)}\n`);
			await Bun.write(noncanonical.env.FIXTURE_DETAILED, `${JSON.stringify(detailed)}\n`);
			const result = await runProviderEvidenceStep(noncanonical);
			expect(result.exitCode).not.toBe(0);
			expect(result.output).toContain("Provider delivery ledger contains a noncanonical key");
		} finally {
			await fs.rm(noncanonical.root, { force: true, recursive: true });
		}

		const mismatched = await providerEvidenceFixture();
		try {
			const detailed = await Bun.file(mismatched.env.FIXTURE_DETAILED).json();
			const deliveryId = Object.keys(detailed.receipts)[0];
			detailed.receipts[deliveryId].delivery.target_commit = "d".repeat(40);
			await Bun.write(mismatched.env.FIXTURE_DETAILED, `${JSON.stringify(detailed)}\n`);
			const result = await runProviderEvidenceStep(mismatched);
			expect(result.exitCode).not.toBe(0);
			expect(result.output).toContain("Provider publication ledger contains malformed evidence");
		} finally {
			await fs.rm(mismatched.root, { force: true, recursive: true });
		}
	}, 60_000);
});

describe("exact API spec generator contract", () => {
	it("bypasses local sources and requires exact-version bundle, catalog, and validation data", async () => {
		const source = await Bun.file(generatorPath).text();
		const exactSource = source.indexOf(
			"if (identity) {\n\t\treturn downloadFromRelease(identity.releaseTag, expectedBundleSha256);",
		);
		const localOverride = source.indexOf("const envDir = process.env.API_SPECS_DIR");
		expect(exactSource).toBeGreaterThan(-1);
		expect(localOverride).toBeGreaterThan(exactSource);
		expect(source).toContain(
			'downloadJsonReleaseAsset(identity.releaseTag, "api-catalog.json", true, expectedCatalogSha256)',
		);
		expect(source).toContain("differs from its immutable publication receipt");
		expect(source).toContain("Required validation.json is absent from the");
		expect(source).toContain("identity.releaseTag");
		expect(source).toContain('validateArtifactVersion(rawIndex, releaseIdentity, "index.json")');
		expect(source).toContain('validateArtifactVersion(catalog, releaseIdentity, "api-catalog.json")');
	});
});

interface ProviderEvidenceFixture {
	root: string;
	bin: string;
	output: string;
	providerTag: string;
	env: Record<string, string>;
}

async function providerEvidenceFixture(falseDigest = false, unqualifiedPin = false): Promise<ProviderEvidenceFixture> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-provider-evidence-"));
	const bin = path.join(root, "bin");
	await fs.mkdir(bin);
	const specVersion = "2.1.208";
	const specTag = `v${specVersion}`;
	const specCommit = "a".repeat(40);
	const providerVersion = "9.8.7";
	const providerTag = `v${providerVersion}`;
	const providerCommit = "b".repeat(40);
	const providerMainCommit = "c".repeat(40);
	const providerDeliveryId = calculateDeliveryIdForTarget(
		{
			releaseTag: specTag,
			targetCommit: specCommit,
			triggerSource: "f5-sales-demo/api-specs-enriched",
			version: specVersion,
		},
		"f5-sales-demo/terraform-provider-xcsh",
	);
	const pinDigest = (digit: string) => `${unqualifiedPin ? "" : "sha256:"}${digit.repeat(64)}`;
	const pin = `${JSON.stringify({
		assets: {
			"api-catalog.json": pinDigest("1"),
			[`f5xc-api-specs-${specTag}.zip`]: pinDigest("2"),
			"index.json": pinDigest("3"),
			"minimal-export-defaults.json": pinDigest("4"),
			"openapi.json": pinDigest("5"),
		},
		release_tag: specTag,
		target_commit: specCommit,
		version: specVersion,
	})}\n`;
	const pinSha = new Bun.CryptoHasher("sha256").update(pin).digest("hex");
	const assets = Object.fromEntries(
		providerAssetNames(providerVersion).map((name, index) => [
			name,
			`sha256:${(index + 1).toString(16).padStart(64, "0")}`,
		]),
	);
	const evidence = {
		assets,
		commit: providerCommit,
		spec_release_sha256: pinSha,
		tag: providerTag,
		version: providerVersion,
	};
	const ledger = {
		deliveries: {
			[providerDeliveryId]: { release_tag: specTag, target_commit: specCommit, version: specVersion },
		},
		version: 1,
	};
	const detailed = {
		receipts: {
			[providerDeliveryId]: {
				delivery: { release_tag: specTag, target_commit: specCommit, version: specVersion },
				publication: evidence,
			},
		},
		version: 1,
	};
	const release = {
		assets: providerAssetNames(providerVersion).map(name => ({
			digest: falseDigest && name.startsWith("mcp-data-") ? `sha256:${"0".repeat(64)}` : assets[name],
			name,
		})),
		body: `notes\n<!-- provider-publication-receipt:${JSON.stringify(evidence)} -->\n`,
		draft: false,
		immutable: true,
		prerelease: false,
		tag_name: providerTag,
	};
	await Bun.write(path.join(root, "ledger.json"), `${JSON.stringify(ledger)}\n`);
	await Bun.write(path.join(root, "detailed.json"), `${JSON.stringify(detailed)}\n`);
	await Bun.write(path.join(root, "release.json"), `${JSON.stringify(release)}\n`);
	await Bun.write(path.join(root, "pin.json"), pin);
	await Bun.write(
		path.join(bin, "gh"),
		`#!/usr/bin/env bash
set -euo pipefail
case "$*" in
  *git/ref/heads/main*) printf '%s\n' "$FIXTURE_MAIN_COMMIT" ;;
  *contents/tools/spec-deliveries.json*) cat "$FIXTURE_LEDGER" ;;
  *contents/tools/provider-publication-receipts.json*) cat "$FIXTURE_DETAILED" ;;
  *commits/v9.8.7*) printf '%s\n' "$FIXTURE_PROVIDER_COMMIT" ;;
  *releases/tags/v9.8.7*) cat "$FIXTURE_RELEASE" ;;
  *contents/tools/spec-release.json*) cat "$FIXTURE_PIN" ;;
  *contents/tools/spec-version.txt*) printf '%s\n' "$FIXTURE_SPEC_TAG" ;;
  *) printf 'unexpected gh invocation: %s\n' "$*" >&2; exit 9 ;;
esac
`,
	);
	await fs.chmod(path.join(bin, "gh"), 0o700);
	return {
		bin,
		output: path.join(root, "github-output"),
		providerTag,
		root,
		env: {
			EXPECTED_COMMIT: specCommit,
			EXPECTED_DELIVERY_ID: providerDeliveryId,
			EXPECTED_SPEC_TAG: specTag,
			EXPECTED_SPEC_VERSION: specVersion,
			FIXTURE_DETAILED: path.join(root, "detailed.json"),
			FIXTURE_LEDGER: path.join(root, "ledger.json"),
			FIXTURE_MAIN_COMMIT: providerMainCommit,
			FIXTURE_PIN: path.join(root, "pin.json"),
			FIXTURE_PROVIDER_COMMIT: providerCommit,
			FIXTURE_RELEASE: path.join(root, "release.json"),
			FIXTURE_SPEC_TAG: specTag,
			GH_TOKEN: "fixture",
			GITHUB_OUTPUT: path.join(root, "github-output"),
			RUNNER_TEMP: root,
			SOURCE_PIN_FILE: path.join(root, "pin.json"),
		},
	};
}

async function runProviderEvidenceStep(
	fixture: ProviderEvidenceFixture,
): Promise<{ exitCode: number; output: string }> {
	const provider = namedStep(await workflowSteps(), "Resolve exact published provider release").run ?? "";
	const child = Bun.spawn(["bash", "--noprofile", "--norc", "-eo", "pipefail", "-c", provider], {
		cwd: fixture.root,
		env: { ...process.env, ...fixture.env, PATH: `${fixture.bin}${path.delimiter}${process.env.PATH ?? ""}` },
		stderr: "pipe",
		stdout: "pipe",
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	return { exitCode, output: `${stdout}${stderr}` };
}

function providerAssetNames(version: string): string[] {
	return [
		`terraform-provider-xcsh_${version}_darwin_amd64.zip`,
		`terraform-provider-xcsh_${version}_darwin_arm64.zip`,
		`terraform-provider-xcsh_${version}_freebsd_386.zip`,
		`terraform-provider-xcsh_${version}_freebsd_amd64.zip`,
		`terraform-provider-xcsh_${version}_linux_386.zip`,
		`terraform-provider-xcsh_${version}_linux_amd64.zip`,
		`terraform-provider-xcsh_${version}_linux_arm.zip`,
		`terraform-provider-xcsh_${version}_linux_arm64.zip`,
		`terraform-provider-xcsh_${version}_manifest.json`,
		`terraform-provider-xcsh_${version}_SHA256SUMS`,
		`terraform-provider-xcsh_${version}_SHA256SUMS.sig`,
		`terraform-provider-xcsh_${version}_windows_386.zip`,
		`terraform-provider-xcsh_${version}_windows_amd64.zip`,
		`mcp-data-${version}.tar.gz`,
	];
}
