import { $ } from "bun";

/** Source APIs may be newer than the released optional addon installed by Bun. */
let compatible = false;
try {
 const native = await import("../packages/natives/native/index.js");
 compatible = typeof native.PowerAssertion === "function";
} catch {
 // A fresh checkout has no matching local artifact yet.
}
if (!compatible) {
 process.stderr.write("Building the native addon required by this source checkout…\n");
 const result = await $`bun run build:native`.cwd(new URL("..", import.meta.url).pathname).nothrow();
 if (result.exitCode !== 0) process.exit(result.exitCode);
}
