/**
 * A dockable, dismissible context chip: a host-supplied selection label (e.g.
 * "Slide 1 selected", "app.tsx", "console: Load Balancers") with a connection
 * dot and dismiss (+ optional refresh) controls. Generalized from the Chrome
 * side-panel's page-context chip so any host can dock its current selection atop
 * the composer. Label + connection state + callbacks are props — headless.
 */
export interface ContextChipProps {
	label: string;
	onDismiss: () => void;
	connected?: boolean;
	onRefresh?: () => void;
	connectedTitle?: string;
	disconnectedTitle?: string;
}

export function ContextChip({
	label,
	onDismiss,
	connected,
	onRefresh,
	connectedTitle = "connected",
	disconnectedTitle = "offline",
}: ContextChipProps) {
	return (
		<div className="chip">
			<span className={`dot ${connected ? "on" : ""}`} title={connected ? connectedTitle : disconnectedTitle} />
			<span aria-hidden="true">▣</span>
			<span className="title">{label}</span>
			{onRefresh && (
				<button type="button" title="refresh context" aria-label="refresh context" onClick={onRefresh}>
					↻
				</button>
			)}
			<button type="button" title="dismiss context" aria-label="dismiss context" onClick={onDismiss}>
				✕
			</button>
		</div>
	);
}
