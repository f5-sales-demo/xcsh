/**
 * The conversation-mode toggle for the composer footer. Unifies the VS Code
 * ModesMenu popup with the Chrome mode `<select>`: a footer pill showing the
 * current mode that opens a popup menu of the host-provided mode list. The mode
 * list is a prop (INTERACTION_MODES lives per-host) — this component is headless.
 */
import { useCallback, useState } from "react";
import type { InteractionMode } from "../types";
import { useAutoClose } from "./useAutoClose";

export interface ModeToggleProps {
	modes: InteractionMode[];
	mode: string;
	onChange: (id: string) => void;
}

export function ModeToggle({ modes, mode, onChange }: ModeToggleProps) {
	const [open, setOpen] = useState(false);
	const close = useCallback(() => setOpen(false), []);
	useAutoClose(open, close);

	const current = modes.find(m => m.id === mode);

	return (
		<div className="mode-toggle" style={{ position: "relative" }}>
			{open && (
				<div className="menu menu-up menu-left" role="menu">
					{modes.map(m => (
						<button
							key={m.id}
							type="button"
							role="menuitem"
							className={`menu-item ${m.id === mode ? "selected" : ""}`}
							onClick={() => {
								onChange(m.id);
								setOpen(false);
							}}
						>
							<span>{m.label}</span>
							{m.blurb && <span className="menu-item-desc">{m.blurb}</span>}
						</button>
					))}
				</div>
			)}
			<button
				type="button"
				className="footer-btn mode-btn"
				title="conversation mode"
				aria-haspopup="menu"
				aria-expanded={open}
				onClick={e => {
					e.stopPropagation();
					setOpen(o => !o);
				}}
			>
				{current?.label ?? mode}
			</button>
		</div>
	);
}
