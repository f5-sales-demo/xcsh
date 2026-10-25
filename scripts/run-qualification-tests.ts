import { join } from "node:path";

export async function runQualificationTests(): Promise<number> {
	const root = new URL("..", import.meta.url).pathname;
	const directory = join(root, "node_modules/.cache/qualification-tests");
	const python = join(directory, process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
	const commands = [
		["python3", "-m", "venv", directory],
		[python, "-m", "pip", "install", "--disable-pip-version-check", "-r", join(root, "scripts/qualification-cleanroom/requirements-test.txt")],
		[python, "-m", "unittest", "-v",
			"tests.qualification_cleanroom.test_capture_finalization",
			"tests.qualification_cleanroom.test_nonce_origin",
			"tests.qualification_cleanroom.test_runner",
			"tests.qualification_cleanroom.test_startup_evidence",
			"tests.qualification_cleanroom.test_voice_ab",
			"tests.qualification_cleanroom.test_qualification_exec"],
	];
	for (const command of commands) {
		const child = Bun.spawn(command, { cwd: root, stdin: "ignore", stdout: "inherit", stderr: "inherit" });
		const result = await child.exited;
		if (result !== 0) return result;
	}
	return 0;
}

if (import.meta.main) process.exit(await runQualificationTests());
