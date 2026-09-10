import { expect, test } from "bun:test";
import { BUILTIN_SLASH_COMMAND_DEFS } from "../../src/slash-commands/builtin-registry";

test("remote status has a native slash command", () => {
	expect(BUILTIN_SLASH_COMMAND_DEFS.find(command => command.name === "remote")).toMatchObject({ name: "remote" });
});
