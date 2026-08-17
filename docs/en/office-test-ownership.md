# Office Add-in Development Test Ownership

This document defines the canonical test ownership and execution responsibilities for the `office-pane` package and Office add-in task pane integration tests.

## Test Suites and Domain Ownership

| Test Suite / Harness | Location | Canonical Owner | Execution Tier | Description |
| :--- | :--- | :--- | :--- | :--- |
| **Office Task Pane UI Unit Tests** | `packages/office-pane/src/**/*.test.ts` | Frontend / UI Core Team | Local & PR CI | Core Office.js state management and task pane rendering |
| **Office Host Integration Harness** | `packages/office-pane/test/integration/` | Ecosystem Integrations Team | PR CI Matrix | Simulated Office.js API host binding and event handling |
| **Acceptance E2E Suite** | `packages/office-pane/test/e2e/` | QA & Release Engineering | Nightly Release CI | Headless browser execution against Word/Excel task pane mocks |

## Maintenance Responsibilities
- **Frontend / UI Core Team**: Responsible for unit test coverage on new UI components in `office-pane`.
- **Ecosystem Integrations Team**: Responsible for host mock fidelity and API contract alignment.
- **Release Engineering**: Responsible for E2E environment stability and CI matrix runtimes.
