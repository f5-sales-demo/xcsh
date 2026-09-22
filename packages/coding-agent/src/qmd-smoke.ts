import os from "node:os";
import path from "node:path";
import { getAgentDbPath } from "@f5-sales-demo/pi-utils";

export const QMD_SMOKE_SUCCESS = "XCSH_QMD_SMOKE_OK";
const EXPECTED_CATEGORY = "dns-dns-zone-clone-from-dns-domain";

export interface QmdSmokeOptions {
	cacheRoot?: string;
	agentDatabasePath?: string;
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

	// QMD initializes first so this catches dependency code that changes Bun's
	// process-global SQLite implementation before xcsh opens its own database.
	const { AgentStorage } = await import("./session/agent-storage");
	await AgentStorage.open(options.agentDatabasePath ?? getAgentDbPath());
	return QMD_SMOKE_SUCCESS;
}
