import os from "node:os";
import path from "node:path";
import { getAgentDbPath } from "@f5-sales-demo/pi-utils";
import { EMBEDDED_DOCUMENTATION_ASSETS } from "./internal-urls/documentation-assets.generated";
import { createEmbeddedDocumentationRepository } from "./internal-urls/documentation-repository";
import { convertToPng } from "./utils/image-convert";

export const QMD_SMOKE_SUCCESS = "XCSH_QMD_SMOKE_OK";
const EXPECTED_CATEGORY = "dns-dns-zone-clone-from-dns-domain";

export interface QmdSmokeOptions {
	cacheRoot?: string;
	agentDatabasePath?: string;
	documentationCacheRoot?: string;
}

/** Release-only probe for the exact BM25 and process-global SQLite boundary. */
export async function runQmdSmoke(options: QmdSmokeOptions = {}): Promise<string> {
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

	if (EMBEDDED_DOCUMENTATION_ASSETS) {
		const documentation = createEmbeddedDocumentationRepository(EMBEDDED_DOCUMENTATION_ASSETS, {
			cacheRoot: options.documentationCacheRoot ?? path.join(os.homedir(), ".xcsh", "cache", "documentation"),
		});
		const results = await documentation.search("configure web application firewall", "docs-cloud-f5-com", 1);
		const expectedPath = "docs/how-to/app-security/web-app-firewall";
		if (results[0]?.stablePath !== expectedPath) {
			throw new Error(`Documentation QMD smoke expected ${expectedPath} at rank 1`);
		}
		const document = await documentation.readDocument("docs-cloud-f5-com", expectedPath);
		if (!document?.markdown.includes("# Create Web Application Firewall")) {
			throw new Error("Documentation QMD smoke could not read exact Markdown");
		}
		const svg = await documentation.readAsset(
			"docs-cloud-f5-com",
			"administration",
			"9b018ba3f71b1f3a7068267cb30fefe9362cfa13e8fd90e1f14e6c67fbfe480c.svg",
		);
		if (!svg || !(await convertToPng(svg.data, svg.mimeType))) {
			throw new Error("Documentation QMD smoke could not read and convert an SVG asset");
		}
	}

	// QMD initializes first so this catches dependency code that changes Bun's
	// process-global SQLite implementation before xcsh opens its own database.
	const { AgentStorage } = await import("./session/agent-storage");
	await AgentStorage.open(options.agentDatabasePath ?? getAgentDbPath());
	return QMD_SMOKE_SUCCESS;
}
