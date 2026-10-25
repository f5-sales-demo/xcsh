# Phone pairing QR

Run `xcsh remote-control pair` in an interactive terminal, or `/remote pair` in
the xcsh TUI, after authentication, enrollment, and relay readiness. Scan the
complete QR with the iPhone camera and finish authorization in ChatGPT. The
manual code shown below the QR remains available as a fallback.

The display uses the first-party desktop pairing link:
`https://chatgpt.com/codex/pair` with the opaque challenge in the `pairing_code`
query parameter. The manual code is a separate response field and is never
used as the QR payload. The challenge retains the backend's host binding and
expiry checks. Terminal rendering uses black modules on white, four quiet
modules, and error correction level L, matching fullscreen desktop setup.

Enlarge a small terminal to reveal the complete QR. An expired challenge is
removed. Enter, Escape, or Ctrl+C closes the display and restores the terminal;
closing hides the challenge but does not revoke it before its backend expiry.
The TUI uses a temporary overlay and adds no pairing material to chat or status
history. Do not capture the QR or manual code in logs, screenshots, or evidence.

`xcsh remote-control pair --json` retains the existing response schema for
automation. That response contains pairing secrets; consume it privately.
Noninteractive pairing without `--json` fails before creating a challenge.

Linux direct hosting remains prototype interoperability. Official mobile-host
setup documents the desktop app on Mac and Windows. QR generation and a decoded
synthetic fixture do not establish physical pairing acceptance: require an
actual scan, phone authorization, the exact host's client claim, and a harmless
round trip on the selected host.

## Preserved iPhone checkpoint

See [the integration inventory](iphone-integration-checkpoint.md) and [root handoff](../HANDOFF.md)
for the retained native registration/backend baseline and separate Home Screen WebRTC prototype.
Registration, source checks and automated speech do not establish physical voice acceptance.
Native identity failed; native startup-policy consumption and further phone/endurance tests remain unfinished.
