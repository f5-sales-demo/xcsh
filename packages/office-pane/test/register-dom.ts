/**
 * Preloaded FIRST (before test/setup.ts and any test file), so happy-dom's
 * globals (window/document/…) exist before `@testing-library/dom` is ever
 * imported — its `screen` binds to `document.body` at import time, so the
 * document must already be registered. This file must NOT import
 * `@testing-library/*` (that would defeat the ordering).
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (typeof window === "undefined") {
	GlobalRegistrator.register();
}
