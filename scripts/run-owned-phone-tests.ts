import { join } from "node:path";

/** Run the preserved adapter regressions without host credentials or host packages. */
export async function runOwnedPhoneTests(): Promise<number> {
	const root = new URL("..", import.meta.url).pathname;
	const adapter = join(root, "scripts/qualification-cleanroom/owned-phone-client");
	const environment = join(root, "node_modules/.cache/owned-phone-tests");
	const python = join(environment, process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
	const commands = [
		["python3", "-m", "venv", environment],
		[python, "-m", "pip", "install", "--disable-pip-version-check", "-r", join(adapter, "requirements-test.txt")],
		[python, "-m", "unittest", "tests.qualification_cleanroom.test_owned_phone_client", "-v"],
		["bun", "build", join(adapter, "app.js"), "--target=browser", `--outfile=${join(environment, "app.js")}`],
	];
	for (const command of commands) {
		const child = Bun.spawn(command, {
			cwd: root,
			stdin: "ignore",
			stdout: "inherit",
			stderr: "inherit",
		});
		const result = await child.exited;
		if (result !== 0) return result;
	}
	return 0;
}

if (import.meta.main) process.exit(await runOwnedPhoneTests());
