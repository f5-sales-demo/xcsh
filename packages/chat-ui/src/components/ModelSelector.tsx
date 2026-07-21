/**
 * Model selector for the composer footer (NEW). A footer pill showing the
 * current model (truncated, e.g. "claude-opus-4-8") that opens a popup menu of
 * the host-provided model list. Fully headless: current model + list + onSelect
 * are props — this component knows nothing about how models are discovered.
 * Keyboard-accessible menu behavior comes from {@link useMenu}.
 */
import type { ModelOption } from "../types";
import { useMenu } from "./useMenu";

export interface ModelSelectorProps {
	model: string;
	models: ModelOption[];
	onSelect: (id: string) => void;
	disabled?: boolean;
}

export function ModelSelector({ model, models, onSelect, disabled }: ModelSelectorProps) {
	const { open, setOpen, toggle, menuRef, triggerRef } = useMenu();

	const current = models.find(m => m.id === model);
	const label = current?.label ?? model;

	return (
		<div className="model-selector" style={{ position: "relative" }}>
			{open && (
				<div className="menu menu-up menu-right" role="menu" ref={menuRef}>
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
				ref={triggerRef}
				type="button"
				className="footer-btn model-btn"
				title={`model: ${label}`}
				aria-label={`model: ${label}`}
				aria-haspopup="menu"
				aria-expanded={open}
				disabled={disabled}
				onClick={toggle}
			>
				<span className="model-label">{label}</span>
			</button>
		</div>
	);
}
