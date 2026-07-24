/**
 * Single-select popover for the composer's "skills" attach category — the Skills
 * submenu (Claude-for-Office parity). Lists the host-provided {@link SkillMenuItem}s
 * (the engine's loaded skills); picking one fires `onSelect(name)` and closes.
 * Rendered by the {@link Composer} when the `skills` category is picked (controlled
 * open state, mirroring {@link ToolsPickerMenu}); `onClose` dismisses.
 */
import type { SkillMenuItem } from "../types";

export interface SkillsMenuProps {
	skills: SkillMenuItem[];
	onSelect: (name: string) => void;
	onClose: () => void;
}

export function SkillsMenu({ skills, onSelect, onClose }: SkillsMenuProps) {
	return (
		<div className="menu menu-up menu-left skills-menu" role="menu">
			{skills.length === 0 ? (
				<div className="menu-header">No skills available</div>
			) : (
				skills.map(skill => (
					<button
						key={skill.name}
						type="button"
						role="menuitem"
						className="menu-item"
						onClick={() => {
							onSelect(skill.name);
							onClose();
						}}
					>
						<span className="menu-item-command">/{skill.name}</span>
						{skill.description && <span className="menu-item-desc">{skill.description}</span>}
					</button>
				))
			)}
		</div>
	);
}
