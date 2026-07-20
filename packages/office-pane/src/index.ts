/**
 * Public surface of @f5-sales-demo/xcsh-office-pane.
 *
 * Re-exports the browser-safe core (protocol/transport/host-tools/gateway), the
 * Fluent panel components, and the Office.js host tools. The task-pane entry
 * (`taskpane.tsx`) is the browser bundle root and is not re-exported here.
 */

// Browser-safe core: wire protocol, transports, host-tool dispatcher, gateway config.
export * from "./core";
// Office.js document host tools + the host adapter.
export * from "./office/excel-tools";
export * from "./office/host-adapter";
export * from "./office/powerpoint-tools";
// Fluent UI task-pane components + the chat-session hook.
export * from "./panel";
