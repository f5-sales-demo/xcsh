import { expect, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { Composer, type ComposerHandle } from "../src/components/Composer";
import { EmptyState } from "../src/components/EmptyState";
import type { SkillPill } from "../src/types";

// Integration harness: a host wires an EmptyState skill pill to PREFILL the
// composer (for editing) via the imperative ComposerHandle ref — the
// Claude-parity behavior where a pill/slash-command populates the input rather
// than sending immediately.
const PILLS: SkillPill[] = [{ id: "waap", label: "WAAP full stack" }];
const TEXT_BY_ID: Record<string, string> = { waap: "/skill waap-full-stack-demo" };

function Harness({ onSend }: { onSend: (t: string) => void }) {
	const ref = useRef<ComposerHandle>(null);
	return (
		<div>
			<EmptyState pills={PILLS} onPick={id => ref.current?.setText(TEXT_BY_ID[id])} />
			<Composer ref={ref} streaming={false} onSend={onSend} onStop={() => {}} />
		</div>
	);
}

test("picking a skill pill populates the composer input without sending", () => {
	let sent = "";
	render(<Harness onSend={t => (sent = t)} />);

	fireEvent.click(screen.getByRole("button", { name: /WAAP full stack/ }));

	const editor = screen.getByRole("textbox");
	expect(editor.textContent).toBe("/skill waap-full-stack-demo");
	// Populated, not sent.
	expect(sent).toBe("");
	// And send is now enabled (there is text to send when the user chooses to).
	expect((screen.getByRole("button", { name: /send/i }) as HTMLButtonElement).disabled).toBe(false);
});

test("the imperative focus() handle focuses the editor", () => {
	function FocusHarness() {
		const ref = useRef<ComposerHandle>(null);
		return (
			<div>
				<button type="button" onClick={() => ref.current?.focus()}>
					focus it
				</button>
				<Composer ref={ref} streaming={false} onSend={() => {}} onStop={() => {}} />
			</div>
		);
	}
	render(<FocusHarness />);
	fireEvent.click(screen.getByRole("button", { name: /focus it/i }));
	expect(document.activeElement).toBe(screen.getByRole("textbox"));
});
