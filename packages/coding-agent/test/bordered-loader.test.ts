import { beforeAll, expect, it, vi } from "bun:test";
import type { TUI } from "@f5-sales-demo/pi-tui";
import { BorderedLoader } from "../src/modes/components/bordered-loader";
import { getThemeByName, setThemeInstance, theme } from "../src/modes/theme/theme";

beforeAll(async () => {
	const selected = await getThemeByName("xcsh-dark");
	if (!selected) throw new Error("Missing test theme");
	setThemeInstance(selected);
});

it("non-cancellable publication loaders keep tracking work on Escape and Ctrl+C", () => {
	const loader = new BorderedLoader({ requestRender() {} } as TUI, theme, "Publishing", false);
	const aborted = vi.fn();
	loader.onAbort = aborted;
	try {
		loader.handleInput("\x1b");
		loader.handleInput("\x03");
		expect(loader.signal.aborted).toBe(false);
		expect(aborted).not.toHaveBeenCalled();
		const rendered = Bun.stripANSI(loader.render(80).join("\n"));
		expect(rendered).toContain("cannot be interrupted");
		expect(rendered).toContain("Publishing");
	} finally {
		loader.dispose();
	}
});
