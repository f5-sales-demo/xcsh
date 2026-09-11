import { describe, expect, it } from "bun:test";

const REMOVED_IMAGE_EXPORTS = ["PhotonImage", "ImageFormat", "SamplingFilter"] as const;

describe("native public API boundary", () => {
	for (const origin of ["source", "embedded", "optional-package"] as const) {
		it(`removes obsolete image exports from an older ${origin} addon`, () => {
			const { exposeNativeApi } = require("../native/public-api.js") as {
				exposeNativeApi(value: object): Record<PropertyKey, unknown>;
			};
			const retained = () => origin;
			const legacyAddon = {
				retained,
				PhotonImage: class PhotonImage {},
				ImageFormat: { PNG: 0 },
				SamplingFilter: { Lanczos3: 0 },
			};

			const exposed = exposeNativeApi(legacyAddon);

			expect(exposed.retained).toBe(retained);
			for (const removed of REMOVED_IMAGE_EXPORTS) {
				expect(removed in exposed).toBe(false);
				expect(Object.hasOwn(exposed, removed)).toBe(false);
			}
		});
	}

	it("does not expose removed image symbols from the real source loader", () => {
		const natives = require("../native/index.js") as Record<string, unknown>;
		for (const removed of REMOVED_IMAGE_EXPORTS) {
			expect(removed in natives).toBe(false);
			expect(Object.hasOwn(natives, removed)).toBe(false);
		}
	});
});
