import { expect, test } from "bun:test";
import { presentation } from "../src/extensibility/presentation";

test("command declarations retain an independent argv copy for render-time layout", () => {
	const argv = ["fixture", "", "literal\ntext"];
	const section = presentation.command(argv, "Command");
	argv[1] = "changed";
	expect(section.argv).toEqual(["fixture", "", "literal\ntext"]);
	expect(section.title).toBe("Command");
});
