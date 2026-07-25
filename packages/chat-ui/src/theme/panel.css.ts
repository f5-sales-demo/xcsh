/**
 * The shared xcsh-terminal panel stylesheet, emitted as a string and injected by
 * each host at boot. Promoted from the Chrome extension's `PANEL_CSS` — already
 * custom-prop driven off the `--*` tokens from `injectTokens` (see tokens.ts) so
 * the look stays single-sourced — and converted from element IDs to class
 * selectors (this is a shared, multi-host package; a host may mount several
 * surfaces). Extended with the shell classes the unified UI adds: the header bar,
 * empty-state skill pills, the scroll-to-bottom FAB, the model selector, and the
 * shared popup menu (mode/model/header dropdowns), plus the ASCII/mark logo.
 *
 * Every color resolves to a `var(--…)` token — the generated palette plus the
 * two non-palette UI colors from tokens.ts (`--code-bg` for the near-black code
 * background, `--pure-white` for crisp white on the F5-red fills). No color
 * literals remain in this stylesheet.
 */
export const PANEL_CSS = `
* { box-sizing: border-box; }
html,body { margin:0; height:100%; }
body { background: var(--charcoal); color: var(--bright-white);
  font: 13px/1.5 var(--font-mono); position:relative; }
/* The full-height flex column + positioning context for the activation overlay
   (position:absolute; inset:0) and the scroll-to-bottom FAB. Hosts apply this to
   their mount root. */
.xcsh-panel { height:100%; display:flex; flex-direction:column; position:relative; overflow:hidden; }

/* ── Header bar ─────────────────────────────────────────────────────────── */
/* A compact PINNED control row. Deliberately has NO bottom border: the brand block
   lives inside the scrollport (see .brand-block) and scrolls away, so a divider here
   would cut the pane in half instead of reading as continuous with the transcript. */
.header { display:flex; align-items:center; gap:6px; padding:6px 10px; }
.header-title { color: var(--bright-white); font-size:12px; letter-spacing:.04em; }
.header-spacer { flex:1; }
.header-btn { position:relative; display:flex; align-items:center; justify-content:center; width:28px; height:28px;
  background:none; border:1px solid transparent; color: var(--cool-gray); border-radius:6px; cursor:pointer;
  font:inherit; font-size:15px; line-height:1; }
.header-btn:hover { color: var(--bright-white); border-color: var(--subtle-gray); }
.header-btn:disabled { opacity:.4; cursor:default; }
.header-btn:disabled:hover { color: var(--cool-gray); border-color:transparent; }
.header-menuwrap { position:relative; }
/* Hover/focus tooltip driven by the data-tip attribute (NOT the title attribute, or
   the browser's own tooltip would double up on ours); the accessible name stays on
   aria-label. Anchored right so a tip can never overflow a narrow 320px task pane. */
.header-btn[data-tip]::after { content: attr(data-tip); position:absolute; top:calc(100% + 6px); right:0; z-index:30;
  padding:3px 7px; border-radius:5px; background: var(--code-bg); color: var(--bright-white);
  border:1px solid var(--subtle-gray); font-size:11px; line-height:1.4; white-space:nowrap; opacity:0;
  pointer-events:none; transition:opacity .12s ease .35s; }
.header-btn[data-tip]:hover::after, .header-btn[data-tip]:focus-visible::after { opacity:1; }
@media (prefers-reduced-motion: reduce) { .header-btn[data-tip]::after { transition:none; } }

/* ── Shared popup menu (header / mode / model dropdowns) ────────────────── */
.menu { position:absolute; z-index:20; min-width:180px; background: var(--deep-charcoal);
  border:1px solid var(--subtle-gray); border-radius:8px; padding:4px; display:flex; flex-direction:column; gap:2px; }
.menu.menu-down { top:100%; margin-top:4px; }
.menu.menu-up { bottom:100%; margin-bottom:4px; }
.menu.menu-right { right:0; }
.menu.menu-left { left:0; }
.menu-header { display:flex; align-items:center; justify-content:space-between; padding:4px 8px; color: var(--dim); font-size:11px; }
.menu-item { display:flex; flex-direction:column; align-items:flex-start; gap:2px; text-align:left;
  background:none; border:none; color: var(--bright-white); border-radius:6px; padding:6px 8px; cursor:pointer; font:inherit; font-size:12px; }
.menu-item:hover:not(:disabled) { background: var(--subtle-gray); }
.menu-item:disabled { color: var(--dim); cursor:default; }
.menu-item.selected { color: var(--f5-red); }
.menu-item .menu-item-desc { color: var(--dim); font-size:11px; }

/* ── Context chip (dockable, dismissible host selection label) ──────────── */
.dot { width:8px; height:8px; border-radius:50%; background: var(--alert-red); flex:none; }
.dot.on { background: var(--signal-green); }
.chip { display:flex; align-items:center; gap:8px; padding:6px 12px; border-bottom:1px solid var(--subtle-gray);
  color: var(--dim); font-size:12px; }
.chip .title { color: var(--bright-white); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.chip button { margin-left:auto; background:none; border:1px solid var(--subtle-gray); color: var(--dim);
  border-radius:6px; padding:2px 8px; cursor:pointer; font:inherit; }
.chip button + button { margin-left:6px; }

/* ── Transcript + message rows ──────────────────────────────────────────── */
.messages { flex:1; min-height:0; overflow:auto; padding:12px; display:flex; flex-direction:column; gap:10px; }
.row { display:grid; grid-template-columns: var(--gutter) 1fr; column-gap:8px; }
/* A grid item defaults to min-width:auto (won't shrink below its content), so a
   long unbreakable token forces the 1fr column past the pane edge. min-width:0
   lets the content column shrink so text wraps instead of overflowing. */
.content { min-width: 0; }
.gutter { color: var(--bright-white); text-align:center; }
.g-thinking, .g-user { color: var(--f5-red); }
.g-tool-ok { color: var(--chrome-accent); }
.g-tool-err, .g-error { color: var(--alert-red); }
.g-tool-run { color: var(--warm-amber); }
.content .body a { color: var(--chrome-accent); }
.msg-user { background: var(--deep-charcoal); border-left:3px solid var(--f5-red); }
.user-body { font-style: italic; color: var(--bright-white); }
.thinking { color: var(--dim); }
.tool-body { color: var(--cool-gray); font-size:12px; }

/* ── Compact tool-activity row ("Read data ›" parity) ───────────────────── */
.tool-activity-line, .tool-activity-summary { display:flex; align-items:center; gap:6px; font-size:12px; }
.tool-activity-label { color: var(--cool-gray); }
.tool-activity-status { color: var(--dim); font-size:11px; }
.tool-activity { margin:0; }
.tool-activity > summary { cursor:pointer; list-style:none; color: var(--cool-gray); }
.tool-activity > summary::-webkit-details-marker { display:none; }
.tool-activity > summary::before { content:"›"; color: var(--dim); margin-right:4px; transition: transform .12s ease; display:inline-block; }
.tool-activity[open] > summary::before { transform: rotate(90deg); }
.tool-activity-detail { margin:4px 0 0 12px; padding:6px 8px; background: var(--code-bg); border:1px solid var(--subtle-gray);
  border-radius:6px; color: var(--cool-gray); font-size:11px; white-space:pre-wrap; overflow:auto; max-height:16em; }

/* ── "Sources" chip row (cited F5 docs / console links) ─────────────────── */
.references { display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; padding:0; list-style:none; }
.ref-item { display:inline-flex; }
.ref-chip { display:inline-flex; align-items:center; gap:6px; padding:2px 8px; font-size:11px; text-decoration:none;
  border:1px solid var(--subtle-gray); border-radius:999px; background: var(--deep-charcoal); color: var(--cool-gray);
  max-width:100%; }
a.ref-chip:hover { border-color: var(--chrome-accent); }
.ref-tag { font-size:9px; letter-spacing:.5px; padding:0 4px; border-radius:4px; background: var(--subtle-gray);
  color: var(--bright-white); flex:none; }
.ref-console .ref-tag { background: var(--f5-red); }
.ref-title { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:22ch; }
.ref-ext { color: var(--dim); flex:none; }
.ref-unsafe { opacity:.6; }
.error { color: var(--alert-red); }
pre.code { background:var(--code-bg); border:1px solid var(--subtle-gray); border-radius:6px; padding:8px; overflow:auto; max-width:100%; }
code { background:var(--code-bg); padding:1px 5px; border-radius:4px; overflow-wrap:anywhere; }
.spin { animation: spin 1s steps(8) infinite; } @keyframes spin { to { opacity:.4 } }
/* Live-typing caret on the streaming assistant row. */
.stream-caret { display:inline-block; width:0.5em; height:1em; margin-left:2px; vertical-align:text-bottom;
  background: var(--f5-red); animation: caret-blink 1s step-end infinite; }
@keyframes caret-blink { 50% { opacity:0 } }
@media (prefers-reduced-motion: reduce) { .stream-caret { animation:none } }
.body.error .msg-retry { margin-left:8px; background:transparent; color: var(--f5-red); border:1px solid var(--f5-red);
  border-radius:6px; padding:1px 8px; cursor:pointer; font:inherit; font-size:0.85em; vertical-align:baseline; }

/* ── Rich tool_use block (VS Code seed) ─────────────────────────────────── */
.tool-use { border:1px solid var(--subtle-gray); border-radius:6px; overflow:hidden; }
.tool-summary { display:flex; align-items:center; gap:6px; padding:4px 8px; background: var(--deep-charcoal); }
.tool-name { color: var(--chrome-accent); font-size:12px; }
.tool-running { color: var(--warm-amber); }
.tool-row { display:flex; align-items:flex-start; gap:6px; padding:4px 8px; border-top:1px solid var(--subtle-gray); }
.tool-row-label { color: var(--dim); font-size:10px; width:2.5ch; flex:none; }
.tool-row-content { flex:1; min-width:0; }
.tool-row-content pre { margin:0; white-space:pre-wrap; word-break:break-word; color: var(--cool-gray); font-size:12px; }
.tool-copy-btn { background:none; border:1px solid var(--subtle-gray); color: var(--dim); border-radius:4px;
  padding:1px 6px; cursor:pointer; font:inherit; font-size:11px; flex:none; }

/* ── Thinking disclosure (VS Code seed) ─────────────────────────────────── */
.thinking-block { color: var(--dim); }
.thinking-summary { display:flex; align-items:center; gap:6px; cursor:pointer; list-style:none; color: var(--dim); font-size:12px; }
.thinking-summary::-webkit-details-marker { display:none; }
.thinking-toggle { display:inline-flex; transition:transform .15s; }
.thinking-toggle.open { transform:rotate(90deg); }
.thinking-content { margin-top:4px; padding-left:22px; color: var(--cool-gray); }

/* ── Empty state (skill pills) ──────────────────────────────────────────── */
.empty-state { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:14px; padding:24px; }
.empty-logo { color: var(--f5-red); }
/* The host brand (logo + wordmark), rendered as the FIRST child inside .messages so
   it scrolls away with the conversation (Claude-for-Office). Top-anchored + flex:none
   on purpose — it must NOT centre or stretch like .empty-state (flex:1), which would
   push it into the middle of the pane and fight the centred skills block below it. */
.brand-block { flex:none; display:flex; align-items:center; gap:10px; padding:4px 2px 10px; }
.brand-title { color: var(--bright-white); font-size:13px; letter-spacing:.04em; }
.empty-heading { color: var(--bright-white); font-size:13px; letter-spacing:.02em; }
.pills { display:flex; flex-wrap:wrap; gap:8px; justify-content:center; max-width:340px; }
/* Claude's empty state stacks its slash-command pills vertically. Opt-in so the
   wrapped row layout stays the default for other surfaces (chrome/vscode). */
.pills.pills-stacked { flex-direction:column; flex-wrap:nowrap; align-items:stretch; width:100%; max-width:340px; }
.pills.pills-stacked .pill { text-align:left; border-radius:8px; padding:6px 12px; }
.pill { background: var(--deep-charcoal); border:1px solid var(--subtle-gray); color: var(--bright-white);
  border-radius:14px; padding:4px 12px; cursor:pointer; font:inherit; font-size:12px; }
.pill:hover { border-color: var(--f5-red); }

/* ── ASCII + mark logo ──────────────────────────────────────────────────── */
.ascii-logo { margin:0; line-height:1; font-size:9px; }
.ascii-line { white-space:pre; }
.ascii-red { color: var(--f5-red); }
.ascii-white { color: var(--bright-white); }
.ascii-shadow { color: var(--f5-dark-red); }
/* No width/height here: the PNG is 128px square and F5Logo sets width/height
   attributes from its size prop. Those are presentational hints, so ANY author
   rule beats them — a width:auto/height:auto here silently pinned every mark to the
   intrinsic 128px and made the size prop dead (a 20px mark rendered 128px tall). */
.f5-mark { display:block; }

/* ── Scroll-to-bottom FAB ───────────────────────────────────────────────── */
.scroll-to-bottom { position:absolute; right:16px; bottom:96px; z-index:6; width:32px; height:32px; border-radius:50%;
  background: var(--deep-charcoal); border:1px solid var(--f5-red); color: var(--f5-red); cursor:pointer;
  display:flex; align-items:center; justify-content:center; font-size:16px; line-height:1; }
.scroll-to-bottom:hover { background: var(--f5-red); color:var(--pure-white); }

/* ── Status bar (powerline, embedded on the composer's top border) ──────── */
.statusbar { position:absolute; top:-11px; left:12px; right:12px; display:flex; align-items:center; height:20px; font-size:11px; }
.statusbar .seg { position:relative; display:flex; align-items:center; height:20px; padding:2px 10px; white-space:nowrap; }
.statusbar .sep-r { position:absolute; right:-9.4px; top:0; height:100%; width:9.4px; z-index:1; clip-path:polygon(0 0, 100% 50%, 0 100%); }
.statusbar .sep-l { position:absolute; left:-9.4px; top:0; height:100%; width:9.4px; z-index:1; clip-path:polygon(100% 0, 0 50%, 100% 100%); }
.seg-spacer { flex:1; }

/* ── Attachment chips + attach menu ─────────────────────────────────────── */
.attachment-chips { display:flex; flex-wrap:wrap; gap:6px; padding:6px 12px 0; }
.attachment-chip { display:flex; align-items:center; gap:6px; max-width:220px; padding:2px 8px;
  background: var(--deep-charcoal); border:1px solid var(--subtle-gray); border-radius:12px; font-size:11px; }
.attachment-chip-kind { color: var(--dim); text-transform:uppercase; font-size:9px; letter-spacing:.05em; }
.attachment-chip-label { color: var(--bright-white); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.attachment-chip-remove { margin-left:2px; background:none; border:none; color: var(--dim); cursor:pointer;
  font:inherit; font-size:13px; line-height:1; padding:0 2px; }
.attachment-chip-remove:hover { color: var(--f5-red); }
.attach-menu { position:relative; display:flex; }

/* ── Composer (rounded, red-bordered box: editor + footer toolbar) ──────── */
.composer { position:relative; display:flex; flex-direction:column; margin:20px 12px 10px; background: var(--deep-charcoal);
  border:1px solid var(--f5-red); border-radius:8px; }
.input-editor-container { padding:10px 12px; }
.input { display:block; width:100%; min-height:20px; max-height:140px; overflow-y:auto; outline:none;
  background:transparent; color: var(--bright-white); border:none; padding:0; font:inherit; line-height:1.5; white-space:pre-wrap; word-break:break-word; }
.input:empty::before { content: attr(data-placeholder); color: var(--dim); }
.input-footer { display:flex; align-items:center; gap:4px; padding:4px 8px; border-top:1px solid var(--subtle-gray); }
.footer-spacer { flex:1; }
.footer-btn { display:flex; align-items:center; gap:4px; background:none; border:none; color: var(--cool-gray);
  cursor:pointer; padding:4px 8px; border-radius:4px; font:inherit; font-size:12px; }
.footer-btn:hover:not(:disabled) { color: var(--bright-white); }
.footer-btn:disabled { opacity:.5; cursor:default; }
.mode-btn { color: var(--bright-white); border:1px solid var(--subtle-gray); border-radius:6px; font-weight:500; }
.mode-btn:hover { border-color: var(--f5-red); }
.model-btn { color: var(--cool-gray); border:1px solid var(--subtle-gray); border-radius:6px; max-width:160px; }
.model-btn .model-label { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.model-btn:hover { border-color: var(--f5-red); color: var(--bright-white); }
.send-btn { background: var(--f5-red); color:var(--pure-white); border-radius:6px; padding:4px 8px; }
.send-btn:disabled { opacity:.5; cursor:default; }

/* ── Activation overlay ─────────────────────────────────────────────────── */
.activation-overlay { position:absolute; inset:0; z-index:5; display:flex; flex-direction:column;
  align-items:center; justify-content:center; gap:10px; background: var(--charcoal); padding:24px; }
.activation-overlay .ov-spinner { color: var(--f5-red); font-size:20px; }
.activation-overlay .ov-title { color: var(--bright-white); font-size:13px; letter-spacing:.04em; }
.activation-overlay .ov-gates { list-style:none; margin:8px 0 0; padding:0; width:100%; max-width:260px; }
.activation-overlay .ov-gate { display:flex; align-items:center; gap:8px; padding:4px 0; color: var(--dim); }
.activation-overlay .ov-gate .ov-ico { width:14px; text-align:center; }
.activation-overlay .ov-gate .ov-label { flex:1; }
.activation-overlay .ov-gate .ov-ms { color: var(--cool-gray); font-size:11px; white-space:nowrap; }
.activation-overlay .ov-passed { color: var(--bright-white); }
.activation-overlay .ov-passed .ov-ico { color: var(--signal-green); }
.activation-overlay .ov-active { color: var(--bright-white); }
.activation-overlay .ov-stalled, .activation-overlay .ov-stalled .ov-ico { color: var(--alert-red); }
.activation-overlay .ov-retry { margin-top:10px; background: var(--f5-red); color:var(--pure-white); border:none;
  border-radius:8px; padding:6px 16px; cursor:pointer; font:inherit; }

/* ── Gateway config form (terminal reskin of the Fluent form) ───────────── */
.gateway-form { display:flex; flex-direction:column; gap:12px; padding:16px; }
.gateway-field { display:flex; flex-direction:column; gap:4px; }
.gateway-field label { color: var(--cool-gray); font-size:12px; }
.gateway-field .gateway-hint { color: var(--dim); font-size:11px; }
.gateway-field input { background: var(--deep-charcoal); color: var(--bright-white); border:1px solid var(--subtle-gray);
  border-radius:6px; padding:6px 8px; font:inherit; outline:none; }
.gateway-field input:focus { border-color: var(--f5-red); }
.gateway-error { color: var(--alert-red); font-size:12px; }
.gateway-actions { display:flex; gap:8px; }
.gateway-actions .gateway-save { background: var(--f5-red); color:var(--pure-white); border:none; border-radius:6px;
  padding:6px 14px; cursor:pointer; font:inherit; }
.gateway-actions .gateway-cancel { background:none; color: var(--cool-gray); border:1px solid var(--subtle-gray);
  border-radius:6px; padding:6px 14px; cursor:pointer; font:inherit; }
/* Config-error recovery view (a rejected provider configure — #2134). */
/* ── Onboarding screen (first-run, no bridge) ─────────────────────────── */
.onboarding { display:flex; flex-direction:column; align-items:center; gap:12px; padding:24px 16px; text-align:center; }
.onboarding-title { color: var(--bright-white); font-size:16px; margin:4px 0 0; }
.onboarding-steps { color: var(--cool-gray); font-size:13px; text-align:left; margin:8px 0; padding-left:20px; }
.onboarding-steps li { margin:6px 0; }
.onboarding-steps code { background: var(--code-bg); padding:2px 6px; border-radius:4px; font-size:12px; }

.gateway-config-error { display:flex; flex-direction:column; align-items:flex-start; gap:8px; margin:16px 12px;
  padding:12px 14px; background: var(--deep-charcoal); border:1px solid var(--alert-red); border-radius:8px; }
.gateway-config-error-title { color: var(--alert-red); font-weight:600; margin:0; }
.gateway-config-error-detail { color: var(--bright-white); font-size:12px; margin:0; word-break:break-word; }

/* ── Slash-command menu (VS Code parity) ────────────────────────────────── */
.slash-btn { color: var(--cool-gray); font-weight:700; }
.slash-btn:hover:not(:disabled) { color: var(--f5-red); }
.menu-item .menu-item-command { color: var(--f5-red); font-weight:600; margin-right:6px; }

/* ── Tools multi-select picker (VS Code parity) ─────────────────────────── */
.tools-picker .tool-item { align-items:center; }
.tools-picker .tool-item-indicator { width:14px; text-align:center; color: var(--cool-gray); }
.tools-picker .tool-item.selected .tool-item-indicator { color: var(--signal-green); }
.tools-picker-confirm { width:100%; margin-top:4px; background: var(--f5-red); color: var(--pure-white); border:none;
  border-radius:6px; padding:5px 10px; cursor:pointer; font:inherit; font-size:12px; }
.tools-picker-confirm:disabled { opacity:.5; cursor:default; }

/* ── Thinking-level control inside the mode menu (VS Code parity) ────────── */
.thinking-section { padding:6px 4px 2px; }
.thinking-section .menu-divider { height:1px; background: var(--subtle-gray); margin:4px 0 8px; }
.thinking-section .thinking-label { display:block; color: var(--cool-gray); font-size:11px; margin-bottom:4px; }
.thinking-levels { display:flex; gap:4px; }
.thinking-level-btn { flex:1; background: var(--deep-charcoal); color: var(--cool-gray); border:1px solid var(--subtle-gray);
  border-radius:4px; padding:3px 0; cursor:pointer; font:inherit; font-size:11px; }
.thinking-level-btn:hover { color: var(--bright-white); border-color: var(--f5-red); }
.thinking-level-btn.active { background: var(--f5-red); color: var(--pure-white); border-color: var(--f5-red); }

/* ── Rendered markdown block model (.markdown-root) ──────────────────────────
   Styles the semantic HTML the marked renderer emits. Host-agnostic: these rules
   apply on every surface (terminal + doc) so assistant markdown always renders
   structurally; the .xcsh-doc layer below only swaps the FONT/measure for the
   Office document read. Token-driven; no color/size literals. */
/* Break long unbreakable tokens (URLs, inline-code) so they wrap within the
   content column instead of overflowing the pane's right margin. */
.markdown-root { overflow-wrap: anywhere; }
.markdown-root > :first-child { margin-top: 0; }
.markdown-root > :last-child { margin-bottom: 0; }
.markdown-root p { margin: var(--space-3) 0; }

/* Headings — the modular scale (xl / lg / base) at a heavier weight. */
.markdown-root h1, .markdown-root h2, .markdown-root h3,
.markdown-root h4, .markdown-root h5, .markdown-root h6 {
  margin: var(--space-4) 0 var(--space-2); line-height: var(--leading-tight); font-weight: 650; color: var(--bright-white); }
.markdown-root h1 { font-size: var(--text-xl); }
.markdown-root h2 { font-size: var(--text-lg); }
.markdown-root h3 { font-size: var(--text-base); }
.markdown-root h4, .markdown-root h5, .markdown-root h6 { font-size: var(--text-sm); }

/* Lists — including nested ul/ol and GFM task lists. */
.markdown-root ul, .markdown-root ol { margin: var(--space-3) 0; padding-left: var(--space-5); }
.markdown-root li { margin: var(--space-1) 0; }
.markdown-root li > ul, .markdown-root li > ol { margin: var(--space-1) 0; }
.markdown-root ul.contains-task-list, .markdown-root li.task-list-item { list-style: none; }
.markdown-root li.task-list-item { padding-left: 0; }
.markdown-root li input[type="checkbox"] { margin-right: var(--space-2); accent-color: var(--f5-red); }

/* Bordered tables with per-column alignment via the enumerated classes. */
.markdown-root table { border-collapse: collapse; width: 100%; margin: var(--space-3) 0; font-size: var(--text-sm); }
.markdown-root th, .markdown-root td { border: 1px solid var(--subtle-gray); padding: var(--space-2) var(--space-3); text-align: left; }
.markdown-root th { background: var(--deep-charcoal); color: var(--bright-white); font-weight: 650; }
.markdown-root .md-align-left { text-align: left; }
.markdown-root .md-align-center { text-align: center; }
.markdown-root .md-align-right { text-align: right; }

/* Blockquote + thematic break. */
.markdown-root blockquote { margin: var(--space-3) 0; padding: var(--space-1) var(--space-4); border-left: 3px solid var(--f5-red); color: var(--cool-gray); }
.markdown-root hr { border: none; border-top: 1px solid var(--subtle-gray); margin: var(--space-4) 0; }

/* Fenced code + inline code + the language chip. Code ALWAYS stays monospace. */
.markdown-root pre { position: relative; background: var(--code-bg); border: 1px solid var(--subtle-gray); border-radius: 6px;
  padding: var(--space-3); margin: var(--space-3) 0; overflow: auto; }
.markdown-root pre code { display: block; background: none; padding: 0; font-family: var(--font-mono); white-space: pre; }
.markdown-root code { background: var(--code-bg); padding: 1px 5px; border-radius: 4px; font-family: var(--font-mono); }
.markdown-root .md-lang-label { display: block; margin-bottom: var(--space-2); color: var(--dim); font-family: var(--font-mono);
  font-size: var(--text-xs); text-transform: uppercase; letter-spacing: .06em; }
.markdown-root a { color: var(--chrome-accent); }
.markdown-root del { color: var(--dim); }

/* ── Document surface (.xcsh-doc) — opt-in, Office-only ──────────────────────
   Only the Office host adds this class to its pane root (one classList.add), so
   the terminal identity stays byte-for-byte on Chrome/VS Code/CLI. It swaps the
   prose read to the proportional SYSTEM sans + the type/measure/rhythm tokens;
   code stays monospace for the exact Claude prose-vs-code contrast. */
.xcsh-doc { font-family: var(--font-sans); }
.xcsh-doc .messages { padding: var(--gutter-doc); }
/* Office HOST reserve (a separate class from .xcsh-doc, which only means "sans
   document typography"): Office draws its own info button over the pane's
   top-right corner, so keep our icon row clear of it. */
.xcsh-host-office .header { padding-right:36px; }
.xcsh-doc .content .body,
.xcsh-doc .markdown-root { font-family: var(--font-sans); font-size: var(--text-base); line-height: var(--leading-relaxed);
  max-width: min(var(--measure), var(--measure-px)); }
.xcsh-doc .markdown-root code,
.xcsh-doc .markdown-root pre,
.xcsh-doc .markdown-root pre code,
.xcsh-doc .markdown-root .md-lang-label { font-family: var(--font-mono); }
`;
