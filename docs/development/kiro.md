# Native Kiro access

Use `/login kiro` in xcsh to connect the native Kiro service. Compatible Kiro
Desktop accounts appear first, followed by CLI accounts and fresh AWS Builder ID
or Company SSO sign-in. Select the intended source explicitly. xcsh reads native
credential files without changing them and stores the selected connection in its
existing credential store.

Kiro Desktop 1.4.26 stores IdC tokens separately from their client registration.
xcsh follows the token's `clientIdHash` to that exact registration. For Company
SSO, when Desktop does not retain the company start URL, xcsh asks for it and
checks it against the registration hash. Google/GitHub social tokens and
incomplete or expired registrations require fresh AWS Builder ID or Company SSO
login in this version.

Company SSO requires the organization's HTTPS start URL and AWS issuer region.
Fresh login uses AWS device authorization. Complete AWS authentication/consent
in your browser; Escape cancels sign-in. When multiple corporate profiles are
available, choose the intended profile and service region.

The model catalog belongs to the selected account/profile/service region.
Inference stays bound to that connection; adding another account or profile
keeps an existing conversation on its original connection.
xcsh preserves service IDs and limits and recommends the available service
default. Builder ID uses the service-owned Builder profile specified by native
Kiro Desktop; AWS rejects profile listing for this account type. Corporate
profiles and all model catalogs use native paginated APIs.

After connection, choose **Use recommended model** or **Browse models**, then
reasoning and scope. The active model changes only after the existing review
flow is confirmed. Saving a Kiro default retains that provider after restart.
Use `/logout`, select Kiro, and confirm removal to disconnect xcsh; native
Desktop/CLI credentials remain intact.

Text and tool calls use the native streaming service, including tool results on
continuation. Token counts carry `usage.tokenSource`: `reported` for service
counts and `estimated` for local estimates. Subscription usage has no asserted
API dollar price. Service errors and cancellation retain an explicit failure
outcome.

Development targets macOS and Linux. Native Kiro is separate from LiteLLM.
Steering, MCP and agent-setting imports are outside this integration. Live
corporate SSO and Opus 5.5 access have not been verified.

## Automated acceptance

Run from a managed Herdr pane:

```sh
bun packages/coding-agent/scripts/kiro-uat.ts --method company --evidence /absolute/private/company
bun packages/coding-agent/scripts/kiro-uat.ts --method builder --evidence /absolute/private/builder
bun packages/coding-agent/scripts/kiro-uat.ts --method desktop --evidence /absolute/private/desktop
bun packages/coding-agent/scripts/kiro-uat.ts --method fresh --evidence /absolute/private/fresh
```

Builder/company methods load a test-only OIDC/Kiro fixture into the actual TUI.
Desktop/fresh methods run `bun dev` with real native services; fresh login needs
human AWS authentication/consent. The runner owns a sibling pane, preserves
focus, checks native session/turn completion and provider attribution, exercises
restart/logout, and writes raw rendered checkpoints and receipts privately.
