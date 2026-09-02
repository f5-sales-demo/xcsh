import { createMathExtensions, renderMath, TEMML_OPTIONS } from "./math";

export interface XcshMathBrowserApi {
	createMathExtensions: typeof createMathExtensions;
	renderMath: typeof renderMath;
	options: typeof TEMML_OPTIONS;
}

(globalThis as typeof globalThis & { xcshMath?: XcshMathBrowserApi }).xcshMath = Object.freeze({
	createMathExtensions,
	renderMath,
	options: TEMML_OPTIONS,
});
