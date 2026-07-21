/**
 * Full-panel "getting ready" overlay: a live readiness-gate checklist with
 * per-gate elapsed ms. Promoted from the Chrome side-panel and made headless —
 * the host maps its own activation state into {@link ActivationGate}[] (each
 * with a computed `label`), and passes `blocked` + `onRetry` for a hard stall.
 * The active gate's elapsed time counts up from `startedAt` on a 100ms tick.
 */
import { useEffect, useState } from "react";
import type { ActivationGate, GateStatus } from "../types";

const ICON: Record<GateStatus, string> = { pending: "○", active: "●", passed: "✓", stalled: "⚠" };

export interface ActivationOverlayProps {
	gates: ActivationGate[];
	title?: string;
	blocked?: boolean;
	onRetry?: () => void;
}

export function ActivationOverlay({ gates, title = "getting ready…", blocked, onRetry }: ActivationOverlayProps) {
	const [, force] = useState(0);
	useEffect(() => {
		const id = setInterval(() => force(n => n + 1), 100);
		return () => clearInterval(id);
	}, []);

	return (
		<div className="activation-overlay" role="status" aria-live="polite">
			<div className="spin ov-spinner" aria-hidden="true">
				✻
			</div>
			<div className="ov-title">{title}</div>
			<ul className="ov-gates">
				{gates.map(g => {
					const ms =
						g.status === "passed" || g.status === "stalled"
							? `${g.ms ?? 0} ms`
							: g.status === "active" && g.startedAt != null
								? `${Math.max(0, Date.now() - g.startedAt)} ms`
								: "—";
					return (
						<li key={g.name} className={`ov-gate ov-${g.status}`}>
							<span className="ov-ico" aria-hidden="true">
								{ICON[g.status]}
							</span>
							<span className="ov-label">{g.label}</span>
							<span className="ov-ms">{ms}</span>
						</li>
					);
				})}
			</ul>
			{blocked && onRetry ? (
				<button type="button" className="ov-retry" onClick={onRetry}>
					Retry
				</button>
			) : null}
		</div>
	);
}
