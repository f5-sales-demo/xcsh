import { expect, spyOn, test } from "bun:test";
import { Command, run } from "../src/cli";

class Fixture extends Command {
	static description = "Fixture command help";
	async run() {
		throw new Error("Help must not execute the command");
	}
}

test.each(["fixture", "alias"].flatMap(name => ["--help", "-h"].map(flag => ({ name, flag }))))(
	"$name $flag loads only the selected command",
	async ({ name, flag }) => {
		const output: string[] = [];
		const stdout = spyOn(process.stdout, "write").mockImplementation((text: any) => {
			output.push(String(text));
			return true;
		});
		const loads: string[] = [];
		try {
			await run({
				bin: "xcsh",
				version: "fixture",
				argv: [name, flag],
				commands: [
					{
						name: "fixture",
						aliases: ["alias"],
						load: async () => {
							loads.push("fixture");
							return Fixture;
						},
					},
					{
						name: "unrelated",
						load: async () => {
							throw new Error("Unrelated command dependency must remain unloaded");
						},
					},
				],
			});
			expect(loads).toEqual(["fixture"]);
			expect(output.join("")).toContain("Fixture command help");
			expect(output.join("")).toContain("xcsh fixture");
		} finally {
			stdout.mockRestore();
		}
	},
);

test("unknown command help reports the unknown name without loading commands", async () => {
	const output: string[] = [];
	const stderr = spyOn(process.stderr, "write").mockImplementation((text: any) => {
		output.push(String(text));
		return true;
	});
	try {
		await run({
			bin: "xcsh",
			version: "fixture",
			argv: ["unknown", "--help"],
			commands: [
				{
					name: "fixture",
					load: async () => {
						throw new Error("Unknown command help must not load commands");
					},
				},
			],
		});
		expect(output.join("")).toBe("Unknown command: unknown\n");
	} finally {
		stderr.mockRestore();
	}
});

test("root help still receives all registered command definitions", async () => {
	let names: string[] = [];
	await run({
		bin: "xcsh",
		version: "fixture",
		argv: ["--help"],
		commands: [
			{ name: "first", load: async () => Fixture },
			{ name: "second", load: async () => Fixture },
		],
		help: config => {
			names = [...config.commands.keys()];
		},
	});
	expect(names).toEqual(["first", "second"]);
});
