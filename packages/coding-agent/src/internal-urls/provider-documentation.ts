import { createHash } from "node:crypto";
import { withTimeout } from "@f5-sales-demo/pi-utils";
import type { RegistryFetch } from "./registry-resolve";
import type { InternalResource, InternalUrl } from "./types";

const REPOSITORY = "f5-sales-demo/terraform-provider-xcsh";
const SHA = /^[a-f0-9]{40}$/;
interface Deps {
	readonly fetch?: RegistryFetch;
	readonly timeoutMs?: number;
}

/** Bounded canonical page supplement; never downloads or replaces the embedded corpus. */
export class ProviderDocumentationResolver {
	readonly #deps: Deps;
	readonly #commits = new Map<string, Promise<string>>();
	constructor(deps: Deps = {}) {
		this.#deps = deps;
	}

	async #request<T>(url: string, decode: (response: Response) => Promise<T>): Promise<T> {
		const timeoutMs = this.#deps.timeoutMs ?? 10_000;
		const controller = new AbortController();
		const message = `Release documentation lookup timed out after ${timeoutMs} ms`;
		const timer = setTimeout(() => controller.abort(new Error(message)), timeoutMs);
		try {
			return await withTimeout(
				(async () => {
					const response = await (this.#deps.fetch ?? globalThis.fetch)(url, { signal: controller.signal });
					if (!response.ok) throw new Error(`Release documentation returned HTTP ${response.status}`);
					return decode(response);
				})(),
				timeoutMs,
				message,
				controller.signal,
			);
		} finally {
			clearTimeout(timer);
			controller.abort();
		}
	}

	#commit(version: string): Promise<string> {
		let pending = this.#commits.get(version);
		if (!pending) {
			pending = (async () => {
				let value = (await this.#request(`https://api.github.com/repos/${REPOSITORY}/git/ref/tags/${version}`, r =>
					r.json(),
				)) as { object?: { type?: string; sha?: string } };
				for (let depth = 0; depth < 5; depth++) {
					const object = value?.object;
					if (!object?.sha || !SHA.test(object.sha)) throw new Error("Release tag omitted an immutable object");
					if (object.type === "commit") return object.sha;
					if (object.type !== "tag") throw new Error("Release tag did not identify a commit");
					value = (await this.#request(`https://api.github.com/repos/${REPOSITORY}/git/tags/${object.sha}`, r =>
						r.json(),
					)) as typeof value;
				}
				throw new Error("Release tag nesting exceeded lookup limit");
			})().catch(error => {
				this.#commits.delete(version);
				throw error;
			});
			this.#commits.set(version, pending);
		}
		return pending;
	}

	async resolve(url: InternalUrl): Promise<InternalResource> {
		const raw = url.rawPathname ?? url.pathname;
		const match =
			/^\/(v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))\/(documentation\/(?:[a-z0-9_-]+\/)*[a-z0-9_-]+\.(?:md|txt))$/.exec(
				raw,
			);
		if (!match || url.search || url.hash)
			throw new Error(
				"Expected canonical xcsh://terraform-release/vN.N.N/documentation/<page>/index.md or documentation/llms.txt",
			);
		const [, version, page] = match;
		let content: string;
		try {
			const commit = await this.#commit(version);
			const markdown = await this.#request(`https://raw.githubusercontent.com/${REPOSITORY}/${commit}/${page}`, r =>
				r.text(),
			);
			const citeUrl = `https://github.com/${REPOSITORY}/blob/${commit}/${page}`;
			content = `Cite: ${citeUrl} (${version}, sha256:${createHash("sha256").update(markdown).digest("hex")})\nProvider: ${version}\nCommit: ${commit}\nDocument: ${page}\n\n${markdown}`;
		} catch (error) {
			content = `Release documentation lookup failed for ${version}, ${page}: ${error instanceof Error ? error.message : String(error)}. A failed page lookup does not establish that the selected release lacks a feature. Deliver an identified draft if schema repair or validation cannot succeed.`;
		}
		return {
			url: url.href,
			content,
			contentType: "text/markdown",
			size: Buffer.byteLength(content),
			sourcePath: url.href,
		};
	}
}
