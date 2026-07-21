/**
 * Preloaded FIRST so happy-dom's globals (window/document/…) exist before any
 * DOM-touching code (injectTokens/injectFontFaces) runs. Must NOT import
 * `@testing-library/*` (that would defeat the ordering).
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (typeof window === "undefined") {
	GlobalRegistrator.register();
}
