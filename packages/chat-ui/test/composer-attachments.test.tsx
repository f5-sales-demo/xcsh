import { expect, test } from "bun:test";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { Attachment } from "../src/attachments/model";
import { AttachMenu } from "../src/components/AttachMenu";
import { Composer } from "../src/components/Composer";
import type { AttachCategory } from "../src/types";

const CATEGORIES: AttachCategory[] = [
	{ id: "files", label: "Files & Folders", description: "Attach workspace files" },
	{ id: "problems", label: "Problems" },
];

function att(id: string, over: Partial<Attachment> = {}): Attachment {
	return { id, kind: "file", label: `f${id}.ts`, dedupKey: `file:${id}`, content: `C${id}`, path: `f${id}.ts`, ...over } as Attachment;
}

test("AttachMenu opens on the + button and fires onSelect(id) with the category", () => {
	let picked = "";
	render(<AttachMenu categories={CATEGORIES} onSelect={id => (picked = id)} />);
	act(() => {
		fireEvent.click(screen.getByRole("button", { name: /add context/i }));
	});
	expect(screen.getByRole("menu")).toBeDefined();
	fireEvent.click(screen.getByRole("menuitem", { name: /files & folders/i }));
	expect(picked).toBe("files");
	// menu closes after selection
	expect(screen.queryByRole("menu")).toBeNull();
});

test("Composer renders attachment chips and removes one via onRemoveAttachment", () => {
	let removed = "";
	const attachments = [att("1"), att("2")];
	render(
		<Composer
			streaming={false}
			onSend={() => {}}
			onStop={() => {}}
			attachments={attachments}
			onRemoveAttachment={id => (removed = id)}
		/>,
	);
	expect(screen.getByText("f1.ts")).toBeDefined();
	expect(screen.getByText("f2.ts")).toBeDefined();
	fireEvent.click(screen.getByRole("button", { name: /remove f1\.ts/i }));
	expect(removed).toBe("1");
});

test("submit prepends serialized attachments to the message text", () => {
	let sent = "";
	render(
		<Composer streaming={false} onSend={t => (sent = t)} onStop={() => {}} attachments={[att("1", { label: "lb.ts", content: "cfg" })]} />,
	);
	const editor = screen.getByRole("textbox", { name: /message input/i });
	editor.textContent = "explain this";
	fireEvent.input(editor);
	fireEvent.submit(editor.closest("form") as HTMLFormElement);
	expect(sent).toBe("[File: lb.ts]\n\ncfg\n\nexplain this");
});

test("attachments-only (no typed text) can send, and sends just the prefix", () => {
	let sent = "";
	render(
		<Composer streaming={false} onSend={t => (sent = t)} onStop={() => {}} attachments={[att("1", { label: "a.ts", content: "X" })]} />,
	);
	// Send is enabled despite the empty editor.
	const send = screen.getByRole("button", { name: /send/i }) as HTMLButtonElement;
	expect(send.disabled).toBe(false);
	fireEvent.click(send);
	expect(sent).toBe("[File: a.ts]\n\nX");
});

test("the picker replaces the bare attach button when categories are provided", () => {
	const { rerender } = render(
		<Composer streaming={false} onSend={() => {}} onStop={() => {}} onAttach={() => {}} />,
	);
	// Bare attach button when only onAttach is given.
	expect(screen.getByRole("button", { name: /^attach$/i })).toBeDefined();

	rerender(
		<Composer
			streaming={false}
			onSend={() => {}}
			onStop={() => {}}
			onAttach={() => {}}
			attachCategories={CATEGORIES}
			onRequestAttachment={() => {}}
		/>,
	);
	// The category picker ("Add context") takes over; the bare "Attach" is gone.
	expect(screen.getByRole("button", { name: /add context/i })).toBeDefined();
	expect(screen.queryByRole("button", { name: /^attach$/i })).toBeNull();
});

test("no attachment UI at all when no attach props are given (office/chrome unaffected)", () => {
	const { container } = render(<Composer streaming={false} onSend={() => {}} onStop={() => {}} />);
	const scope = within(container);
	expect(scope.queryByRole("button", { name: /add context/i })).toBeNull();
	expect(scope.queryByRole("button", { name: /^attach$/i })).toBeNull();
	expect(container.querySelector(".attachment-chips")).toBeNull();
});
