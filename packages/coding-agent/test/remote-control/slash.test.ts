import { expect, test } from "bun:test";
import { BUILTIN_SLASH_COMMAND_DEFS } from "../../src/slash-commands/builtin-registry";

test("remote slash command exposes the full standalone lifecycle", () => {
	const command = BUILTIN_SLASH_COMMAND_DEFS.find(command => command.name === "remote");
	expect(command).toMatchObject({
		name: "remote",
		description: "Manage the native xcsh remote connection",
	});
	expect(command?.subcommands?.map(subcommand => subcommand.name)).toEqual([
		"status",
		"enable",
		"restart",
		"disable",
		"pair",
		"clients",
		"revoke",
	]);
	expect(command?.subcommands?.find(subcommand => subcommand.name === "revoke")).toMatchObject({
		usage: "<client-id>",
	});
});
