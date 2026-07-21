// Phase 1 (token layer) renders no React components, so no @testing-library
// cleanup is needed yet. happy-dom is registered by ./register-dom.ts (preloaded
// first). Component-render cleanup arrives here with the components in Phase 2.
export {};
