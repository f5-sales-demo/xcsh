/**
 * Multi-select popover for the composer's "tools" attach category. Lists the
 * host-provided {@link ToolItem}s; the user toggles a subset and confirms, firing
 * `onConfirm(names)` so the host can build a tools attachment. Rendered by the
 * {@link Composer} when the `tools` category is picked (controlled open state);
 * `onClose` dismisses without attaching.
 */
import { useState } from "react";
import type { ToolItem } from "../types";

export interface ToolsPickerMenuProps {
	tools: ToolItem[];
	onConfirm: (names: string[]) => void;
	onClose: () => void;
}

export function ToolsPickerMenu({ tools, onConfirm, onClose }: ToolsPickerMenuProps) {
	const [selected, setSelected] = useState<Set<string>>(new Set());

	const toggle = (name: string): void => {
		setSelected(prev => {
			const next = new Set(prev);
			if (next.has(name)) {
				next.delete(name);
			} else {
				next.add(name);
			}
			return next;
		});
	};

	return (
		<div className="menu menu-up menu-left tools-picker" role="menu">
			{tools.length === 0 ? (
				<div className="menu-header">No tools available</div>
			) : (
				<>
					{tools.map(tool => {
						const isSelected = selected.has(tool.name);
						return (
							<button
								key={tool.name}
								type="button"
								className={`menu-item tool-item${isSelected ? " selected" : ""}`}
								aria-pressed={isSelected}
								onClick={() => toggle(tool.name)}
							>
								<span className="tool-item-indicator" aria-hidden="true">
									{isSelected ? "✓" : "○"}
								</span>
								<span>{tool.label}</span>
								{tool.description && <span className="menu-item-desc">{tool.description}</span>}
							</button>
						);
					})}
					<button
						type="button"
						className="tools-picker-confirm"
						disabled={selected.size === 0}
						onClick={() => {
							onConfirm(Array.from(selected));
							onClose();
						}}
					>
						Attach ({selected.size})
					</button>
				</>
			)}
		</div>
	);
}
