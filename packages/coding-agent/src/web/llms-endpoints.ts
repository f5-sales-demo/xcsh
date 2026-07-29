/**
 * llms.txt endpoint discovery.
 *
 * Kept free of native and network imports so the scope walk can be unit tested
 * on its own: it is the only thing that decides whether a request for a
 * translated page reaches that language's llms.txt index or silently falls back
 * to the default locale's.
 */

/**
 * Build llms.txt candidates scoped to the requested URL, deepest scope first.
 *
 * The federated product docs publish an index per language at
 * `<locale>/llms.txt` alongside the one at the repo root, so walking outwards
 * from the deepest path scope is what lets a request for `/mcn/ja/demo/` find
 * the Japanese index before falling back to `/mcn/llms.txt`. Reversing the walk,
 * or capping it at the repository segment, would send every non-default-locale
 * request back to default-locale context.
 */
export function buildLlmEndpointCandidates(url: string): string[] {
	try {
		const parsed = new URL(url);
		if (parsed.pathname === "/") {
			return [`${parsed.origin}/.well-known/llms.txt`, `${parsed.origin}/llms.txt`, `${parsed.origin}/llms.md`];
		}

		const trimmedPath = parsed.pathname.replace(/\/+$/, "");
		const segments = trimmedPath.split("/").filter(Boolean);
		const scopeDepth = parsed.pathname.endsWith("/") ? segments.length : Math.max(segments.length - 1, 1);
		const endpoints: string[] = [];

		for (let depth = scopeDepth; depth >= 1; depth--) {
			const scope = `/${segments.slice(0, depth).join("/")}/`;
			endpoints.push(`${parsed.origin}${scope}llms.txt`, `${parsed.origin}${scope}llms.md`);
		}

		return endpoints;
	} catch {
		return [];
	}
}
