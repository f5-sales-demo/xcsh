#!/usr/bin/env bun

import * as fs from "node:fs/promises";
import * as path from "node:path";

const SOURCE_REPOSITORY = "f5-sales-demo/api-specs-enriched";
const TARGET_REPOSITORY = "f5-sales-demo/xcsh";
const PROVIDER_REPOSITORY = "f5-sales-demo/terraform-provider-xcsh";
const EVENT_TYPE = "enriched-specs-updated";
const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;
const DELIVERY_ID_PATTERN = /^[0-9a-f]{64}$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const QUALIFIED_SHA256_PATTERN = /^sha256:([0-9a-f]{64})$/;
const LEDGER_VERSION = 1;

export const DELIVERY_LEDGER_PATH = "tools/spec-deliveries.json";
export const DELIVERY_PENDING_PATH = "tools/spec-delivery-pending.json";
export const DELIVERY_PUBLICATION_LEDGER_PATH = "tools/xcsh-publication-receipts.json";
export const SPEC_RELEASE_PATH = "tools/spec-release.json";

export const GENERATED_DELIVERY_PATHS = [
	"packages/coding-agent/src/internal-urls/api-catalog-index.generated.ts",
	"packages/coding-agent/src/internal-urls/api-spec-index.generated.ts",
	"packages/coding-agent/src/internal-urls/terraform-index.generated.ts",
	"packages/resource-management/src/defaults-metadata.generated.ts",
] as const;

const XCSH_PACKAGES = ["@f5-sales-demo/pi-resource-management", "@f5-sales-demo/xcsh"] as const;

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

export interface ApiSpecReleaseIdentity {
	version: string;
	releaseTag: string;
}

export interface ApiSpecDelivery extends ApiSpecReleaseIdentity {
	deliveryId: string;
	targetCommit: string;
	triggerSource: string;
}

export interface ApiSpecDeliveryLedgerEntry {
	release_tag: string;
	target_commit: string;
	version: string;
}

export interface ApiSpecDeliveryLedger {
	deliveries: Record<string, ApiSpecDeliveryLedgerEntry>;
	version: 1;
}

interface ApiSpecPendingDelivery {
	delivery_id: string;
	generated: Record<string, string>;
	provider: {
		commit: string;
		tag: string;
	};
	release_tag: string;
	spec_release_sha256: string;
	target_commit: string;
	trigger_source: string;
	version: string;
}

export interface ApiSpecReleasePin {
	assets: Record<string, string>;
	release_tag: string;
	target_commit: string;
	version: string;
}

export interface SourcePublicationReceipt {
	assets: Record<string, string>;
	commit: string;
	version: string;
}

interface XcshNpmEvidence {
	git_head: string;
	integrity: string;
}

export interface XcshPublicationEvidence {
	assets: Record<string, string>;
	commit: string;
	generated: Record<string, string>;
	npm: Record<string, XcshNpmEvidence>;
	provider: {
		commit: string;
		tag: string;
	};
	spec_release_sha256: string;
	tag: string;
	version: string;
}

interface XcshPublicationReceiptEntry {
	delivery: ApiSpecDeliveryLedgerEntry;
	publication: XcshPublicationEvidence;
}

interface XcshPublicationReceiptLedger {
	receipts: Record<string, XcshPublicationReceiptEntry>;
	version: 1;
}

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface FileError extends Error {
	code: string;
}

function isEnoent(error: unknown): error is FileError {
	return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function requiredString(value: unknown, field: string): string {
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`Dispatch payload field ${field} is required`);
	}
	return value;
}

export function validateReleaseIdentity(version: string, releaseTag: string): ApiSpecReleaseIdentity {
	if (!SEMVER_PATTERN.test(version)) {
		throw new Error(`Dispatch version is not semantic: ${version}`);
	}
	if (releaseTag !== `v${version}`) {
		throw new Error(`Dispatch release_tag ${releaseTag} does not match version ${version}`);
	}
	return { version, releaseTag };
}

export function releaseIdentityFromEnvironment(
	env: Record<string, string | undefined>,
): ApiSpecReleaseIdentity | undefined {
	const version = env.API_SPECS_VERSION;
	const releaseTag = env.API_SPECS_TAG;
	if (version === undefined && releaseTag === undefined) return undefined;
	if (version === undefined || releaseTag === undefined) {
		throw new Error("API_SPECS_VERSION and API_SPECS_TAG must be provided together");
	}
	return validateReleaseIdentity(version, releaseTag);
}

export function validateArtifactVersion(
	document: unknown,
	identity: ApiSpecReleaseIdentity,
	artifactName: string,
): void {
	if (!document || typeof document !== "object") {
		throw new Error(`${artifactName} must be a JSON object`);
	}
	const version = (document as Record<string, unknown>).version;
	if (version !== identity.version) {
		throw new Error(`${artifactName} version ${String(version)} does not match dispatched version ${identity.version}`);
	}
}

function expectedSpecAssetNames(releaseTag: string): string[] {
	return [
		"api-catalog.json",
		`f5xc-api-specs-${releaseTag}.zip`,
		"index.json",
		"minimal-export-defaults.json",
		"openapi.json",
	].sort();
}

function validateDigestMap(document: unknown, expectedNames: readonly string[], field: string): Record<string, string> {
	if (!document || typeof document !== "object" || Array.isArray(document)) {
		throw new Error(`${field} must be an object`);
	}
	const digests = document as Record<string, unknown>;
	if (JSON.stringify(sortedKeys(digests)) !== JSON.stringify([...expectedNames].sort())) {
		throw new Error(`${field} has the wrong asset set`);
	}
	const validated: Record<string, string> = {};
	for (const [name, value] of Object.entries(digests)) {
		if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
			throw new Error(`${field}.${name} must be a lowercase SHA-256 digest`);
		}
		validated[name] = value;
	}
	return validated;
}

function validateQualifiedDigestMap(
	document: unknown,
	expectedNames: readonly string[],
	field: string,
): Record<string, string> {
	if (!document || typeof document !== "object" || Array.isArray(document)) {
		throw new Error(`${field} must be an object`);
	}
	const digests = document as Record<string, unknown>;
	if (JSON.stringify(sortedKeys(digests)) !== JSON.stringify([...expectedNames].sort())) {
		throw new Error(`${field} has the wrong asset set`);
	}
	const validated: Record<string, string> = {};
	for (const [name, value] of Object.entries(digests)) {
		const match = typeof value === "string" ? QUALIFIED_SHA256_PATTERN.exec(value) : null;
		if (!match) {
			throw new Error(`${field}.${name} must be a sha256-qualified lowercase SHA-256 digest`);
		}
		validated[name] = match[1];
	}
	return validated;
}

export function parseSpecReleasePin(document: unknown, delivery?: ApiSpecDelivery): ApiSpecReleasePin {
	if (!document || typeof document !== "object" || Array.isArray(document)) {
		throw new Error("Spec release pin must be an object");
	}
	const pin = document as Record<string, unknown>;
	if (JSON.stringify(sortedKeys(pin)) !== JSON.stringify(["assets", "release_tag", "target_commit", "version"])) {
		throw new Error("Spec release pin has an invalid shape");
	}
	const version = requiredString(pin.version, "spec-release.version");
	const releaseTag = requiredString(pin.release_tag, "spec-release.release_tag");
	validateReleaseIdentity(version, releaseTag);
	const targetCommit = requiredString(pin.target_commit, "spec-release.target_commit");
	if (!COMMIT_PATTERN.test(targetCommit)) throw new Error("Spec release pin has an invalid target_commit");
	if (delivery &&
		(version !== delivery.version || releaseTag !== delivery.releaseTag || targetCommit !== delivery.targetCommit)) {
		throw new Error("Spec release pin disagrees with the dispatched identity");
	}
	return {
		assets: validateDigestMap(pin.assets, expectedSpecAssetNames(releaseTag), "spec-release.assets"),
		release_tag: releaseTag,
		target_commit: targetCommit,
		version,
	};
}

function sha256Bytes(bytes: Uint8Array | string): string {
	return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

async function sha256File(file: string): Promise<string> {
	return sha256Bytes(await fs.readFile(file));
}

export function calculateDeliveryId(delivery: Omit<ApiSpecDelivery, "deliveryId">): string {
	return calculateDeliveryIdForTarget(delivery, TARGET_REPOSITORY);
}

export function calculateDeliveryIdForTarget(
	delivery: Omit<ApiSpecDelivery, "deliveryId">,
	targetRepository: string,
): string {
	const canonical = JSON.stringify({
		commit: delivery.targetCommit,
		event_type: EVENT_TYPE,
		source: delivery.triggerSource,
		tag: delivery.releaseTag,
		target: targetRepository,
		version: delivery.version,
	});
	return new Bun.CryptoHasher("sha256").update(canonical).digest("hex");
}

export function parseDispatchEvent(document: unknown): ApiSpecDelivery {
	if (!document || typeof document !== "object") throw new Error("Dispatch event must be an object");
	const event = document as Record<string, unknown>;
	if (event.action !== EVENT_TYPE) {
		throw new Error(`Unexpected repository_dispatch action: ${String(event.action)}`);
	}
	const rawPayload = event.client_payload;
	if (!rawPayload || typeof rawPayload !== "object") {
		throw new Error("Dispatch event has no client_payload object");
	}
	const payload = rawPayload as Record<string, unknown>;
	const version = requiredString(payload.version, "version");
	const releaseTag = requiredString(payload.release_tag, "release_tag");
	validateReleaseIdentity(version, releaseTag);
	const triggerSource = requiredString(payload.trigger_source, "trigger_source");
	if (triggerSource !== SOURCE_REPOSITORY) {
		throw new Error(`Unexpected dispatch source: ${triggerSource}`);
	}
	const targetCommit = requiredString(payload.target_commit, "target_commit");
	if (!COMMIT_PATTERN.test(targetCommit)) {
		throw new Error("Dispatch target_commit must be a full lowercase Git SHA");
	}
	const deliveryId = requiredString(payload.delivery_id, "delivery_id");
	if (!DELIVERY_ID_PATTERN.test(deliveryId)) {
		throw new Error("Dispatch delivery_id must be a lowercase SHA-256 digest");
	}
	const delivery = { deliveryId, releaseTag, targetCommit, triggerSource, version };
	const expectedId = calculateDeliveryId(delivery);
	if (deliveryId !== expectedId) {
		throw new Error(`Dispatch delivery_id does not match its payload identity`);
	}
	return delivery;
}

export function deliveryBranch(delivery: ApiSpecDelivery): string {
	return `chore/api-specs-${delivery.releaseTag}-${delivery.deliveryId.slice(0, 12)}`;
}

function ledgerEntryFor(delivery: ApiSpecDelivery): ApiSpecDeliveryLedgerEntry {
	return {
		release_tag: delivery.releaseTag,
		target_commit: delivery.targetCommit,
		version: delivery.version,
	};
}

async function pendingDeliveryFor(
	repoRoot: string,
	delivery: ApiSpecDelivery,
	pin: ApiSpecReleasePin,
	providerTag: string,
	providerCommit: string,
): Promise<ApiSpecPendingDelivery> {
	if (!/^v\d+\.\d+\.\d+$/.test(providerTag)) throw new Error("Provider tag must be vMAJOR.MINOR.PATCH");
	if (!COMMIT_PATTERN.test(providerCommit)) throw new Error("Provider commit must be a full lowercase Git SHA");
	const generatedEntries = await Promise.all(
		GENERATED_DELIVERY_PATHS.map(async file => [file, await sha256File(path.join(repoRoot, file))] as const),
	);
	return {
		delivery_id: delivery.deliveryId,
		generated: Object.fromEntries(generatedEntries),
		provider: { commit: providerCommit, tag: providerTag },
		release_tag: delivery.releaseTag,
		spec_release_sha256: sha256Bytes(`${JSON.stringify(pin, null, "\t")}\n`),
		target_commit: delivery.targetCommit,
		trigger_source: delivery.triggerSource,
		version: delivery.version,
	};
}

export function verifyPendingDelivery(document: unknown, delivery: ApiSpecDelivery): ApiSpecPendingDelivery {
	if (!document || typeof document !== "object" || Array.isArray(document)) {
		throw new Error("Pending delivery marker must be an object");
	}
	const pending = document as Record<string, unknown>;
	if (
		JSON.stringify(sortedKeys(pending)) !==
		JSON.stringify([
			"delivery_id",
			"generated",
			"provider",
			"release_tag",
			"spec_release_sha256",
			"target_commit",
			"trigger_source",
			"version",
		])
	) {
		throw new Error("Pending delivery marker has an invalid shape");
	}
	const expected = {
		delivery_id: delivery.deliveryId,
		release_tag: delivery.releaseTag,
		target_commit: delivery.targetCommit,
		trigger_source: delivery.triggerSource,
		version: delivery.version,
	};
	for (const [key, value] of Object.entries(expected)) {
		if (pending[key] !== value) {
			throw new Error(`Pending delivery marker disagrees with ${delivery.deliveryId}`);
		}
	}
	const generated = validateDigestMap(pending.generated, GENERATED_DELIVERY_PATHS, "pending.generated");
	if (!pending.provider || typeof pending.provider !== "object" || Array.isArray(pending.provider)) {
		throw new Error("Pending provider identity must be an object");
	}
	const provider = pending.provider as Record<string, unknown>;
	if (JSON.stringify(sortedKeys(provider)) !== JSON.stringify(["commit", "tag"])) {
		throw new Error("Pending provider identity has an invalid shape");
	}
	const providerCommit = requiredString(provider.commit, "pending.provider.commit");
	const providerTag = requiredString(provider.tag, "pending.provider.tag");
	if (!COMMIT_PATTERN.test(providerCommit) || !/^v\d+\.\d+\.\d+$/.test(providerTag)) {
		throw new Error("Pending provider identity is malformed");
	}
	const specReleaseSha256 = requiredString(pending.spec_release_sha256, "pending.spec_release_sha256");
	if (!SHA256_PATTERN.test(specReleaseSha256)) throw new Error("Pending spec release digest is malformed");
	return {
		...expected,
		generated,
		provider: { commit: providerCommit, tag: providerTag },
		spec_release_sha256: specReleaseSha256,
	};
}

function sortedKeys(document: Record<string, unknown>): string[] {
	return Object.keys(document).sort();
}

function digestMapsEqual(left: Record<string, string>, right: Record<string, string>): boolean {
	const keys = Object.keys(left);
	return keys.length === Object.keys(right).length && keys.every(key => left[key] === right[key]);
}

function ledgerEntriesEqual(left: ApiSpecDeliveryLedgerEntry, right: ApiSpecDeliveryLedgerEntry): boolean {
	return (
		left.release_tag === right.release_tag &&
		left.target_commit === right.target_commit &&
		left.version === right.version
	);
}

function validateLedgerEntry(deliveryId: string, document: unknown): ApiSpecDeliveryLedgerEntry {
	if (!DELIVERY_ID_PATTERN.test(deliveryId)) {
		throw new Error(`Delivery ledger contains an invalid delivery_id: ${deliveryId}`);
	}
	if (!document || typeof document !== "object" || Array.isArray(document)) {
		throw new Error(`Delivery ledger entry ${deliveryId} must be an object`);
	}
	const entry = document as Record<string, unknown>;
	if (JSON.stringify(sortedKeys(entry)) !== JSON.stringify(["release_tag", "target_commit", "version"])) {
		throw new Error(`Delivery ledger entry ${deliveryId} has an invalid shape`);
	}
	const version = requiredString(entry.version, `deliveries.${deliveryId}.version`);
	const releaseTag = requiredString(entry.release_tag, `deliveries.${deliveryId}.release_tag`);
	validateReleaseIdentity(version, releaseTag);
	const targetCommit = requiredString(entry.target_commit, `deliveries.${deliveryId}.target_commit`);
	if (!COMMIT_PATTERN.test(targetCommit)) {
		throw new Error(`Delivery ledger entry ${deliveryId} has an invalid target_commit`);
	}
	const expectedId = calculateDeliveryIdForTarget(
		{ releaseTag, targetCommit, triggerSource: SOURCE_REPOSITORY, version },
		TARGET_REPOSITORY,
	);
	if (deliveryId !== expectedId) {
		throw new Error(`Delivery ledger contains a noncanonical delivery_id: ${deliveryId}`);
	}
	return { release_tag: releaseTag, target_commit: targetCommit, version };
}

export function parseDeliveryLedger(document: unknown): ApiSpecDeliveryLedger {
	if (!document || typeof document !== "object" || Array.isArray(document)) {
		throw new Error("Delivery ledger must be an object");
	}
	const ledger = document as Record<string, unknown>;
	if (JSON.stringify(sortedKeys(ledger)) !== JSON.stringify(["deliveries", "version"])) {
		throw new Error("Delivery ledger has an invalid shape");
	}
	if (ledger.version !== LEDGER_VERSION) {
		throw new Error(`Delivery ledger version must be ${LEDGER_VERSION}`);
	}
	if (!ledger.deliveries || typeof ledger.deliveries !== "object" || Array.isArray(ledger.deliveries)) {
		throw new Error("Delivery ledger deliveries must be an object");
	}
	const deliveries: Record<string, ApiSpecDeliveryLedgerEntry> = {};
	for (const [deliveryId, entry] of Object.entries(ledger.deliveries)) {
		deliveries[deliveryId] = validateLedgerEntry(deliveryId, entry);
	}
	return { deliveries, version: LEDGER_VERSION };
}

export function deliveryApplied(document: unknown, delivery: ApiSpecDelivery): boolean {
	const ledger = parseDeliveryLedger(document);
	const existing = ledger.deliveries[delivery.deliveryId];
	if (existing) {
		if (!ledgerEntriesEqual(existing, ledgerEntryFor(delivery))) {
			throw new Error(`Delivery ledger entry disagrees with ${delivery.deliveryId}`);
		}
		return true;
	}
	for (const [deliveryId, entry] of Object.entries(ledger.deliveries)) {
		if (entry.release_tag === delivery.releaseTag) {
			throw new Error(`Release ${delivery.releaseTag} was already applied under delivery ${deliveryId}`);
		}
	}
	return false;
}

export async function readDeliveryLedger(ledgerFile: string): Promise<ApiSpecDeliveryLedger | undefined> {
	try {
		return parseDeliveryLedger(await Bun.file(ledgerFile).json());
	} catch (error) {
		if (isEnoent(error)) return undefined;
		throw error;
	}
}

export async function readPendingDelivery(pendingFile: string): Promise<unknown | undefined> {
	try {
		return await Bun.file(pendingFile).json();
	} catch (error) {
		if (isEnoent(error)) return undefined;
		throw error;
	}
}

export async function writePendingDelivery(
	repoRoot: string,
	delivery: ApiSpecDelivery,
	sourcePinFile: string,
	providerTag: string,
	providerCommit: string,
): Promise<string> {
	const pin = parseSpecReleasePin(await Bun.file(sourcePinFile).json(), delivery);
	const destination = path.join(repoRoot, DELIVERY_PENDING_PATH);
	const existing = await readPendingDelivery(destination);
	if (existing !== undefined) {
		verifyPendingDelivery(existing, delivery);
	}
	const pending = await pendingDeliveryFor(repoRoot, delivery, pin, providerTag, providerCommit);
	const canonicalPin = `${JSON.stringify(pin, null, "\t")}\n`;
	await Bun.write(path.join(repoRoot, SPEC_RELEASE_PATH), canonicalPin);
	await Bun.write(destination, `${JSON.stringify(pending, null, "\t")}\n`);
	return DELIVERY_PENDING_PATH;
}

export async function verifyGeneratedDelivery(
	repoRoot: string,
	delivery: ApiSpecDelivery,
	providerTag: string,
	providerCommit: string,
): Promise<void> {
	const pending = await readPendingDelivery(path.join(repoRoot, DELIVERY_PENDING_PATH));
	if (pending === undefined) throw new Error(`Pending delivery marker is absent: ${DELIVERY_PENDING_PATH}`);
	const verified = verifyPendingDelivery(pending, delivery);
	if (verified.provider.tag !== providerTag || verified.provider.commit !== providerCommit) {
		throw new Error("Generated delivery provider identity differs from the receipted provider release");
	}
	const pinPath = path.join(repoRoot, SPEC_RELEASE_PATH);
	const pin = parseSpecReleasePin(await Bun.file(pinPath).json(), delivery);
	if ((await sha256File(pinPath)) !== verified.spec_release_sha256) {
		throw new Error("Generated delivery spec release pin differs from its pending attestation");
	}
	for (const generatedPath of GENERATED_DELIVERY_PATHS) {
		if ((await sha256File(path.join(repoRoot, generatedPath))) !== verified.generated[generatedPath]) {
			throw new Error(`Generated delivery bytes differ from pending attestation: ${generatedPath}`);
		}
	}
	void pin;
}

export async function clearPendingDelivery(repoRoot: string, delivery: ApiSpecDelivery): Promise<void> {
	const destination = path.join(repoRoot, DELIVERY_PENDING_PATH);
	const existing = await readPendingDelivery(destination);
	if (existing === undefined) throw new Error(`Pending delivery marker is absent: ${DELIVERY_PENDING_PATH}`);
	verifyPendingDelivery(existing, delivery);
	await fs.unlink(destination);
}

function validatePublicationEvidence(document: unknown): XcshPublicationEvidence {
	if (!document || typeof document !== "object" || Array.isArray(document)) {
		throw new Error("xcsh publication evidence must be an object");
	}
	const evidence = document as Record<string, unknown>;
	if (
		JSON.stringify(sortedKeys(evidence)) !==
		JSON.stringify(["assets", "commit", "generated", "npm", "provider", "spec_release_sha256", "tag", "version"])
	) {
		throw new Error("xcsh publication evidence has an invalid shape");
	}
	const version = requiredString(evidence.version, "publication.version");
	const tag = requiredString(evidence.tag, "publication.tag");
	validateReleaseIdentity(version, tag);
	const commit = requiredString(evidence.commit, "publication.commit");
	if (!COMMIT_PATTERN.test(commit)) throw new Error("xcsh publication evidence has an invalid commit");
	const assets = validateDigestMap(evidence.assets, XCSH_RELEASE_ASSETS, "publication.assets");
	const generated = validateDigestMap(evidence.generated, GENERATED_DELIVERY_PATHS, "publication.generated");
	if (!evidence.provider || typeof evidence.provider !== "object" || Array.isArray(evidence.provider)) {
		throw new Error("xcsh publication provider identity must be an object");
	}
	const rawProvider = evidence.provider as Record<string, unknown>;
	if (JSON.stringify(sortedKeys(rawProvider)) !== JSON.stringify(["commit", "tag"])) {
		throw new Error("xcsh publication provider identity has an invalid shape");
	}
	const providerCommit = requiredString(rawProvider.commit, "publication.provider.commit");
	const providerTag = requiredString(rawProvider.tag, "publication.provider.tag");
	if (!COMMIT_PATTERN.test(providerCommit) || !/^v\d+\.\d+\.\d+$/.test(providerTag)) {
		throw new Error("xcsh publication provider identity is malformed");
	}
	const specReleaseSha256 = requiredString(evidence.spec_release_sha256, "publication.spec_release_sha256");
	if (!SHA256_PATTERN.test(specReleaseSha256)) throw new Error("xcsh publication spec release digest is malformed");
	if (!evidence.npm || typeof evidence.npm !== "object" || Array.isArray(evidence.npm)) {
		throw new Error("xcsh publication npm evidence must be an object");
	}
	const rawNpm = evidence.npm as Record<string, unknown>;
	if (JSON.stringify(sortedKeys(rawNpm)) !== JSON.stringify([...XCSH_PACKAGES].sort())) {
		throw new Error("xcsh publication npm evidence has the wrong package set");
	}
	const npm: Record<string, XcshNpmEvidence> = {};
	for (const packageName of XCSH_PACKAGES) {
		const rawPackage = rawNpm[packageName];
		if (!rawPackage || typeof rawPackage !== "object" || Array.isArray(rawPackage)) {
			throw new Error(`xcsh publication npm evidence is malformed for ${packageName}`);
		}
		const packageEvidence = rawPackage as Record<string, unknown>;
		if (JSON.stringify(sortedKeys(packageEvidence)) !== JSON.stringify(["git_head", "integrity"])) {
			throw new Error(`xcsh publication npm evidence has an invalid shape for ${packageName}`);
		}
		const gitHead = requiredString(packageEvidence.git_head, `publication.npm.${packageName}.git_head`);
		const integrity = requiredString(packageEvidence.integrity, `publication.npm.${packageName}.integrity`);
		if (gitHead !== commit || !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(integrity)) {
			throw new Error(`xcsh publication npm evidence is not bound to commit ${commit}`);
		}
		npm[packageName] = { git_head: gitHead, integrity };
	}
	return {
		assets,
		commit,
		generated,
		npm,
		provider: { commit: providerCommit, tag: providerTag },
		spec_release_sha256: specReleaseSha256,
		tag,
		version,
	};
}

function parsePublicationLedger(
	document: unknown,
	common: ApiSpecDeliveryLedger,
): XcshPublicationReceiptLedger {
	if (!document || typeof document !== "object" || Array.isArray(document)) {
		throw new Error("xcsh publication receipt ledger must be an object");
	}
	const ledger = document as Record<string, unknown>;
	if (JSON.stringify(sortedKeys(ledger)) !== JSON.stringify(["receipts", "version"]) || ledger.version !== 1) {
		throw new Error("xcsh publication receipt ledger has an invalid shape or version");
	}
	if (!ledger.receipts || typeof ledger.receipts !== "object" || Array.isArray(ledger.receipts)) {
		throw new Error("xcsh publication receipts must be an object");
	}
	const receipts: Record<string, XcshPublicationReceiptEntry> = {};
	for (const [deliveryId, rawEntry] of Object.entries(ledger.receipts)) {
		if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) {
			throw new Error(`xcsh publication receipt ${deliveryId} must be an object`);
		}
		const entry = rawEntry as Record<string, unknown>;
		if (JSON.stringify(sortedKeys(entry)) !== JSON.stringify(["delivery", "publication"])) {
			throw new Error(`xcsh publication receipt ${deliveryId} has an invalid shape`);
		}
		const commonEntry = common.deliveries[deliveryId];
		const detailedEntry = validateLedgerEntry(deliveryId, entry.delivery);
		if (!commonEntry || !ledgerEntriesEqual(detailedEntry, commonEntry)) {
			throw new Error(`xcsh publication receipt ${deliveryId} differs from the common delivery ledger`);
		}
		receipts[deliveryId] = { delivery: commonEntry, publication: validatePublicationEvidence(entry.publication) };
	}
	if (JSON.stringify(sortedKeys(receipts)) !== JSON.stringify(sortedKeys(common.deliveries))) {
		throw new Error("Common and xcsh publication receipt ledgers have different delivery keys");
	}
	return { receipts, version: 1 };
}

async function readPublicationLedger(
	file: string,
	common: ApiSpecDeliveryLedger,
): Promise<XcshPublicationReceiptLedger> {
	try {
		return parsePublicationLedger(await Bun.file(file).json(), common);
	} catch (error) {
		if (isEnoent(error)) throw new Error(`xcsh publication receipt ledger is absent: ${file}`);
		throw error;
	}
}

export async function acknowledgePublishedDelivery(
	repoRoot: string,
	delivery: ApiSpecDelivery,
	publicationFile: string,
): Promise<void> {
	const commonPath = path.join(repoRoot, DELIVERY_LEDGER_PATH);
	const publicationPath = path.join(repoRoot, DELIVERY_PUBLICATION_LEDGER_PATH);
	const common = await readDeliveryLedger(commonPath);
	if (!common) throw new Error(`Delivery ledger is absent: ${DELIVERY_LEDGER_PATH}`);
	const detailed = await readPublicationLedger(publicationPath, common);
	if (deliveryApplied(common, delivery)) return;
	const pendingDocument = await readPendingDelivery(path.join(repoRoot, DELIVERY_PENDING_PATH));
	if (pendingDocument === undefined) throw new Error(`Pending delivery marker is absent: ${DELIVERY_PENDING_PATH}`);
	const pending = verifyPendingDelivery(pendingDocument, delivery);
	const publication = validatePublicationEvidence(await Bun.file(publicationFile).json());
	if (
		publication.provider.commit !== pending.provider.commit ||
		publication.provider.tag !== pending.provider.tag ||
		publication.spec_release_sha256 !== pending.spec_release_sha256 ||
		!digestMapsEqual(publication.generated, pending.generated)
	) {
		throw new Error("xcsh publication evidence differs from the pending delivery attestation");
	}
	common.deliveries[delivery.deliveryId] = ledgerEntryFor(delivery);
	detailed.receipts[delivery.deliveryId] = { delivery: ledgerEntryFor(delivery), publication };
	const orderedCommon = Object.fromEntries(Object.entries(common.deliveries).sort(([left], [right]) => left.localeCompare(right)));
	const orderedDetailed = Object.fromEntries(Object.entries(detailed.receipts).sort(([left], [right]) => left.localeCompare(right)));
	await Bun.write(commonPath, `${JSON.stringify({ deliveries: orderedCommon, version: 1 }, null, "\t")}\n`);
	await Bun.write(publicationPath, `${JSON.stringify({ receipts: orderedDetailed, version: 1 }, null, "\t")}\n`);
	await clearPendingDelivery(repoRoot, delivery);
}

export async function verifyAcknowledgmentLedgers(
	commonFile: string,
	publicationFile: string,
	delivery: ApiSpecDelivery,
): Promise<boolean> {
	const common = await readDeliveryLedger(commonFile);
	if (!common) throw new Error(`Delivery ledger is absent: ${commonFile}`);
	await readPublicationLedger(publicationFile, common);
	return deliveryApplied(common, delivery);
}

async function githubDocument(url: string, token: string | undefined, fetcher: Fetcher): Promise<unknown> {
	const headers: Record<string, string> = {
		Accept: "application/vnd.github+json",
		"X-GitHub-Api-Version": "2022-11-28",
	};
	if (token) headers.Authorization = `Bearer ${token}`;
	const response = await fetcher(url, { headers });
	if (!response.ok) {
		throw new Error(`GitHub release identity request failed with HTTP ${response.status}`);
	}
	return response.json();
}

export async function verifyReleasedTag(
	delivery: ApiSpecDelivery,
	token: string | undefined,
	fetcher: Fetcher = fetch,
): Promise<SourcePublicationReceipt> {
	const apiRoot = `https://api.github.com/repos/${SOURCE_REPOSITORY}`;
	const release = (await githubDocument(`${apiRoot}/releases/tags/${delivery.releaseTag}`, token, fetcher)) as Record<
		string,
		unknown
	>;
	if (
		release.tag_name !== delivery.releaseTag ||
		release.draft !== false ||
		release.prerelease !== false ||
		release.immutable !== true
	) {
		throw new Error(`Release ${delivery.releaseTag} is not final and immutable`);
	}
	if (!Array.isArray(release.assets)) throw new Error("Published release assets must be an array");
	const apiDigests: Record<string, string> = {};
	for (const rawAsset of release.assets) {
		if (!rawAsset || typeof rawAsset !== "object" || Array.isArray(rawAsset)) {
			throw new Error("Published release contains a malformed asset");
		}
		const asset = rawAsset as Record<string, unknown>;
		const name = requiredString(asset.name, "release asset name");
		const digest = requiredString(asset.digest, `release asset ${name} digest`);
		if (name in apiDigests || !digest.startsWith("sha256:") || !SHA256_PATTERN.test(digest.slice(7))) {
			throw new Error(`Published release has no unique immutable SHA-256 digest for ${name}`);
		}
		apiDigests[name] = digest.slice(7);
	}
	validateDigestMap(apiDigests, expectedSpecAssetNames(delivery.releaseTag), "published release assets");

	const body = typeof release.body === "string" ? release.body : "";
	const receiptLines = body
		.split("\n")
		.filter(line => line.startsWith("<!-- publication-receipt:") && line.endsWith(" -->"));
	if (receiptLines.length !== 1) throw new Error("Published release must contain exactly one publication receipt");
	const rawReceipt = receiptLines[0].slice("<!-- publication-receipt:".length, -" -->".length);
	let receiptDocument: unknown;
	try {
		receiptDocument = JSON.parse(rawReceipt);
	} catch {
		throw new Error("Published release receipt is not valid JSON");
	}
	if (!receiptDocument || typeof receiptDocument !== "object" || Array.isArray(receiptDocument)) {
		throw new Error("Published release receipt must be an object");
	}
	const raw = receiptDocument as Record<string, unknown>;
	if (JSON.stringify(sortedKeys(raw)) !== JSON.stringify(["assets", "commit", "version"])) {
		throw new Error("Published release receipt has an invalid shape");
	}
	const commit = requiredString(raw.commit, "publication receipt commit");
	const version = requiredString(raw.version, "publication receipt version");
	const receipt: SourcePublicationReceipt = {
		assets: validateQualifiedDigestMap(
			raw.assets,
			expectedSpecAssetNames(delivery.releaseTag),
			"publication receipt assets",
		),
		commit,
		version,
	};
	if (commit !== delivery.targetCommit || version !== delivery.version) {
		throw new Error("Published release receipt disagrees with the dispatched identity");
	}
	for (const [name, digest] of Object.entries(receipt.assets)) {
		if (apiDigests[name] !== digest) {
			throw new Error(`Published release API digest differs from its publication receipt for ${name}`);
		}
	}
	let reference = (await githubDocument(
		`${apiRoot}/git/ref/tags/${delivery.releaseTag}`,
		token,
		fetcher,
	)) as Record<string, unknown>;
	for (let depth = 0; depth < 5; depth++) {
		const object = reference.object;
		if (!object || typeof object !== "object") throw new Error("Published release tag has no Git object");
		const gitObject = object as Record<string, unknown>;
		const sha = requiredString(gitObject.sha, "release tag SHA");
		const type = requiredString(gitObject.type, "release tag object type");
		if (type === "commit") {
			if (sha !== delivery.targetCommit) {
				throw new Error(`Published release tag commit does not match dispatched target_commit`);
			}
			return receipt;
		}
		if (type !== "tag") throw new Error(`Published release tag points to unsupported Git object type ${type}`);
		reference = (await githubDocument(`${apiRoot}/git/tags/${sha}`, token, fetcher)) as Record<string, unknown>;
	}
	throw new Error("Published release tag indirection exceeds the supported depth");
}

async function readEventFromEnvironment(): Promise<ApiSpecDelivery> {
	const eventPath = requiredString(process.env.GITHUB_EVENT_PATH, "GITHUB_EVENT_PATH");
	const event = await Bun.file(eventPath).json();
	if (process.env.GITHUB_EVENT_NAME !== "workflow_dispatch") return parseDispatchEvent(event);
	if (!event || typeof event !== "object" || Array.isArray(event)) {
		throw new Error("Manual replay event must be an object");
	}
	const inputs = (event as Record<string, unknown>).inputs;
	if (!inputs || typeof inputs !== "object" || Array.isArray(inputs)) {
		throw new Error("Manual replay event has no inputs object");
	}
	const requestedDeliveryId = requiredString((inputs as Record<string, unknown>).delivery_id, "delivery_id");
	if (!DELIVERY_ID_PATTERN.test(requestedDeliveryId)) {
		throw new Error("Manual replay delivery_id must be a lowercase SHA-256 digest");
	}
	const repoRoot = requiredString(process.env.GITHUB_WORKSPACE, "GITHUB_WORKSPACE");
	const pendingDocument = await readPendingDelivery(path.join(repoRoot, DELIVERY_PENDING_PATH));
	if (!pendingDocument || typeof pendingDocument !== "object" || Array.isArray(pendingDocument)) {
		throw new Error("Manual replay requires the pending delivery marker on main");
	}
	const pending = pendingDocument as Record<string, unknown>;
	const delivery = {
		deliveryId: requestedDeliveryId,
		releaseTag: requiredString(pending.release_tag, "pending.release_tag"),
		targetCommit: requiredString(pending.target_commit, "pending.target_commit"),
		triggerSource: requiredString(pending.trigger_source, "pending.trigger_source"),
		version: requiredString(pending.version, "pending.version"),
	};
	if (delivery.deliveryId !== pending.delivery_id || delivery.deliveryId !== calculateDeliveryId(delivery)) {
		throw new Error("Manual replay delivery_id does not match the pending delivery identity");
	}
	verifyPendingDelivery(pendingDocument, delivery);
	return delivery;
}

function readVerificationDeliveryFromEnvironment(): ApiSpecDelivery {
	const delivery = {
		deliveryId: requiredString(process.env.DELIVERY_ID, "DELIVERY_ID"),
		releaseTag: requiredString(process.env.DELIVERY_RELEASE_TAG, "DELIVERY_RELEASE_TAG"),
		targetCommit: requiredString(process.env.DELIVERY_TARGET_COMMIT, "DELIVERY_TARGET_COMMIT"),
		triggerSource: requiredString(process.env.DELIVERY_TRIGGER_SOURCE, "DELIVERY_TRIGGER_SOURCE"),
		version: requiredString(process.env.DELIVERY_VERSION, "DELIVERY_VERSION"),
	};
	if (!DELIVERY_ID_PATTERN.test(delivery.deliveryId) || delivery.deliveryId !== calculateDeliveryId(delivery)) {
		throw new Error("Verification delivery identity does not match its canonical fields");
	}
	return delivery;
}

async function appendOutputs(delivery: ApiSpecDelivery): Promise<void> {
	const outputPath = requiredString(process.env.GITHUB_OUTPUT, "GITHUB_OUTPUT");
	const values = {
		ack_branch: `chore/api-spec-delivery-ack-${delivery.deliveryId.slice(0, 12)}`,
		branch: deliveryBranch(delivery),
		delivery_id: delivery.deliveryId,
		ledger_path: DELIVERY_LEDGER_PATH,
		pending_path: DELIVERY_PENDING_PATH,
		publication_ledger_path: DELIVERY_PUBLICATION_LEDGER_PATH,
		provider_delivery_id: calculateDeliveryIdForTarget(delivery, PROVIDER_REPOSITORY),
		trigger_source: delivery.triggerSource,
		release_tag: delivery.releaseTag,
		target_commit: delivery.targetCommit,
		version: delivery.version,
	};
	await fs.appendFile(
		outputPath,
		Object.entries(values)
			.map(([key, value]) => `${key}=${value}\n`)
			.join(""),
	);
}

async function main(): Promise<void> {
	const command = process.argv[2];
	const delivery = command === "verify-ledger" ? readVerificationDeliveryFromEnvironment() : await readEventFromEnvironment();
	if (command === "validate-event") {
		await appendOutputs(delivery);
		return;
	}
	if (command === "verify-release") {
		const receipt = await verifyReleasedTag(delivery, process.env.GITHUB_TOKEN);
		const pin = parseSpecReleasePin(
			{
				assets: receipt.assets,
				release_tag: delivery.releaseTag,
				target_commit: receipt.commit,
				version: receipt.version,
			},
			delivery,
		);
		const runnerTemp = requiredString(process.env.RUNNER_TEMP, "RUNNER_TEMP");
		const pinPath = path.join(runnerTemp, "api-spec-release.json");
		await Bun.write(pinPath, `${JSON.stringify(pin, null, "\t")}\n`);
		const outputPath = requiredString(process.env.GITHUB_OUTPUT, "GITHUB_OUTPUT");
		const bundleName = `f5xc-api-specs-${delivery.releaseTag}.zip`;
		await fs.appendFile(
			outputPath,
			[
				`bundle_sha256=${pin.assets[bundleName]}`,
				`catalog_sha256=${pin.assets["api-catalog.json"]}`,
				`defaults_sha256=${pin.assets["minimal-export-defaults.json"]}`,
				`pin_path=${pinPath}`,
			].join("\n") + "\n",
		);
		return;
	}
	if (command === "check-ledger" || command === "verify-ledger") {
		const ledgerFile = requiredString(process.env.DELIVERY_LEDGER_FILE, "DELIVERY_LEDGER_FILE");
		const publicationFile = requiredString(
			process.env.DELIVERY_PUBLICATION_LEDGER_FILE,
			"DELIVERY_PUBLICATION_LEDGER_FILE",
		);
		const applied = await verifyAcknowledgmentLedgers(ledgerFile, publicationFile, delivery);
		if (command === "verify-ledger" && !applied) {
			throw new Error(`Delivery ${delivery.deliveryId} is absent from the delivery ledger`);
		}
		if (command === "check-ledger") {
			const outputPath = requiredString(process.env.GITHUB_OUTPUT, "GITHUB_OUTPUT");
			await fs.appendFile(outputPath, `applied=${applied}\n`);
		}
		return;
	}
	if (command === "check-pending" || command === "verify-pending") {
		const pendingFile = requiredString(process.env.DELIVERY_PENDING_FILE, "DELIVERY_PENDING_FILE");
		const pending = await readPendingDelivery(pendingFile);
		if (pending !== undefined) verifyPendingDelivery(pending, delivery);
		if (command === "verify-pending" && pending === undefined) {
			throw new Error(`Pending delivery marker is absent: ${pendingFile}`);
		}
		if (command === "check-pending") {
			const outputPath = requiredString(process.env.GITHUB_OUTPUT, "GITHUB_OUTPUT");
			await fs.appendFile(outputPath, `pending=${pending !== undefined}\n`);
		}
		return;
	}
	if (command === "record-pending") {
		const repoRoot = requiredString(process.env.GITHUB_WORKSPACE, "GITHUB_WORKSPACE");
		await writePendingDelivery(
			repoRoot,
			delivery,
			requiredString(process.env.SOURCE_RELEASE_PIN_FILE, "SOURCE_RELEASE_PIN_FILE"),
			requiredString(process.env.PROVIDER_TAG, "PROVIDER_TAG"),
			requiredString(process.env.PROVIDER_COMMIT, "PROVIDER_COMMIT"),
		);
		return;
	}
	if (command === "verify-generated") {
		const repoRoot = requiredString(process.env.GITHUB_WORKSPACE, "GITHUB_WORKSPACE");
		await verifyGeneratedDelivery(
			repoRoot,
			delivery,
			requiredString(process.env.PROVIDER_TAG, "PROVIDER_TAG"),
			requiredString(process.env.PROVIDER_COMMIT, "PROVIDER_COMMIT"),
		);
		return;
	}
	if (command === "acknowledge") {
		const repoRoot = requiredString(process.env.GITHUB_WORKSPACE, "GITHUB_WORKSPACE");
		await acknowledgePublishedDelivery(
			repoRoot,
			delivery,
			requiredString(process.env.PUBLICATION_RECEIPT_FILE, "PUBLICATION_RECEIPT_FILE"),
		);
		return;
	}
	throw new Error(`Unknown api-spec delivery command: ${String(command)}`);
}

if (import.meta.main) await main();
