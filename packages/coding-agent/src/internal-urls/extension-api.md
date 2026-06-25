# xcsh Chrome Extension Bridge — Tool API Reference

> Surfaced via `xcsh://extension`. The xcsh assistant drives the browser through
> the Chrome extension bridge (native messaging → service worker → CDP). Knowing
> which tool to use — and which to avoid — for each interaction is essential for
> deterministic, non-fragile automation.

---

## Deterministic click path (PREFERRED)

### `click_element { js, wait_ms? }`
**Use for:** clicking any element that exists in the page's main document.

`js` is a JavaScript expression that returns the target **Element** (or null). The
extension resolves geometry from the renderer (`DOM.getContentQuads` — CSS viewport
px with transforms/zoom/DPR baked in) and **hit-tests** the point
(`document.elementFromPoint`) before dispatching the trusted click. On occlusion it
re-scrolls once, then **fails loudly** naming the occluder — never a silent mis-click.
`wait_ms` polls for async elements (CDK portals, lazy content).

**Guarantees:**
- Deterministic across window sizes and zoom levels (layout-engine coords, not JS rects).
- Catches overlays (CDK portals, dialogs) and tells you what's in the way.
- Holds the element handle atomically across scroll → measure → verify → click.

**Build the `js` arg via** `buildElementResolverScript(selector)` (the same catalogue
selector grammar: `text('…')`, `role:text('…')`, `role[name='…']`, CSS, row-scoped `>>`)
so the click resolves the same element the workflow YAML names.

---

### `click { ref }`
Use when you already have an AX `ref` handle (from `read_ax`). Routes through
`click_element` internally — same determinism guarantees.

### `click_xy { x, y }`
**Last-resort.** Only for viewport points with no backing element (e.g. a computed
portal-overlay coordinate, or testing a specific pixel). Skips hit-testing.

---

## CDK-portal / typeahead (REQUIRED for CDK portals)

### `label_select { selector, value, label_value?, wait_ms? }`
**Use for:** any CDK-portal typeahead (`.cdk-overlay-container`): label-selector
key/operator/value steps, vsui "Type to search" inputs.

The extension keeps the input **focused throughout** (uses plain `Runtime.evaluate`,
NOT `evaluateWithRecovery` which detaches the debugger and kills focus). It:
1. Clicks the input (focus).
2. Types `value` via `Input.insertText` (keeps focus).
3. Polls the CDK portal for a matching option (`span` in `.cdk-overlay-container`).
4. Clicks the option via trusted CDP.
5. If `label_value` is provided, enters it into the value field that appears (uses the
   secret-textarea real-typing path if it's a `<textarea>`).

**Why mandatory for CDK portals:** `javascript_tool` routes through `evaluateWithRecovery`
which DETACHES the CDP debugger on timeout — killing input focus and closing the portal.
`label_select` uses plain `Runtime.evaluate` and holds focus end-to-end.

---

## Input (trusted)

### `type_text { text }`
Inserts text via `Input.insertText` into the currently-focused element. Fires genuine
trusted input events that Angular's ControlValueAccessor and vsui pick up. Use this
(or `fill` via page-actions) for text fields, not programmatic value setting.

### `key_press { key }`
Dispatches a trusted `Input.dispatchKeyEvent` (keyDown + keyUp) for the named key
(e.g. `"Enter"`, `"Tab"`, `"Escape"`, `"Backspace"`).

### `form_input { ref, value }`
Sets a form field's value via `Runtime.callFunctionOn` — the Angular-compat path that
bypasses vsui's value-descriptor patching. Use when `fill` isn't available.

---

## DOM inspection (caution: defocuses active input)

### `javascript_tool { code }`
Evaluates arbitrary JavaScript and returns the result. Routes through
`evaluateWithRecovery` — **IMPORTANT: this defocuses the currently-focused input and
closes any open CDK portal / vsui dropdown.** Never call it between a typeahead open
and a portal selection. Safe for reading DOM state BEFORE opening a typeahead.

### `read_ax { }` / `find { selector }`
Reads the accessibility tree or finds AX nodes by selector. Both freeze the MV3
service worker on heavy F5 XC SPA pages (30s+) — prefer `javascript_tool` for quick
DOM queries. `read_ax` is usable on lighter pages.

### `get_page_text { }`
Returns the visible text content of the current page.

---

## Navigation

### `navigate { url }`
Navigates to a URL. Auto-accepts `beforeunload` ("Leave site?") dialogs — so a dirty
form's dialog does NOT block navigation. Wait for the target page to settle before
querying the DOM.

### `wait_for { selector, context?, timeoutMs? }` / `assert_text { selector, expected }`
Wait for an element to appear / assert text. Use these as post-navigation settle points.

---

## Tab management

### `tabs_list`, `tabs_create`, `tabs_close`
Enumerate, open, and close browser tabs. Useful for multi-tab flows or checking that a
navigation landed on the intended page.

---

## Screenshot (avoid in automation)

### `screenshot { }` → base64 JPEG
Captures a scaled canvas screenshot. **Avoid in automation loops** — `captureVisibleTab`
freezes the MV3 service worker event loop on retina Mac displays, blocking all
subsequent bridge requests for several seconds.

---

## Debugging tools

### `read_console { pattern? }` / `read_network { pattern? }`
Read Chrome DevTools console logs or network requests. Use for debugging — not required
in deterministic create/read/update/delete flows.

---

## Summary: which tool for which job

| Situation | Tool |
|-----------|------|
| Click a button/tab/link in the page | `click_element` (buildElementResolverScript) |
| Click inside a CDK portal option | `label_select` (the ONLY reliable path) |
| Fill a text input | page-actions `fill` → `type_text` under the hood |
| Select from a vsui listbox | page-actions `selectOption` → `click_element` + poll |
| Need current DOM state | `javascript_tool` (but check there's no open typeahead first) |
| Navigate between pages | `navigate` |
| Verify something appeared | `wait_for` / `assert_text` |
| Raw coordinates only | `click_xy` (last resort) |
