# Cleanroom qualification runner

This private harness retains 34 campaign gates and 299 lifecycle gates across
23 plugins. It operates against the installed candidate and real project
directories. A prepared campaign does not constitute qualification.

The operations are `prepare`, `pair`, `arm`, `observe`, `inspect`, `close`,
`seal`, and `resume`. Adapter commands are explicit argument arrays. Candidate,
source trees, adapter files, configuration, and fixture hashes are frozen at
preparation and checked on subsequent operations. `resume` reports state and
does not replay work.

Before arming, declare `fixtureHashes` in the specification. The arm adapter
must return precisely those bindings, verified pairing, the effective
configuration, owned host/worker identities, and collectors already running.
Physical voice evidence requires human phone actions and observations.
Synthetic fixtures remain separately identified.

Seals retain the session history, fresh capture diagnostics, fixtures, assertion
inputs, closure receipt, and hashes. Failed attempts are immutable. Existing
discovery and Plan failures must not be promoted to passes. Plan acceptance
requires actual runtime mode, a nonempty saved plan with a matching SHA256,
and verified absence of installation and infrastructure effects.

The nonce origin is a workload fixture. A successful traffic assertion requires
the requested nonce and fixture identity in both the response and correlated
logs, plus verified CE and load-balancer identities. If nginx proxies to the
loopback origin, use nginx's access log for the CE source address.

Run `python3 -m unittest discover -s tests/qualification_cleanroom -t .` from the repository root.

This is a harness foundation. Full KVM case materialization, dependency-aware
seal reuse, and final-repetition aggregation remain required. The campaign
stays incomplete until all required evidence is accepted. Destroy disposable
resources through their owning controller and verify absence after testing.

Voice startup diagnostics use `voice_ab_live.py` on the NUC with isolated real
configuration and installed RPC endpoints. `voice_ab_network.py` creates only
task-owned network interfaces and a scoped NAT rule; run its `cleanup()` after
all owned processes stop. `voice_ab_seal.py <abba-receipt>` hashes captures and
produces immutable normalized timelines. Packet drops, TCP sequence gaps,
missing footers, missing history, and wrong artifacts remain failed evidence.
`voice_ab.py` evaluates matched ABBA contracts and never grants phone acceptance.
Stock TLS remains encrypted; only the separate diagnostic connector may log
TLS keys. All evidence and cloned configuration must remain owner-only.

Future WebRTC continuation follows [the pinned openai/codex and gpt-live-1 requirement](../../docs/iphone-integration-checkpoint.md#webrtc-compatibility-requirement).
The original prototype remains preserved; source qualification and physical acceptance are separate gates.
