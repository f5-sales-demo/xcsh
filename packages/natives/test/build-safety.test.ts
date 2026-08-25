import { describe, expect, it } from "bun:test";
import { findGlibcRequirementsAbove, hasAvx512Markers } from "../../../scripts/ci-release-verify-natives";
import { buildZigArgs } from "../scripts/zig-safe-wrapper";

describe("native build safety", () => {
	describe("buildZigArgs", () => {
		it("pins host zig build to the requested cpu contract", () => {
			expect(
				buildZigArgs(["build", "-Doptimize=ReleaseFast"], { target: "x86_64-linux-gnu", cpu: "x86_64_v2" }),
			).toEqual(["build", "-Doptimize=ReleaseFast", "-Dtarget=x86_64-linux-gnu", "-Dcpu=x86_64_v2"]);
		});

		it("does not override explicit zig target or cpu flags", () => {
			expect(
				buildZigArgs(["build", "-Dtarget=x86_64-linux-gnu", "-Dcpu=x86_64_v3"], {
					target: "x86_64-linux-gnu",
					cpu: "x86_64_v2",
				}),
			).toEqual(["build", "-Dtarget=x86_64-linux-gnu", "-Dcpu=x86_64_v3"]);
		});

		it("leaves non-build zig commands untouched", () => {
			expect(buildZigArgs(["version"], { target: "x86_64-linux-gnu", cpu: "x86_64_v2" })).toEqual(["version"]);
		});
	});

	describe("hasAvx512Markers", () => {
		it("flags AVX-512 register markers in disassembly", () => {
			expect(hasAvx512Markers("60ba1df:\tc4 c1 78 92 c9\t\tkmovw  %r9d,%k1")).toBe(true);
			expect(hasAvx512Markers("123456:\t62 f1 7d 48 6f c0\tvmovdqa32 %zmm0,%zmm1")).toBe(true);
		});

		it("flags EVEX-encoded AVX-512 even without zmm or mask registers", () => {
			expect(hasAvx512Markers("401000:\t62 f3 75 28 25 c2 96\tvpternlogd $0x96,%ymm2,%ymm1,%ymm0")).toBe(true);
		});

		it("ignores ordinary x86-64 disassembly", () => {
			expect(hasAvx512Markers("401000:\t48 89 e5\t\tmov %rsp,%rbp")).toBe(false);
			expect(hasAvx512Markers("401004:\tc5 f5 fe c2\tvpaddd %ymm2,%ymm1,%ymm0")).toBe(false);
			expect(hasAvx512Markers("58b83d7:\t62 00 00 00 ")).toBe(false);
		});
	});

	describe("Linux release ABI", () => {
		it("rejects glibc requirements above the 2.17 release floor", () => {
			const readelf = [
				"0x0010:   Name: GLIBC_2.17  Flags: none  Version: 9",
				"0x0020:   Name: GLIBC_2.28  Flags: none  Version: 8",
				"0x0030:   Name: GLIBC_2.39  Flags: none  Version: 7",
			].join("\n");
			expect(findGlibcRequirementsAbove(readelf, "2.17")).toEqual(["2.28", "2.39"]);
		});

		it("accepts repeated requirements at or below the floor", () => {
			const readelf = "GLIBC_2.2.5 GLIBC_2.17 GLIBC_2.3 GLIBC_2.17";
			expect(findGlibcRequirementsAbove(readelf, "2.17")).toEqual([]);
		});

		it("configures Linux CI builds with the napi cross toolchain and no host linker override", async () => {
			const build = await Bun.file(new URL("../scripts/build-native.ts", import.meta.url)).text();
			const workflow = await Bun.file(new URL("../../../.github/workflows/ci.yml", import.meta.url)).text();
			expect(build).toContain('napiArgs.push("--target", releaseLinuxTarget, "--use-napi-cross")');
			expect(build).toContain('Bun.env.TARGET_CC = "clang"');
			expect(build).toContain('Bun.env.TARGET_CXX = "clang++"');
			expect(build).toContain('Bun.env.CFLAGS_aarch64_unknown_linux_gnu = "-D_BSD_SOURCE"');
			expect(workflow).not.toContain("CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER");
		});

		it("verifies the published npm package in a fresh Debian 12 container", async () => {
			const workflow = await Bun.file(new URL("../../../.github/workflows/ci.yml", import.meta.url)).text();
			const verifier = await Bun.file(new URL("../../../scripts/ci-verify-npm-debian.sh", import.meta.url)).text();
			expect(workflow).toContain("verify-npm-debian:");
			expect(workflow).toContain("run: bash scripts/ci-verify-npm-debian.sh");
			expect(verifier).toContain("FROM node:24-bookworm-slim");
			expect(verifier).toContain("PI_NATIVE_VARIANT=baseline");
			expect(verifier).not.toContain("|| true");
		});
	});
});
