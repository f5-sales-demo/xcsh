import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
	type ApiSpecDelivery,
	acknowledgePublishedDelivery,
	calculateDeliveryId,
	calculateDeliveryIdForTarget,
	DELIVERY_LEDGER_PATH,
	DELIVERY_PENDING_PATH,
	DELIVERY_PUBLICATION_LEDGER_PATH,
	deliveryApplied,
	deliveryBranch,
	GENERATED_DELIVERY_PATHS,
	parseDispatchEvent,
	releaseIdentityFromEnvironment,
	SPEC_RELEASE_PATH,
	validateArtifactVersion,
	verifyAcknowledgmentLedgers,
	verifyGeneratedDelivery,
	verifyReleasedTag,
	writePendingDelivery,
} from "../../../../scripts/api-spec-delivery";

const VERSION = "2.1.208";
const RELEASE_TAG = `v${VERSION}`;
const TARGET_COMMIT = "a".repeat(40);
const TRIGGER_SOURCE = "f5-sales-demo/api-specs-enriched";
const PROVIDER_COMMIT = "b".repeat(40);
const PROVIDER_TAG = "v9.8.7";

const XCSH_RELEASE_ASSETS = [
	"pi_natives.darwin-arm64.node",
	"pi_natives.darwin-x64-baseline.node",
	"pi_natives.darwin-x64-modern.node",
	"pi_natives.linux-arm64.node",
	"pi_natives.linux-x64-baseline.node",
	"pi_natives.linux-x64-modern.node",
	"pi_natives.win32-x64-baseline.node",
	"pi_natives.win32-x64-modern.node",
	"xcsh-darwin-arm64",
	"xcsh-darwin-arm64.zip",
	"xcsh-darwin-x64",
	"xcsh-darwin-x64.zip",
	"xcsh-linux-arm64",
	"xcsh-linux-arm64.tar.gz",
	"xcsh-linux-x64",
	"xcsh-linux-x64.tar.gz",
	"xcsh-windows-x64.exe",
] as const;

function specReleasePin(): Record<string, unknown> {
	return {
		assets: {
			"api-catalog.json": "1".repeat(64),
			[`f5xc-api-specs-${RELEASE_TAG}.zip`]: "2".repeat(64),
			"index.json": "3".repeat(64),
			"minimal-export-defaults.json": "4".repeat(64),
			"openapi.json": "5".repeat(64),
		},
		release_tag: RELEASE_TAG,
		target_commit: TARGET_COMMIT,
		version: VERSION,
	};
}

function publishedRelease(): Record<string, unknown> {
	const pin = specReleasePin() as { assets: Record<string, string> };
	const receipt = { assets: pin.assets, commit: TARGET_COMMIT, version: VERSION };
	return {
		assets: Object.entries(pin.assets).map(([name, digest]) => ({ digest: `sha256:${digest}`, name })),
		body: `notes\n<!-- publication-receipt:${JSON.stringify(receipt)} -->\n`,
		draft: false,
		immutable: true,
		prerelease: false,
		tag_name: RELEASE_TAG,
	};
}

function validDelivery(): ApiSpecDelivery {
	const identity = {
		releaseTag: RELEASE_TAG,
		targetCommit: TARGET_COMMIT,
		triggerSource: TRIGGER_SOURCE,
		version: VERSION,
	};
	return { ...identity, deliveryId: calculateDeliveryId(identity) };
}

async function preparePendingDelivery(repoRoot: string): Promise<Record<string, unknown>> {
	await Bun.write(path.join(repoRoot, DELIVERY_LEDGER_PATH), '{"deliveries":{},"version":1}\n');
	await Bun.write(path.join(repoRoot, DELIVERY_PUBLICATION_LEDGER_PATH), '{"receipts":{},"version":1}\n');
	for (const generatedPath of GENERATED_DELIVERY_PATHS) {
		await Bun.write(path.join(repoRoot, generatedPath), `generated ${generatedPath}\n`);
	}
	const pinPath = path.join(repoRoot, "source-pin.json");
	await Bun.write(pinPath, `${JSON.stringify(specReleasePin())}\n`);
	await writePendingDelivery(repoRoot, validDelivery(), pinPath, PROVIDER_TAG, PROVIDER_COMMIT);
	return Bun.file(path.join(repoRoot, DELIVERY_PENDING_PATH)).json();
}

function publicationEvidence(pending: Record<string, unknown>): Record<string, unknown> {
	const commit = "c".repeat(40);
	return {
		assets: Object.fromEntries(
			XCSH_RELEASE_ASSETS.map((name, index) => [name, (index + 1).toString(16).padStart(64, "0")]),
		),
		commit,
		generated: pending.generated,
		npm: {
			"@f5-sales-demo/pi-resource-management": { git_head: commit, integrity: "sha512-QUJD" },
			"@f5-sales-demo/xcsh": { git_head: commit, integrity: "sha512-REVG" },
		},
		provider: { commit: PROVIDER_COMMIT, tag: PROVIDER_TAG },
		spec_release_sha256: pending.spec_release_sha256,
		tag: "v3.2.1",
		version: "3.2.1",
	};
}

function dispatchEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	const delivery = validDelivery();
	return {
		action: "enriched-specs-updated",
		client_payload: {
			delivery_id: delivery.deliveryId,
			release_tag: delivery.releaseTag,
			target_commit: delivery.targetCommit,
			trigger_source: delivery.triggerSource,
			version: delivery.version,
			...overrides,
		},
	};
}

describe("API spec delivery identity", () => {
	it("accepts the canonical upstream payload and derives a delivery-specific branch", () => {
		const delivery = parseDispatchEvent(dispatchEvent());

		expect(delivery).toEqual(validDelivery());
		expect(deliveryBranch(delivery)).toBe(`chore/api-specs-${RELEASE_TAG}-${delivery.deliveryId.slice(0, 12)}`);
		expect(calculateDeliveryIdForTarget(delivery, "f5-sales-demo/terraform-provider-xcsh")).not.toBe(
			delivery.deliveryId,
		);
	});

	for (const field of ["delivery_id", "release_tag", "version"]) {
		it(`rejects a dispatch without ${field}`, () => {
			expect(() => parseDispatchEvent(dispatchEvent({ [field]: undefined }))).toThrow(field);
		});
	}

	it("rejects tag/version disagreement and a forged delivery ID", () => {
		expect(() => parseDispatchEvent(dispatchEvent({ release_tag: "v2.1.209" }))).toThrow("does not match version");
		expect(() => parseDispatchEvent(dispatchEvent({ delivery_id: "0".repeat(64) }))).toThrow(
			"does not match its payload identity",
		);
	});

	it("requires API_SPECS_TAG and API_SPECS_VERSION together", () => {
		expect(releaseIdentityFromEnvironment({})).toBeUndefined();
		expect(() => releaseIdentityFromEnvironment({ API_SPECS_TAG: RELEASE_TAG })).toThrow("must be provided together");
		expect(() => releaseIdentityFromEnvironment({ API_SPECS_VERSION: VERSION })).toThrow("must be provided together");
		expect(releaseIdentityFromEnvironment({ API_SPECS_TAG: RELEASE_TAG, API_SPECS_VERSION: VERSION })).toEqual({
			releaseTag: RELEASE_TAG,
			version: VERSION,
		});
	});

	it("rejects an artifact version that differs from the dispatch", () => {
		const identity = { releaseTag: RELEASE_TAG, version: VERSION };
		expect(() => validateArtifactVersion({ version: "2.1.207" }, identity, "index.json")).toThrow(
			"index.json version 2.1.207 does not match dispatched version 2.1.208",
		);
	});
});

describe("durable API spec delivery ledger", () => {
	it("keeps pending generation separate from atomic publication acknowledgment", async () => {
		const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-spec-pending-"));
		try {
			const delivery = validDelivery();
			const pending = await preparePendingDelivery(repoRoot);
			expect(deliveryApplied(await Bun.file(path.join(repoRoot, DELIVERY_LEDGER_PATH)).json(), delivery)).toBe(
				false,
			);
			expect(pending).toMatchObject({
				delivery_id: delivery.deliveryId,
				provider: { commit: PROVIDER_COMMIT, tag: PROVIDER_TAG },
				release_tag: RELEASE_TAG,
				target_commit: TARGET_COMMIT,
				trigger_source: TRIGGER_SOURCE,
				version: VERSION,
			});
			expect(Object.keys(pending.generated as Record<string, string>).sort()).toEqual(
				[...GENERATED_DELIVERY_PATHS].sort(),
			);
			expect(pending.spec_release_sha256).toMatch(/^[0-9a-f]{64}$/);

			const publicationPath = path.join(repoRoot, "publication.json");
			const publication = publicationEvidence(pending);
			publication.generated = Object.fromEntries(
				Object.entries(publication.generated as Record<string, string>).reverse(),
			);
			await Bun.write(publicationPath, `${JSON.stringify(publication)}\n`);
			await acknowledgePublishedDelivery(repoRoot, delivery, publicationPath);
			expect(deliveryApplied(await Bun.file(path.join(repoRoot, DELIVERY_LEDGER_PATH)).json(), delivery)).toBe(true);
			expect(await Bun.file(path.join(repoRoot, DELIVERY_PENDING_PATH)).exists()).toBe(false);
			expect(
				await verifyAcknowledgmentLedgers(
					path.join(repoRoot, DELIVERY_LEDGER_PATH),
					path.join(repoRoot, DELIVERY_PUBLICATION_LEDGER_PATH),
					delivery,
				),
			).toBe(true);

			const detailed = await Bun.file(path.join(repoRoot, DELIVERY_PUBLICATION_LEDGER_PATH)).json();
			detailed.receipts[delivery.deliveryId].delivery = {
				version: VERSION,
				target_commit: TARGET_COMMIT,
				release_tag: RELEASE_TAG,
			};
			await Bun.write(path.join(repoRoot, DELIVERY_PUBLICATION_LEDGER_PATH), `${JSON.stringify(detailed)}\n`);
			expect(
				await verifyAcknowledgmentLedgers(
					path.join(repoRoot, DELIVERY_LEDGER_PATH),
					path.join(repoRoot, DELIVERY_PUBLICATION_LEDGER_PATH),
					delivery,
				),
			).toBe(true);
		} finally {
			await fs.rm(repoRoot, { force: true, recursive: true });
		}
	});

	it("does not change either ledger when publication evidence is incomplete", async () => {
		const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-spec-publication-"));
		try {
			const pending = await preparePendingDelivery(repoRoot);
			const commonPath = path.join(repoRoot, DELIVERY_LEDGER_PATH);
			const detailedPath = path.join(repoRoot, DELIVERY_PUBLICATION_LEDGER_PATH);
			const pendingPath = path.join(repoRoot, DELIVERY_PENDING_PATH);
			const before = await Promise.all([
				Bun.file(commonPath).text(),
				Bun.file(detailedPath).text(),
				Bun.file(pendingPath).text(),
			]);
			const incomplete = publicationEvidence(pending);
			delete (incomplete.assets as Record<string, string>)[XCSH_RELEASE_ASSETS[0]];
			const publicationPath = path.join(repoRoot, "incomplete-publication.json");
			await Bun.write(publicationPath, `${JSON.stringify(incomplete)}\n`);

			await expect(acknowledgePublishedDelivery(repoRoot, validDelivery(), publicationPath)).rejects.toThrow(
				"wrong asset set",
			);
			expect(
				await Promise.all([
					Bun.file(commonPath).text(),
					Bun.file(detailedPath).text(),
					Bun.file(pendingPath).text(),
				]),
			).toEqual(before);
		} finally {
			await fs.rm(repoRoot, { force: true, recursive: true });
		}
	});

	it("rejects malformed provider identity and arbitrary regenerated bytes", async () => {
		const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-spec-attestation-"));
		try {
			await Bun.write(path.join(repoRoot, DELIVERY_LEDGER_PATH), '{"deliveries":{},"version":1}\n');
			for (const generatedPath of GENERATED_DELIVERY_PATHS) {
				await Bun.write(path.join(repoRoot, generatedPath), `generated ${generatedPath}\n`);
			}
			const pinPath = path.join(repoRoot, "source-pin.json");
			await Bun.write(pinPath, `${JSON.stringify(specReleasePin())}\n`);
			await expect(
				writePendingDelivery(repoRoot, validDelivery(), pinPath, "latest", PROVIDER_COMMIT),
			).rejects.toThrow("Provider tag must be");
			await expect(
				writePendingDelivery(repoRoot, validDelivery(), pinPath, PROVIDER_TAG, PROVIDER_COMMIT.toUpperCase()),
			).rejects.toThrow("Provider commit must be");
			expect(await Bun.file(path.join(repoRoot, SPEC_RELEASE_PATH)).exists()).toBe(false);

			await writePendingDelivery(repoRoot, validDelivery(), pinPath, PROVIDER_TAG, PROVIDER_COMMIT);
			await Bun.write(path.join(repoRoot, GENERATED_DELIVERY_PATHS[0]), "arbitrary resumed bytes\n");
			await expect(
				verifyGeneratedDelivery(repoRoot, validDelivery(), PROVIDER_TAG, PROVIDER_COMMIT),
			).rejects.toThrow("differ from pending attestation");
		} finally {
			await fs.rm(repoRoot, { force: true, recursive: true });
		}
	});

	it("rejects a mismatched entry, noncanonical key, and duplicate tag under another canonical delivery", () => {
		const delivery = validDelivery();
		const mismatched = {
			deliveries: {
				[delivery.deliveryId]: {
					release_tag: RELEASE_TAG,
					target_commit: "b".repeat(40),
					version: VERSION,
				},
			},
			version: 1,
		};
		expect(() => deliveryApplied(mismatched, delivery)).toThrow("noncanonical delivery_id");

		const forgedKey = {
			deliveries: {
				["0".repeat(64)]: {
					release_tag: RELEASE_TAG,
					target_commit: TARGET_COMMIT,
					version: VERSION,
				},
			},
			version: 1,
		};
		expect(() => deliveryApplied(forgedKey, delivery)).toThrow("noncanonical delivery_id");

		const otherIdentity = {
			releaseTag: RELEASE_TAG,
			targetCommit: "b".repeat(40),
			triggerSource: TRIGGER_SOURCE,
			version: VERSION,
		};
		const duplicateTag = {
			deliveries: {
				[calculateDeliveryId(otherIdentity)]: {
					release_tag: RELEASE_TAG,
					target_commit: otherIdentity.targetCommit,
					version: VERSION,
				},
			},
			version: 1,
		};
		expect(() => deliveryApplied(duplicateTag, delivery)).toThrow("already applied under delivery");
	});
});

describe("published release identity", () => {
	it("requires the exact release tag to resolve to the dispatched target commit", async () => {
		const requested: string[] = [];
		const fetcher = async (input: string | URL | Request): Promise<Response> => {
			const url = String(input);
			requested.push(url);
			if (url.includes("/releases/tags/")) return Response.json(publishedRelease());
			return Response.json({ object: { sha: TARGET_COMMIT, type: "commit" } });
		};

		expect(await verifyReleasedTag(validDelivery(), undefined, fetcher)).toEqual({
			assets: (specReleasePin() as { assets: Record<string, string> }).assets,
			commit: TARGET_COMMIT,
			version: VERSION,
		});
		expect(requested).toEqual([
			`https://api.github.com/repos/${TRIGGER_SOURCE}/releases/tags/${RELEASE_TAG}`,
			`https://api.github.com/repos/${TRIGGER_SOURCE}/git/ref/tags/${RELEASE_TAG}`,
		]);
	});

	it("rejects a release tag that resolves to another commit", async () => {
		const fetcher = async (input: string | URL | Request): Promise<Response> => {
			if (String(input).includes("/releases/tags/")) return Response.json(publishedRelease());
			return Response.json({ object: { sha: "b".repeat(40), type: "commit" } });
		};

		await expect(verifyReleasedTag(validDelivery(), undefined, fetcher)).rejects.toThrow(
			"does not match dispatched target_commit",
		);
	});

	it("rejects mutable releases and receipt/API byte disagreement", async () => {
		const mutable = { ...publishedRelease(), immutable: false };
		await expect(
			verifyReleasedTag(validDelivery(), undefined, async input =>
				Response.json(
					String(input).includes("/releases/tags/") ? mutable : { object: { sha: TARGET_COMMIT, type: "commit" } },
				),
			),
		).rejects.toThrow("not final and immutable");

		const mismatched = publishedRelease();
		(mismatched.assets as Array<Record<string, string>>)[0].digest = `sha256:${"f".repeat(64)}`;
		await expect(
			verifyReleasedTag(validDelivery(), undefined, async input =>
				Response.json(
					String(input).includes("/releases/tags/")
						? mismatched
						: { object: { sha: TARGET_COMMIT, type: "commit" } },
				),
			),
		).rejects.toThrow("API digest differs");
	});
});
