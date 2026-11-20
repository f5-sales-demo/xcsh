import type { BunPlugin } from "bun";

/** The current vendor publishes native bindings for these targets. */
export function markitNativePackage(platform: string, arch: string): string | undefined {
	if (!["x64", "arm64"].includes(arch)) return undefined;
	if (platform === "darwin") return `@shiftlabs/markit-darwin-${arch}`;
	if (platform === "linux") return `@shiftlabs/markit-linux-${arch}-gnu`;
	return undefined;
}

/** Make the SDK loader visible to Bun compilation and embed the selected published addon. */
export function markitNativeBundlePlugin(platform: string = process.platform, arch: string = process.arch): BunPlugin {
	const binding = markitNativePackage(platform, arch);
	return {
		name: "markit-native-bundle",
		setup(builder) {
			builder.onLoad({ filter: /[/\\]@shiftlabs[/\\]markit[/\\]dist[/\\]native-markit\.js$/ }, async ({ path }) => {
				const source = await Bun.file(path).text();
				const loader = /import \{ createRequire \} from "node:module";\s*const require = createRequire\(import.meta.url\);\s*const native = require\("\.\.\/native.cjs"\);/;
				if (!loader.test(source)) throw new Error("Current Markit native loader differs from the qualified build contract");
				return { loader: "js", contents: source.replace(loader, 'import native from "../native.cjs";') };
			});
			builder.onLoad({ filter: /[/\\]@shiftlabs[/\\]markit[/\\]native\.cjs$/ }, async ({ path }) => ({
				loader: "js",
				// Preserve the vendor's actual unsupported-platform behavior where it
				// publishes no addon. Loading stays lazy in the CLI.
				contents: binding ? `module.exports = require(${JSON.stringify(binding)});` : await Bun.file(path).text(),
			}));
		},
	};
}
