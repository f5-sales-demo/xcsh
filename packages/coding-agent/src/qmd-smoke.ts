import os from "node:os";
import path from "node:path";
import { getAgentDbPath } from "@f5-sales-demo/pi-utils";
import retiredDocuments from "../bench/fixtures/documentation-oct7-retired.json";
import { EMBEDDED_DOCUMENTATION_ASSETS } from "./internal-urls/documentation-assets.generated";
import {
	createEmbeddedDocumentationRepository,
	type EmbeddedDocumentationRepository,
} from "./internal-urls/documentation-repository";
import type {
	DocumentationRepository,
	DocumentationSearchResult,
	DocumentationSource,
} from "./internal-urls/documentation-resolve";
import { convertToPng } from "./utils/image-convert";

export const QMD_SMOKE_SUCCESS = "XCSH_QMD_SMOKE_OK";
export const DOCUMENTATION_TOOLS_DISABLED_MESSAGE =
	"Pinned offline documentation is unavailable because this session has no read tool; the answer cannot be verified.";

const EXPECTED_CATEGORY = "dns-dns-zone-clone-from-dns-domain";
const WAF_QUERY = "configure web application firewall";
const WAF_PATH = "web-app-and-api-protection/how-to/app-security/application-firewall";
const WAF_TITLE = "Create Web Application Firewall";
const MARKETING_QUERY = "what is client side defense";
const MARKETING_PATH = "products/distributed-cloud-services/client-side-defense";
const MARKETING_TITLE = "F5 Distributed Cloud Client-Side Defense";
const MARKETING_SOURCE = "www-f5-com" as const;
const DNS_QUERY = "set up DNS load balancer";
const DNS_PATH = "dns-management/how-to/configure-dns-load-balancer";
const DNS_TITLE = "Set Up DNS Load Balancer";
const MISSING_QUERY = "zzzxxyyqqqv";
const MISSING_PATH = "missing-smoke-document";
const SOURCE = "docs-cloud-f5-com" as const;
const SVG_PATH = "administration";
const SVG_FILENAME = "9b018ba3f71b1f3a7068267cb30fefe9362cfa13e8fd90e1f14e6c67fbfe480c.svg";
const MISSING_SEARCH_URI = `xcsh://documentation/?search=${MISSING_QUERY}`;

const EXPECTED_EVENTS = [
	"api-catalog-rank",
	"documentation-search",
	"documentation-read",
	"documentation-marketing-search",
	"documentation-marketing-read",
	"documentation-search",
	"documentation-read",
	"documentation-follow-up-read",
	"documentation-missing",
	"documentation-tools-disabled",
	"documentation-svg-convert",
	"sqlite-open",
] as const;

export type QmdSmokeEvent = (typeof EXPECTED_EVENTS)[number];

export interface QmdSmokeTraceEntry {
	readonly sequence: number;
	readonly event: QmdSmokeEvent;
	readonly resource?: string;
	readonly title?: string;
	readonly source?: DocumentationSource;
	readonly category?: string;
	readonly outcome?: string;
}

export interface QmdSmokeOptions {
	cacheRoot?: string;
	agentDatabasePath?: string;
	documentationCacheRoot?: string;
	documentationRepository?: DocumentationRepository;
}

function searchUri(query: string, source: DocumentationSource = SOURCE): string {
	return `xcsh://documentation/?search=${encodeURIComponent(query)}&source=${source}&limit=1`;
}

function documentUri(stablePath: string, source: DocumentationSource = SOURCE): string {
	return `xcsh://documentation/${source}/${stablePath}/index.md`;
}

function assetUri(stablePath: string, filename: string): string {
	return `xcsh://documentation/${SOURCE}/${stablePath}/assets/${filename}`;
}

function assertSearchResult(
	result: DocumentationSearchResult | undefined,
	expectedPath: string,
	expectedTitle: string,
	expectedSource: DocumentationSource = SOURCE,
): DocumentationSearchResult {
	if (result?.source !== expectedSource || result.stablePath !== expectedPath || result.title !== expectedTitle) {
		throw new Error(`Documentation QMD smoke expected ${expectedTitle} at ${expectedSource}/${expectedPath}`);
	}
	return result;
}

/** Parse and strictly validate stdout from the installed-binary QMD smoke driver. */
export function parseQmdSmokeOutput(output: string): QmdSmokeTraceEntry[] {
	const lines = output.trim().split(/\r?\n/);
	if (lines.pop() !== QMD_SMOKE_SUCCESS) throw new Error(`QMD smoke output must end with ${QMD_SMOKE_SUCCESS}`);
	const trace = lines.map((line, index) => {
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch {
			throw new Error(`QMD smoke trace line ${index + 1} is not JSON`);
		}
		if (!parsed || typeof parsed !== "object") throw new Error(`QMD smoke trace line ${index + 1} is not an object`);
		return parsed as QmdSmokeTraceEntry;
	});
	if (trace.length !== EXPECTED_EVENTS.length) throw new Error("QMD smoke trace has an unexpected event count");
	for (const [index, expectedEvent] of EXPECTED_EVENTS.entries()) {
		const entry = trace[index]!;
		if (entry.sequence !== index + 1 || entry.event !== expectedEvent) {
			throw new Error(`QMD smoke trace event ${index + 1} is out of order`);
		}
		if (entry.resource !== undefined && !entry.resource.startsWith("xcsh://documentation")) {
			throw new Error(`QMD smoke trace event ${index + 1} contains a non-documentation resource`);
		}
	}
	const expectedResources = [
		searchUri(WAF_QUERY),
		documentUri(WAF_PATH),
		searchUri(MARKETING_QUERY, MARKETING_SOURCE),
		documentUri(MARKETING_PATH, MARKETING_SOURCE),
		searchUri(DNS_QUERY),
		documentUri(DNS_PATH),
		documentUri(DNS_PATH),
		MISSING_SEARCH_URI,
		assetUri(SVG_PATH, SVG_FILENAME),
	];
	const actualResources = trace.flatMap(entry => (entry.resource ? [entry.resource] : []));
	if (JSON.stringify(actualResources) !== JSON.stringify(expectedResources)) {
		throw new Error("QMD smoke trace contains an unexpected documentation resource");
	}
	if (trace[0]?.category !== EXPECTED_CATEGORY || trace[0].outcome !== "rank-1") {
		throw new Error("QMD smoke trace contains an unexpected API catalog result");
	}
	for (const index of [1, 2]) {
		if (trace[index]?.title !== WAF_TITLE || trace[index]?.source !== SOURCE)
			throw new Error("QMD smoke trace contains unexpected WAF identity");
	}
	for (const index of [3, 4]) {
		if (trace[index]?.title !== MARKETING_TITLE || trace[index]?.source !== MARKETING_SOURCE)
			throw new Error("QMD smoke trace contains unexpected marketing identity");
	}
	for (const index of [5, 6, 7]) {
		if (trace[index]?.title !== DNS_TITLE || trace[index]?.source !== SOURCE)
			throw new Error("QMD smoke trace contains unexpected DNS identity");
	}
	if (trace[8]?.outcome !== "no-match-no-fetch") throw new Error("QMD smoke trace did not fail closed");
	if (trace[9]?.outcome !== DOCUMENTATION_TOOLS_DISABLED_MESSAGE)
		throw new Error("QMD smoke trace omitted the tools-disabled explanation");
	if (trace[10]?.source !== SOURCE || !["image/png", "public-media-link"].includes(trace[10].outcome ?? ""))
		throw new Error("QMD smoke trace contains an unexpected SVG conversion result");
	if (trace[11]?.outcome !== "ok") throw new Error("QMD smoke trace did not confirm SQLite startup");
	return trace;
}

/** Release-only probe for BM25, exact offline reads, image conversion, and process-global SQLite. */
export async function runQmdSmoke(options: QmdSmokeOptions = {}): Promise<string> {
	const trace: QmdSmokeTraceEntry[] = [];
	const emit = (entry: Omit<QmdSmokeTraceEntry, "sequence">) => trace.push({ sequence: trace.length + 1, ...entry });
	const { rankQmdBm25CatalogDiscovery } = await import("./internal-urls/api-catalog-discovery");
	const { QMD_API_CATALOG_PREBUILT_INDEX } = await import("./internal-urls/api-catalog-qmd-index.generated");
	const candidates = await rankQmdBm25CatalogDiscovery("clone a DNS zone", {
		cacheRoot: options.cacheRoot ?? path.join(os.homedir(), ".xcsh", "cache", "qmd-api-catalog"),
		prebuiltIndex: QMD_API_CATALOG_PREBUILT_INDEX,
		limit: 1,
	});
	if (candidates[0]?.categoryName !== EXPECTED_CATEGORY) {
		throw new Error(`QMD BM25 smoke expected ${EXPECTED_CATEGORY} at rank 1`);
	}
	emit({ event: "api-catalog-rank", category: EXPECTED_CATEGORY, outcome: "rank-1" });

	const documentation: DocumentationRepository | EmbeddedDocumentationRepository | null =
		options.documentationRepository ??
		(EMBEDDED_DOCUMENTATION_ASSETS
			? createEmbeddedDocumentationRepository(EMBEDDED_DOCUMENTATION_ASSETS, {
					cacheRoot: options.documentationCacheRoot ?? path.join(os.homedir(), ".xcsh", "cache", "documentation"),
				})
			: null);
	if (!documentation) throw new Error("QMD smoke requires embedded offline documentation assets");
	if ("prime" in documentation && typeof documentation.prime === "function") await documentation.prime();

	const waf = assertSearchResult((await documentation.search(WAF_QUERY, SOURCE, 1))[0], WAF_PATH, WAF_TITLE);
	emit({ event: "documentation-search", resource: searchUri(WAF_QUERY), title: waf.title, source: waf.source });
	const wafDocument = await documentation.readDocument(SOURCE, WAF_PATH);
	if (wafDocument?.title !== WAF_TITLE || !wafDocument.markdown.includes(`# ${WAF_TITLE}`)) {
		throw new Error("Documentation QMD smoke could not read exact WAF Markdown");
	}
	emit({ event: "documentation-read", resource: documentUri(WAF_PATH), title: wafDocument.title, source: SOURCE });

	const marketing = assertSearchResult(
		(await documentation.search(MARKETING_QUERY, MARKETING_SOURCE, 1))[0],
		MARKETING_PATH,
		MARKETING_TITLE,
		MARKETING_SOURCE,
	);
	emit({
		event: "documentation-marketing-search",
		resource: searchUri(MARKETING_QUERY, MARKETING_SOURCE),
		title: marketing.title,
		source: marketing.source,
	});
	const marketingDocument = await documentation.readDocument(MARKETING_SOURCE, MARKETING_PATH);
	if (
		marketingDocument?.title !== MARKETING_TITLE ||
		!marketingDocument.markdown.includes("# F5 Client-Side Defense")
	) {
		throw new Error("Documentation QMD smoke could not read exact marketing Markdown");
	}
	emit({
		event: "documentation-marketing-read",
		resource: documentUri(MARKETING_PATH, MARKETING_SOURCE),
		title: marketingDocument.title,
		source: MARKETING_SOURCE,
	});

	const dns = assertSearchResult((await documentation.search(DNS_QUERY, SOURCE, 1))[0], DNS_PATH, DNS_TITLE);
	emit({ event: "documentation-search", resource: searchUri(DNS_QUERY), title: dns.title, source: dns.source });
	const dnsDocument = await documentation.readDocument(SOURCE, DNS_PATH);
	if (dnsDocument?.title !== DNS_TITLE || !dnsDocument.markdown.includes(`# ${DNS_TITLE}`)) {
		throw new Error("Documentation QMD smoke could not read exact DNS Markdown");
	}
	emit({ event: "documentation-read", resource: documentUri(DNS_PATH), title: dnsDocument.title, source: SOURCE });
	const dnsFollowUp = await documentation.readDocument(SOURCE, DNS_PATH);
	if (dnsFollowUp?.title !== dnsDocument.title || dnsFollowUp.markdown !== dnsDocument.markdown) {
		throw new Error("Documentation QMD smoke did not preserve the selected DNS document");
	}
	emit({
		event: "documentation-follow-up-read",
		resource: documentUri(DNS_PATH),
		title: dnsFollowUp.title,
		source: SOURCE,
	});

	const missingResults = await documentation.search(MISSING_QUERY, undefined, 5);
	const missingDocument = await documentation.readDocument(SOURCE, MISSING_PATH);
	if (missingResults.length !== 0 || missingDocument !== null) {
		throw new Error("Documentation QMD smoke did not fail closed for missing content");
	}
	for (const retired of retiredDocuments) {
		if (await documentation.readDocument(retired.source as DocumentationSource, retired.stablePath))
			throw new Error("Documentation QMD smoke found a retired document");
	}
	emit({ event: "documentation-missing", resource: MISSING_SEARCH_URI, outcome: "no-match-no-fetch" });
	emit({ event: "documentation-tools-disabled", outcome: DOCUMENTATION_TOOLS_DISABLED_MESSAGE });

	const svg = await documentation.readAsset(SOURCE, SVG_PATH, SVG_FILENAME);
	if (!svg) throw new Error("Documentation QMD smoke could not locate the verified SVG asset");
	let outcome: "public-media-link" | "image/png";
	if ("publicUrl" in svg) {
		if (!svg.publicUrl.startsWith("https://"))
			throw new Error("Documentation QMD smoke media link is not public HTTPS");
		outcome = "public-media-link";
	} else {
		const png = await convertToPng(svg.data, svg.mimeType);
		if (png?.mimeType !== "image/png")
			throw new Error("Documentation QMD smoke could not read and convert an SVG asset");
		outcome = "image/png";
	}
	emit({
		event: "documentation-svg-convert",
		resource: assetUri(SVG_PATH, SVG_FILENAME),
		source: SOURCE,
		outcome,
	});

	// QMD initializes first so this catches dependency code that changes Bun's
	// process-global SQLite implementation before xcsh opens its own database.
	const { AgentStorage } = await import("./session/agent-storage");
	await AgentStorage.open(options.agentDatabasePath ?? getAgentDbPath());
	emit({ event: "sqlite-open", outcome: "ok" });

	const output = `${trace.map(entry => JSON.stringify(entry)).join("\n")}\n${QMD_SMOKE_SUCCESS}`;
	parseQmdSmokeOutput(output);
	return output;
}
