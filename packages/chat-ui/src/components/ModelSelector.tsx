/**
 * Model selector for the composer footer (NEW). A footer pill showing the
 * current model (truncated, e.g. "claude-opus-4-8") that opens a popup menu of
 * the host-provided model list. Fully headless: current model + list + onSelect
 * are props — this component knows nothing about how models are discovered.
 */
import { useCallback, useState } from "react";
import type { ModelOption } from "../types";
import { useAutoClose } from "./useAutoClose";

export interface ModelSelectorProps {
	model: string;
	models: ModelOption[];
	onSelect: (id: string) => void;
	disabled?: boolean;
}

export function ModelSelector({ model, models, onSelect, disabled }: ModelSelectorProps) {
	const [open, setOpen] = useState(false);
	const close = useCallback(() => setOpen(false), []);
	useAutoClose(open, close);

	const current = models.find(m => m.id === model);
	const label = current?.label ?? model;

	return (
		<div className="model-selector" style={{ position: "relative" }}>
			{open && (
				<div className="menu menu-up menu-right" role="menu">
					{models.map(m => (
						<button
							key={m.id}
							type="button"
							role="menuitem"
							className={`menu-item ${m.id === model ? "selected" : ""}`}
							onClick={() => {
								onSelect(m.id);
								setOpen(false);
							}}
						>
							<span>{m.label}</span>
						</button>
					))}
				</div>
			)}
			<button
				type="button"
				className="footer-btn model-btn"
				title={`model: ${label}`}
				aria-label={`model: ${label}`}
				aria-haspopup="menu"
				aria-expanded={open}
				disabled={disabled}
				onClick={e => {
					e.stopPropagation();
					setOpen(o => !o);
				}}
			>
				<span className="model-label">{label}</span>
			</button>
		</div>
	);
}
