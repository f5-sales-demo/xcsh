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
	/**
	 * Optional thinking-level control (VS Code parity). When all three are
	 * provided, the menu shows a divider + a segmented level control below the
	 * mode list. Office/Chrome omit these and get just the mode list.
	 */
	thinkingLevels?: string[];
	thinkingLevel?: string;
	onThinkingChange?: (level: string) => void;
}

export function ModeToggle({
	modes,
	mode,
	onChange,
	thinkingLevels,
	thinkingLevel,
	onThinkingChange,
}: ModeToggleProps) {
	const { open, setOpen, toggle, menuRef, triggerRef } = useMenu();

	const current = modes.find(m => m.id === mode);
	const showThinking = thinkingLevels != null && thinkingLevel != null && onThinkingChange != null;

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
					{showThinking && (
						<div className="thinking-section">
							<div className="menu-divider" />
							<span className="thinking-label">Thinking level</span>
							<div className="thinking-levels">
								{thinkingLevels.map(level => (
									<button
										key={level}
										type="button"
										className={`thinking-level-btn ${level === thinkingLevel ? "active" : ""}`}
										onClick={() => onThinkingChange(level)}
									>
										{level}
									</button>
								))}
							</div>
						</div>
					)}
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
