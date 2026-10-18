import { useEffect, useMemo, useRef } from "react";
import { installCodePanels, renderCodePanel } from "../markdown/code-presentation.generated.min.js";

/** Plain tool output stays plain unless its host supplies explicit language metadata. */
export function CodePanel({
	source,
	language,
	complete = true,
}: {
	source: string;
	language?: string;
	complete?: boolean;
}) {
	const root = useRef<HTMLDivElement>(null);
	const html = useMemo(() => renderCodePanel(source, language, complete), [source, language, complete]);
	useEffect(() => {
		if (!html || !root.current) return;
		return installCodePanels(root.current);
	}, [html]);
	return (
		// biome-ignore lint/security/noDangerouslySetInnerHtml: renderCodePanel escapes all source and emits only known code markup.
		<div ref={root} className="markdown-root" dangerouslySetInnerHTML={{ __html: html }} />
	);
}
