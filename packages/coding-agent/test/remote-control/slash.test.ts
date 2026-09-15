import { expect, test } from "bun:test";
import { resolveRemoteThreadId } from "../../src/remote-control/thread-identity";
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

test("remote enable saves the stable phone thread identity as primary", () => {
	expect(
		resolveRemoteThreadId({
			sessionId: "local-execution-session",
			sessionManager: { getHeader: () => ({ remoteThreadId: "phone-thread" }) },
		}),
	).toBe("phone-thread");
	expect(
		resolveRemoteThreadId({
			sessionId: "local-execution-session",
			sessionManager: { getHeader: () => ({ remoteThreadId: "/invalid/thread" }) },
		}),
	).toBe("local-execution-session");
	expect(
		resolveRemoteThreadId({ sessionId: "local-execution-session", sessionManager: { getHeader: () => null } }),
	).toBe("local-execution-session");
});
