import { prompt } from "@f5-sales-demo/pi-utils";
import indexTemplate from "../prompts/internal-urls/blindfold-index.md" with { type: "text" };
import taskTemplate from "../prompts/internal-urls/blindfold-task.md" with { type: "text" };
import type { RuntimeBuildInfo } from "./build-info-runtime";
import { EMBEDDED_DOCS } from "./docs-index.generated";
import type { InternalResource, InternalUrl } from "./types";

const SOURCE_PATH = "docs/en/f5-distributed-cloud/blindfold-certificates.mdx";
const COMMON = ["Resolve failures and uncertain writes", "Public references"];
const TASKS: Record<string, string[]> = {
	encrypt: [
		"Retrieve public encryption material",
		"Encrypt a secret or prepare a certificate manifest",
		"Offline encryption",
		...COMMON,
	],
	certificate: [
		"Retrieve public encryption material",
		"Encrypt a secret or prepare a certificate manifest",
		"Offline encryption",
		"Use protected PEM and PKCS#12 inputs",
		"Create and rotate a certificate",
		...COMMON,
	],
	verify: ["Verify HTTPS after API acceptance", ...COMMON],
};

/** Extract complete maintained sections, failing visibly if the guide structure drifts. */
function section(guide: string, heading: string): string {
	const marker = `## ${heading}\n`;
	const start = guide.indexOf(marker);
	if (start < 0) throw new Error(`Blindfold guide section missing: ${heading}`);
	const end = guide.indexOf("\n## ", start + marker.length);
	return guide.slice(start, end < 0 ? undefined : end).trim();
}

export function resolveBlindfold(url: InternalUrl, info: RuntimeBuildInfo): InternalResource {
	const task = (url.rawPathname ?? url.pathname).replace(/^\/+|\/+$/g, "");
	if (new URL(url.href).search || (task && !Object.hasOwn(TASKS, task)))
		throw new Error(
			"Unknown Blindfold route. Valid destinations: xcsh://blindfold/, xcsh://blindfold/encrypt, xcsh://blindfold/certificate, xcsh://blindfold/verify",
		);
	const sourceUrl = `https://github.com/f5-sales-demo/xcsh/blob/${info.commit}/${SOURCE_PATH}`;
	const guide = EMBEDDED_DOCS[SOURCE_PATH.replace(/^docs\//, "")];
	if (!guide) throw new Error("Native Blindfold guide is unavailable");
	const content = prompt.render(task ? taskTemplate : indexTemplate, {
		task,
		sourceUrl,
		version: info.version,
		commit: info.shortCommit,
		sections: task ? TASKS[task].map(heading => section(guide, heading)).join("\n\n") : "",
	});
	const size = Buffer.byteLength(content);
	if (!task && size > 2048) throw new Error("Blindfold task index exceeds 2 KiB");
	return { url: url.href, content, contentType: "text/markdown", size, sourcePath: SOURCE_PATH };
}
