import { expect, test } from "bun:test";
import { voiceBuildEnvironment } from "./voice-build-environment";

const environment = {
	DYLD_LIBRARY_PATH: "/fixture/sdk/lib",
	LD_LIBRARY_PATH: "/fixture/sdk/lib",
	PKG_CONFIG_LIBDIR: "/fixture/sdk/lib/pkgconfig",
	RUSTFLAGS: "-C link-arg=-Wl,-rpath,@loader_path/../lib",
	STABLE_GIT_COMMIT: "fixture-source",
};
test.each(["native-addon", "application", "companion-source", "package-handshake", "assembly-rejections", "future-tool"])(
	"%s cannot shadow host tool libraries while retaining build inputs",
	stage => {
		const result = voiceBuildEnvironment(environment, stage);
		expect(result).not.toHaveProperty("DYLD_LIBRARY_PATH");
		expect(result).not.toHaveProperty("LD_LIBRARY_PATH");
		expect(result.PKG_CONFIG_LIBDIR).toBe(environment.PKG_CONFIG_LIBDIR);
		expect(result.RUSTFLAGS).toBe(environment.RUSTFLAGS);
		expect(result.STABLE_GIT_COMMIT).toBe(environment.STABLE_GIT_COMMIT);
		expect(environment.DYLD_LIBRARY_PATH).toBe("/fixture/sdk/lib");
	},
);
test.each(["helper", "relocation", "installed-client", "assembly"])(
	"%s retains explicit SDK linkage before packaged relocation",
	stage => expect(voiceBuildEnvironment(environment, stage)).toEqual(environment),
);
