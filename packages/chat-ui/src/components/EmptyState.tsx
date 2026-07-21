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
	/** Overrides the default ASCII F5 logo. */
	logo?: ReactNode;
}

export function EmptyState({ pills, onPick, heading = "Get started with these skills:", logo }: EmptyStateProps) {
	return (
		<div className="empty-state">
			<div className="empty-logo">{logo ?? <F5Logo variant="ascii" />}</div>
			{pills.length > 0 && (
				<>
					<div className="empty-heading">{heading}</div>
					<div className="pills">
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
