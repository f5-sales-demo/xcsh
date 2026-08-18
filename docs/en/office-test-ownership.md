# Office add-in test ownership

This document defines the canonical test ownership and execution responsibilities for the `office-pane` package and Office add-in task pane integration tests.

## Test suites and domain ownership

| Test suite / harness | Location | Canonical owner | Execution tier | Description |
| --- | --- | --- | --- | --- |
| **Office Task Pane UI Unit Tests** | `packages/office-pane/src/**/*.test.ts` | Frontend / UI Core Team | Local and PR CI | Core Office.js state management and task pane rendering |
| **Office Host Integration Harness** | `packages/office-pane/test/integration/` | Ecosystem Integrations Team | PR CI Matrix | Simulated Office.js API host binding and event handling |
| **Acceptance End-to-End Suite** | `packages/office-pane/test/e2e/` | QA and Release Engineering | Nightly Release CI | Headless browser execution against Word and Excel task pane mocks |

## Maintenance responsibilities

- **Frontend / UI Core Team**: Responsible for unit test coverage on UI components in `office-pane`.
- **Ecosystem Integrations Team**: Responsible for host mock fidelity and API contract alignment.
- **Release Engineering**: Responsible for end-to-end environment stability and CI matrix runtimes.
