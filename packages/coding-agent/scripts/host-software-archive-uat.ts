import { readdir, readlink } from "node:fs/promises";
import { join } from "node:path";
import { installArchive } from "../src/host/archive";
import { findExecutable } from "../src/host/host";
import { software } from "../src/host/software";

const recipe = {
	id: "salesforce",
	executable: "sf",
	versionArgs: ["--version"],
	archive: {
		manifestUrl:
			"https://developer.salesforce.com/media/salesforce-cli/sf/channels/stable/sf-linux-{arch}-buildmanifest",
		baseDir: "sf",
		executable: "bin/sf",
	},
};
if (findExecutable("sf")) throw new Error("Isolated UAT unexpectedly found sf");
const result = await software.resolve(recipe);
await result.validate();
const step = result.steps[0];
if (step.kind !== "archive-install" || !step.archive) throw new Error("Expected official archive plan");
console.log(
	JSON.stringify({
		phase: "prepared",
		installer: result.installer,
		elevation: result.elevation,
		archive: step.archive,
	}),
);
await installArchive(step.archive);
const resolved = findExecutable("sf");
if (!resolved?.startsWith(process.env.HOME!)) throw new Error("per-user executable discovery failed");
const child = Bun.spawn([resolved, "--version"], { stdout: "pipe", stderr: "ignore" });
const version = await new Response(child.stdout).text();
if ((await child.exited) !== 0 || !version.includes(step.archive.version))
	throw new Error("installed sf version failed");
const reuse = await software.resolve(recipe);
if (reuse.steps.length !== 0) throw new Error("Second setup did not reuse installed executable");
console.log(
	JSON.stringify({
		phase: "verified",
		version: step.archive.version,
		sha256: step.archive.sha256,
		linkMatches: (await readlink(step.archive.link)) === result.executable,
		reused: true,
		stageCleanup: !(await readdir(join(process.env.XDG_DATA_HOME!, "xcsh/software/salesforce"))).some(name =>
			name.startsWith(".xcsh-stage-"),
		),
	}),
);
