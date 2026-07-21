/**
 * The conversation-mode toggle for the composer footer. Unifies the VS Code
 * ModesMenu popup with the Chrome mode `<select>`: a footer pill showing the
 * current mode that opens a popup menu of the host-provided mode list. The mode
 * list is a prop (INTERACTION_MODES lives per-host) — this component is headless.
 * Keyboard-accessible menu behavior comes from {@link useMenu}.
 */
import type { InteractionMode } from "../types";
import { useMenu } from "./useMenu";

export interface ModeToggleProps {
	modes: InteractionMode[];
	mode: string;
	onChange: (id: string) => void;
}

export function ModeToggle({ modes, mode, onChange }: ModeToggleProps) {
	const { open, setOpen, toggle, menuRef, triggerRef } = useMenu();

	const current = modes.find(m => m.id === mode);

	return (
		<div className="mode-toggle" style={{ position: "relative" }}>
			{open && (
				<div className="menu menu-up menu-left" role="menu" ref={menuRef}>
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
				ref={triggerRef}
				type="button"
				className="footer-btn mode-btn"
				title="conversation mode"
				aria-haspopup="menu"
				aria-expanded={open}
				onClick={toggle}
			>
				{current?.label ?? mode}
			</button>
		</div>
	);
}
