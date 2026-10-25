# xcsh owned phone client

An installable iPhone Home Screen voice app with a private HTTPS adapter on an xcsh host. Calls use the host's existing ChatGPT subscription. The phone never receives OpenAI credentials.

The adapter uses the existing Unix remote-control RPC and sends `thread/realtime/start` with a WebRTC offer. xcsh
creates the provider call, including its compiled voice policy. It preserves `workspace-write/on-request`, creates a
fresh thread for each call, and supports only voice start, stop, and capture evidence. It forwards no arbitrary RPC or
typed user work. Disconnecting stops the owned voice call; existing backend work is retained.

Use an immutable qualified xcsh executable. Generate the private runtime configuration and random 64-character
connection token outside Git. Bind HTTPS to the host's Tailscale address and use a trusted certificate for its Tailscale
DNS name. The configuration requires `root`, `project`, `socketPath`, `tokenFile`, `origin`, `backend` (executable,
SHA256 and source commit), `bind`, `port`, `certificate` and `key`.

Run `python server.py --config /private/path/runtime.json` using an environment with aiohttp. Open the private HTTPS
connection link on the iPhone. Safari's Share → Add to Home Screen installs the app. If the installed app needs its
connection restored, paste the same private connection link. Keep Tailscale connected while using the app.

Tests: `python -m unittest -v test_server`. JavaScript validation: `bun build app.js --target browser --outfile /private/path/app.js`. The app depends on WebKit microphone permission and MediaStream playback; automated protocol tests do not prove iPhone hearing, interruption or long-call behavior.

Receipts and protocol evidence stay in the private runtime root. Distinguish backend provenance, client source
provenance, provider acceptance, speaker playback and physical hearing outcomes. This route is separate from ChatGPT's
native phone-owned call route; a passing owned-client call does not qualify native startup-policy consumption.

## Checkpoint and isolated validation

See [the root handoff](../../../HANDOFF.md) and [issue #5071](https://github.com/f5-sales-demo/xcsh/issues/5071).
This prototype depends on the native baseline, retains workspace-write/on-request and keeps provider
credentials on the host. Automated identity success does not establish iPhone Safari/Home Screen acceptance.
No physical phone test, runtime replacement or pairing revocation belongs to this publication checkpoint.

`bun run test:ts` runs the four mocked adapter regressions and browser build through the existing CI
entrypoint. Its isolated virtual environment installs `requirements-test.txt`; no live host configuration
or provider credentials are needed. Use `bun scripts/run-owned-phone-tests.ts` for the same focused checks.
