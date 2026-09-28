const SUCCESS_MARKER = "XCSH_QMD_SMOKE_OK";
const SOURCE = "docs-cloud-f5-com";
const MARKETING_SOURCE = "www-f5-com";
const EXPECTED_CATEGORY = "dns-dns-zone-clone-from-dns-domain";
const TOOLS_DISABLED_MESSAGE =
	"Pinned offline documentation is unavailable because this session has no read tool; the answer cannot be verified.";
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
const EXPECTED_RESOURCES = [
	"xcsh://documentation/?search=configure%20web%20application%20firewall&source=docs-cloud-f5-com&limit=1",
	"xcsh://documentation/docs-cloud-f5-com/docs/how-to/app-security/web-app-firewall/index.md",
	"xcsh://documentation/?search=what%20is%20client%20side%20defense&source=www-f5-com&limit=1",
	"xcsh://documentation/www-f5-com/products/distributed-cloud-services/client-side-defense/index.md",
	"xcsh://documentation/?search=set%20up%20DNS%20load%20balancer&source=docs-cloud-f5-com&limit=1",
	"xcsh://documentation/docs-cloud-f5-com/dns-management/how-to/configure-dns-load-balancer/index.md",
	"xcsh://documentation/docs-cloud-f5-com/dns-management/how-to/configure-dns-load-balancer/index.md",
	"xcsh://documentation/?search=zzzxxyyqqqv",
	"xcsh://documentation/docs-cloud-f5-com/administration/assets/9b018ba3f71b1f3a7068267cb30fefe9362cfa13e8fd90e1f14e6c67fbfe480c.svg",
];

interface TraceEntry {
	sequence?: unknown;
	event?: unknown;
	resource?: unknown;
	title?: unknown;
	source?: unknown;
	category?: unknown;
	outcome?: unknown;
}

/** Strictly validate the installed binary's ordered, offline QMD smoke trace. */
export function parseQmdSmokeOutput(output: string): void {
	const lines = output.trim().split(/\r?\n/);
	if (lines.pop() !== SUCCESS_MARKER) throw new Error(`QMD smoke output must end with ${SUCCESS_MARKER}`);
	const trace = lines.map((line, index): TraceEntry => {
		let value: unknown;
		try {
			value = JSON.parse(line);
		} catch {
			throw new Error(`QMD smoke trace line ${index + 1} is not JSON`);
		}
		if (!value || typeof value !== "object") throw new Error(`QMD smoke trace line ${index + 1} is not an object`);
		return value as TraceEntry;
	});
	if (trace.length !== EXPECTED_EVENTS.length) throw new Error("QMD smoke trace has an unexpected event count");
	for (const [index, event] of EXPECTED_EVENTS.entries()) {
		const entry = trace[index];
		if (entry?.sequence !== index + 1 || entry.event !== event) {
			throw new Error(`QMD smoke trace event ${index + 1} is out of order`);
		}
		if (entry.resource !== undefined && (typeof entry.resource !== "string" || !entry.resource.startsWith("xcsh://documentation"))) {
			throw new Error(`QMD smoke trace event ${index + 1} contains a non-documentation resource`);
		}
	}
	const resources = trace.flatMap(entry => (typeof entry.resource === "string" ? [entry.resource] : []));
	if (JSON.stringify(resources) !== JSON.stringify(EXPECTED_RESOURCES)) {
		throw new Error("QMD smoke trace contains an unexpected documentation resource");
	}
	if (trace[0]?.category !== EXPECTED_CATEGORY || trace[0]?.outcome !== "rank-1") {
		throw new Error("QMD smoke trace contains an unexpected API catalog result");
	}
	for (const index of [1, 2]) {
		if (trace[index]?.title !== "Create Web Application Firewall" || trace[index]?.source !== SOURCE) {
			throw new Error("QMD smoke trace contains unexpected WAF identity");
		}
	}
	for (const index of [3, 4]) {
		if (
			trace[index]?.title !== "F5 Distributed Cloud Client-Side Defense" ||
			trace[index]?.source !== MARKETING_SOURCE
		) {
			throw new Error("QMD smoke trace contains unexpected marketing identity");
		}
	}
	for (const index of [5, 6, 7]) {
		if (trace[index]?.title !== "Set Up DNS Load Balancer" || trace[index]?.source !== SOURCE) {
			throw new Error("QMD smoke trace contains unexpected DNS identity");
		}
	}
	if (trace[8]?.outcome !== "no-match-no-fetch") throw new Error("QMD smoke trace did not fail closed");
	if (trace[9]?.outcome !== TOOLS_DISABLED_MESSAGE) {
		throw new Error("QMD smoke trace omitted the tools-disabled explanation");
	}
	if (trace[10]?.source !== SOURCE || trace[10]?.outcome !== "image/png") {
		throw new Error("QMD smoke trace contains an unexpected SVG conversion result");
	}
	if (trace[11]?.outcome !== "ok") throw new Error("QMD smoke trace did not confirm SQLite startup");
}
