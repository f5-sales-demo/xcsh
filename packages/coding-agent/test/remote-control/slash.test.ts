import { expect, test } from "bun:test";
import { BUILTIN_SLASH_COMMAND_DEFS } from "../../src/slash-commands/builtin-registry";

test("remote status has a native slash command", () => {
	const command = BUILTIN_SLASH_COMMAND_DEFS.find(command => command.name === "remote");
	expect(command).toMatchObject({ name: "remote", description: "Show native xcsh remote host status" });
});
