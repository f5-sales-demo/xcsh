/**
 * Golden-HTML normalizer, shared by the generator (`scripts/gen-md-goldens.ts`)
 * and the Layer-1 fidelity test so both agree byte-for-byte.
 *
 * The renderer pipeline is deterministic, but DOMPurify's re-serialization can
 * vary attribute ORDER (marked emits `href title target rel`; the sanitizer's
 * hooks re-set `target`/`rel`). Sorting each start tag's attributes alphabetically
 * makes the golden stable and portable without touching text content (crucially,
 * `<pre>`/`<code>` whitespace is preserved exactly).
 */

/** Alphabetically sort the attributes of every start tag; leave everything else. */
export function normalizeHtml(html: string): string {
	const withSortedAttrs = html.replace(
		/<([a-zA-Z][a-zA-Z0-9]*)((?:\s+[a-zA-Z][\w-]*(?:="[^"]*")?)+)\s*(\/?)>/g,
		(_full, name: string, attrs: string, slash: string) => {
			const pairs = attrs.match(/[a-zA-Z][\w-]*(?:="[^"]*")?/g);
			if (!pairs) return `<${name}${slash ? " /" : ""}>`;
			const sorted = [...pairs].sort((a, b) => {
				const ka = a.split("=")[0];
				const kb = b.split("=")[0];
				return ka < kb ? -1 : ka > kb ? 1 : 0;
			});
			return `<${name} ${sorted.join(" ")}${slash ? " /" : ""}>`;
		},
	);
	return `${withSortedAttrs.trim()}\n`;
}
