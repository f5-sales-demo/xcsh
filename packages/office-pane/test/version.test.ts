import { expect, test } from "bun:test";
import { CORE_CONTRACT_VERSION } from "../src/core";

test("core exposes a semver contract version", () => {
	expect(CORE_CONTRACT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
});

test("happy-dom is registered for component tests", () => {
	const el = document.createElement("div");
	el.textContent = "ok";
	expect(el.textContent).toBe("ok");
});
