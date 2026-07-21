/**
 * The composer's slash-command menu — a "/" trigger button + popup of
 * host-provided {@link SlashCommand}s. Self-contained like {@link AttachMenu}:
 * it renders the trigger and the menu; picking an item fires `onSelect(command)`
 * and closes. The host submits the returned command string as the prompt.
 * Keyboard/focus a11y comes from {@link useMenu}.
 */
import type { SlashCommand } from "../types";
import { useMenu } from "./useMenu";

export interface SlashCommandMenuProps {
	commands: SlashCommand[];
	onSelect: (command: string) => void;
	disabled?: boolean;
}

export function SlashCommandMenu({ commands, onSelect, disabled }: SlashCommandMenuProps) {
	const { open, setOpen, toggle, menuRef, triggerRef } = useMenu();
	return (
		<div className="slash-menu" style={{ position: "relative" }}>
			{open && (
				<div className="menu menu-up menu-left" role="menu" ref={menuRef}>
					{commands.length === 0 ? (
						<div className="menu-header">No commands</div>
					) : (
						commands.map(c => (
							<button
								key={c.command}
								type="button"
								role="menuitem"
								className="menu-item"
								onClick={() => {
									onSelect(c.command);
									setOpen(false);
								}}
							>
								<span className="menu-item-command">{c.command}</span>
								<span>{c.label}</span>
								{c.description && <span className="menu-item-desc">{c.description}</span>}
							</button>
						))
					)}
				</div>
			)}
			<button
				ref={triggerRef}
				type="button"
				className="footer-btn slash-btn"
				title="Slash commands"
				aria-label="Slash commands"
				aria-haspopup="menu"
				aria-expanded={open}
				disabled={disabled}
				onClick={toggle}
			>
				/
			</button>
		</div>
	);
}
