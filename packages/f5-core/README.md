# xcsh F5 core

`@f5-sales-demo/xcsh-f5-core` provides specification-backed F5 resource operations
for a Node host. Its exported ESM and CommonJS bundles contain the pinned CLI
specification and shared resource implementation. They run without an external
xcsh executable, Bun, an agent loop, or a model provider. Editors supply their
own embedded Node runtime, sign-in, selected model, and approval UI.

The initial inventory matches xcsh's 94 indexed CRUD resource kinds. It does
not claim coverage of every operation in the larger API catalog. The generated
projection preserves the CLI's validation metadata, matching operation
metadata, and all transitively referenced request/response schemas. The runtime
checks its SHA-256 before use. `specificationReceipt` records the upstream
release, commit, asset hashes, CLI input hashes, and projection hash. It has no
network fallback.

## Host contract

Create one `F5Core` instance for the owning workspace. Supply four adapters:

- `getContext` synchronously returns the explicitly activated workspace/context,
  HTTPS API origin, namespace, and a monotonic revision. The host must include
  credential, environment, namespace, activation and external file changes in
  that revision, and verify cached state against its canonical persistence.
- `getCredentials` resolves F5 credentials privately for that exact snapshot.
  Native editor credentials and model selection never enter this interface.
- `approve` shows the validated plan and returns its exact hash with the user's
  decision. A canceled, late, or changed approval cannot dispatch a write.
- `persist` atomically stores a private receipt. Failure before dispatch blocks
  the operation. Failures after a dispatched mutation require reconciliation.

The host retains Contexts activation, persistence, watchers, environment
resolution, rollback and resource views. The core reads no profile files or
environment defaults. Resolve payload environment variables privately before
planning, under the same revision; never substitute variables after approval.

Derive the conversation identity from the trusted editor invocation, not model
arguments. `bind` returns an opaque handle. Discovery, field description,
validation, inspection, planning and execution require that handle. A changed
context invalidates it. Secret references are private to each binding and are
restored only within their originating binding; they are never persisted.

```js
import { F5Core } from '@f5-sales-demo/xcsh-f5-core';

const core = new F5Core({
  getContext: currentActivatedContext,
  getCredentials: resolveF5Credentials,
  approve: showExactPlanApproval,
  persist: persistPrivateReceipt,
});
const binding = await core.bind(editorConversationId);
const description = await core.describe(binding, 'http_loadbalancer', {
  field: 'spec.more_option.custom_errors',
});
const plan = await core.plan(binding, 'create', manifests);
const result = await core.execute(binding, plan.id, cancellationSignal);
```

Plans are immutable and single-use. The complete batch validates before any
write. Approval binds the original manifests, operation, namespace, workspace,
context revision, credentials, specification hash and observed resource state.
The core rechecks the context synchronously immediately before transport
dispatch and verifies independent readback afterward. Updates/deletions require
a nonempty UID and resource version. Immutable selection changes are rejected;
the core never silently deletes and recreates a resource.

The production transport makes one attempt, follows no redirects, and honors
cancellation. An uncertain response, failed verification, or failure to persist
a dispatched mutation consumes the plan and reports `UNCERTAIN_MUTATION`.
Reconcile with a fresh read and a fresh plan; do not replay the old approval.
`F5CoreError.completed` counts independently verified entries in a partial
operation. A host-provided transport must preserve these dispatch and no-retry
semantics; it is a trusted adapter, not an extension point for model input.

## Optional CLI enrichment

`xcsh f5-core capabilities --json` returns protocol version 1 and the installed
CLI's specification hash. `xcsh f5-core discover --json` returns its indexed
resource inventory without credentials or starting an agent. The CLI advertises
only its exposed discovery enhancement. `negotiateCapabilities` accepts a
matching protocol/specification and returns the understood capability
intersection separately from the always-available bundled capabilities.
Absence, command failure, malformed output and incompatible versions leave the
bundled core usable. CLI mutation delegation is not advertised.

## Development and release gates

Bootstrap the repository with its exact Bun version before tests. From the
repository root:

```sh
bash scripts/ci-bun-install.sh
bun --cwd=packages/f5-core run test
bun --cwd=packages/f5-core run check
```

Development builds use Bun and the repository TypeScript compiler. Published
Node entrypoints use the prebuilt bundles; their runtime does not invoke the
build tools. Tests include plain-Node execution from an empty directory with
no external CLI or Bun on PATH. Synthetic transports prove algorithm and
artifact behavior, not live cloud or editor specialist acceptance.

The normal publication workflow places this package after resource-management
and before the CLI. Publish in a coordinated new release so consumers receive
the matching shared resource implementation. Publication, merge, production
VSIX acceptance in both editors, and marketplace acceptance remain separate
gates under xcsh #5072 and vscode-xcsh #1708. The Kiro routing gate is unresolved;
this package does not bypass it or select ordinary chat as a substitute.
