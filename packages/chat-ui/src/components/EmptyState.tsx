/**
 * The welcome / empty-conversation screen (unifies the VS Code welcome box with
 * Claude-for-Office skill pills, in our terminal aesthetic). Shows the F5 logo, a
 * heading, and a row of clickable slash-command / skill pills. Pills + heading +
 * logo are props — headless. Picking a pill fires `onPick(id)`.
 */
import { F5Logo } from "../theme/F5Logo";
import type { ReactNode, SkillPill } from "../types";

export interface EmptyStateProps {
	pills: SkillPill[];
	onPick: (id: string) => void;
	heading?: string;
	/**
	 * Logo shown above the heading. Omit for the default ASCII F5 logo, pass a
	 * node to override it, or pass `false` to render NO logo — e.g. when a
	 * persistent header already carries the brand (avoids a duplicate F5 logo).
	 */
	logo?: ReactNode | false;
	/**
	 * Lay the pills out as a vertical list instead of a wrapping centred row — the
	 * Claude-for-Office shape for slash-command starters, where each pill is a
	 * command rather than a short phrase. Opt-in, so other surfaces are unchanged.
	 */
	stacked?: boolean;
}

export function EmptyState({
	pills,
	onPick,
	heading = "Get started with these skills:",
	logo,
	stacked = false,
}: EmptyStateProps) {
	// `undefined` → default logo; `false` → no logo; any node → that node.
	const logoNode = logo === undefined ? <F5Logo variant="ascii" /> : logo;
	return (
		<div className="empty-state">
			{logoNode ? <div className="empty-logo">{logoNode}</div> : null}
			{pills.length > 0 && (
				<>
					<div className="empty-heading">{heading}</div>
					<div className={stacked ? "pills pills-stacked" : "pills"}>
						{pills.map(p => (
							<button key={p.id} type="button" className="pill" title={p.hint} onClick={() => onPick(p.id)}>
								{p.label}
							</button>
						))}
					</div>
				</>
			)}
		</div>
	);
}
