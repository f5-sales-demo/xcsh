import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

test.skipIf(process.platform !== "linux" || process.arch !== "x64")(
	"Current native locale dependencies load in a fresh Bun process",
	async () => {
		const cwd = fileURLToPath(new URL("../../../", import.meta.url));
		const variant = /\bavx2\b/i.test(await Bun.file("/proc/cpuinfo").text()) ? "modern" : "baseline";
		const script = `const raw = require("./packages/natives/native/pi_natives.linux-x64-${variant}.node"); const normal = require("./packages/natives/native/index.js"); for (const name of ["renameExclusive", "renameExclusiveAt"]) { if (typeof raw[name] !== "function" || typeof normal[name] !== "function") throw new Error("required publication API unavailable"); } console.log("native-publication-load-passed");`;
		const child = Bun.spawn([process.execPath, "-e", script], {
			cwd,
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
		});
		const [code, stdout, stderr] = await Promise.all([
			child.exited,
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
		]);
		expect({ code, stdout: stdout.trim(), stderr }).toEqual({
			code: 0,
			stdout: "native-publication-load-passed",
			stderr: "",
		});
	},
);
