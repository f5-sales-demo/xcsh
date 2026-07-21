import { expect, test } from "bun:test";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Composer } from "../src/components/Composer";
import { ModeToggle } from "../src/components/ModeToggle";
import { SlashCommandMenu } from "../src/components/SlashCommandMenu";
import { ToolsPickerMenu } from "../src/components/ToolsPickerMenu";
import type { AttachCategory, InteractionMode, SlashCommand, ToolItem } from "../src/types";

const COMMANDS: SlashCommand[] = [
	{ command: "/status", label: "Status", description: "Show integration health" },
	{ command: "/context", label: "Context" },
];
const TOOLS: ToolItem[] = [
	{ name: "vscode_read_file", label: "Read file", description: "Read a workspace file" },
	{ name: "vscode_get_selection", label: "Get selection" },
];
const CATS: AttachCategory[] = [
	{ id: "files", label: "Files" },
	{ id: "tools", label: "Tools" },
];

test("SlashCommandMenu: '/' trigger opens the menu and onSelect fires the command", () => {
	let picked = "";
	render(<SlashCommandMenu commands={COMMANDS} onSelect={c => (picked = c)} />);
	act(() => {
		fireEvent.click(screen.getByRole("button", { name: /slash commands/i }));
	});
	expect(screen.getByRole("menu")).toBeDefined();
	fireEvent.click(screen.getByRole("menuitem", { name: /status/i }));
	expect(picked).toBe("/status");
	expect(screen.queryByRole("menu")).toBeNull(); // closes after select
});

test("ToolsPickerMenu: multi-select, confirm disabled until a tool is chosen, then fires names", () => {
	let confirmed: string[] = [];
	render(<ToolsPickerMenu tools={TOOLS} onConfirm={n => (confirmed = n)} onClose={() => {}} />);
	const confirm = screen.getByRole("button", { name: /attach \(0\)/i }) as HTMLButtonElement;
	expect(confirm.disabled).toBe(true);
	fireEvent.click(screen.getByRole("button", { name: /read file/i }));
	fireEvent.click(screen.getByRole("button", { name: /get selection/i }));
	const confirm2 = screen.getByRole("button", { name: /attach \(2\)/i }) as HTMLButtonElement;
	expect(confirm2.disabled).toBe(false);
	fireEvent.click(confirm2);
	expect(confirmed).toEqual(["vscode_read_file", "vscode_get_selection"]);
});

test("ToolsPickerMenu: empty tools shows the empty note", () => {
	render(<ToolsPickerMenu tools={[]} onConfirm={() => {}} onClose={() => {}} />);
	expect(screen.getByText(/no tools available/i)).toBeDefined();
});

test("Composer: slashCommands render the '/' menu; selecting fires onSlashSelect", () => {
	let picked = "";
	render(
		<Composer
			streaming={false}
			onSend={() => {}}
			onStop={() => {}}
			slashCommands={COMMANDS}
			onSlashSelect={c => (picked = c)}
		/>,
	);
	act(() => {
		fireEvent.click(screen.getByRole("button", { name: /slash commands/i }));
	});
	fireEvent.click(screen.getByRole("menuitem", { name: /context/i }));
	expect(picked).toBe("/context");
});

test("Composer: picking the 'tools' category opens the tools picker (not onRequestAttachment)", () => {
	let requested = "";
	let confirmed: string[] = [];
	render(
		<Composer
			streaming={false}
			onSend={() => {}}
			onStop={() => {}}
			attachCategories={CATS}
			onRequestAttachment={id => (requested = id)}
			tools={TOOLS}
			onToolsConfirm={n => (confirmed = n)}
		/>,
	);
	act(() => {
		fireEvent.click(screen.getByRole("button", { name: /add context/i }));
	});
	fireEvent.click(screen.getByRole("menuitem", { name: /tools/i }));
	// The tools category opened the multi-select picker rather than round-tripping.
	expect(requested).toBe("");
	fireEvent.click(screen.getByRole("button", { name: /read file/i }));
	fireEvent.click(screen.getByRole("button", { name: /attach \(1\)/i }));
	expect(confirmed).toEqual(["vscode_read_file"]);
});

test("Composer: a non-tools category still round-trips via onRequestAttachment", () => {
	let requested = "";
	render(
		<Composer
			streaming={false}
			onSend={() => {}}
			onStop={() => {}}
			attachCategories={CATS}
			onRequestAttachment={id => (requested = id)}
			tools={TOOLS}
			onToolsConfirm={() => {}}
		/>,
	);
	act(() => {
		fireEvent.click(screen.getByRole("button", { name: /add context/i }));
	});
	fireEvent.click(screen.getByRole("menuitem", { name: /files/i }));
	expect(requested).toBe("files");
});

test("ModeToggle: thinking-level control renders in the menu and fires onThinkingChange", () => {
	const modes: InteractionMode[] = [
		{ id: "auto", label: "Auto" },
		{ id: "confirm", label: "Confirm" },
	];
	let level = "";
	render(
		<ModeToggle
			modes={modes}
			mode="auto"
			onChange={() => {}}
			thinkingLevels={["low", "medium", "high"]}
			thinkingLevel="medium"
			onThinkingChange={l => (level = l)}
		/>,
	);
	act(() => {
		// The mode trigger's accessible name is the current mode label.
		fireEvent.click(screen.getByRole("button", { name: "Auto" }));
	});
	expect(screen.getByText(/thinking level/i)).toBeDefined();
	fireEvent.click(screen.getByRole("button", { name: /^high$/i }));
	expect(level).toBe("high");
});

test("Composer: no slash/tools UI when the new props are absent (office/chrome unaffected)", () => {
	const { container } = render(<Composer streaming={false} onSend={() => {}} onStop={() => {}} />);
	expect(screen.queryByRole("button", { name: /slash commands/i })).toBeNull();
	expect(container.querySelector(".tools-picker")).toBeNull();
});
