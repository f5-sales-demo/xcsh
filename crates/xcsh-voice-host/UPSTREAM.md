# Voice host adaptation

The helper source and tests come from openai/codex
970111f6cb62cc02fe36a82ea7d71b37a2889c97, codex-rs/voice-host.
Copyright OpenAI, Apache-2.0. The helper protocol, capture, playback, transport,
native runtime layout, process hardening and same-build handshake are preserved.
The client library dependency is the xcsh adaptation with explicit package/build
inputs. Packaging tests convert the upstream test package directory to that
explicit input. The internal binary/resource names stay pinned to the protocol;
these names do not change application chat/execution ownership.

Source compilation, prepared runtime linkage, hashes, artifact packaging,
installed microphone/speaker behavior and physical acceptance are separate gates.

## Native qualification adaptation

The adapted transport bounds remote SDP candidates and retained inbound TCP streams,
rejects unexpected event channels, explicitly admits bundled TCP candidates and
keeps ICE checks active throughout the bounded negotiation deadline. Unit peers
bind loopback; the installed-client peer binds one IPv4 interface advertised by
the production helper, because wildcard upstream binds exclude loopback. The
production candidate cap is retained. Test-runtime heartbeat instrumentation
distinguishes scheduling stalls from transport failure.

Large futures are heap-pinned, time subtraction is checked, and exact synthetic
sample assertions have narrow test-module float-comparison lint reasons. These
adaptations retain the original source pin and the same-build helper protocol.

Current Ubuntu synthetic checks: 57 helper unit tests, 3 lifecycle tests, an
explicit relocated-runtime test and 3 installed-client tests passed. Hardware
permission/audio tests and immutable Mac/Linux application packaging remain
separate requirements. Failed TCP and Clippy logs remain private.

SDK loader paths apply only to native helper test/build and pre-assembly execution.
Application builds, native addon readiness, companion generation and packaged
verification exclude these paths while retaining explicit pkg-config and linker
inputs. A preserved Mac CI failure showed SDK libintl shadowing Homebrew Git
during source fingerprinting. This environment adaptation retains the original
reference and requires fresh Mac CI qualification; Linux success does not qualify it.

## Packaged macOS loader closure

A preserved offline prebuilt check found helper load commands still pointing at
the CI native prefix, despite successful verification on that same runner. Assembly
now rewrites verified bundled library imports on the copied helper to loader-relative
paths and signs that copy on approved CI. Manifest hashes describe the adapted copy.
A platform-independent Mach-O reader rejects external imports and search paths in
every packaged helper/library before runtime activation, even when a build prefix
is present. The pinned runtime projection and original reference remain unchanged.

Approved native qualification uses the supported macos-15 arm64 runner after
GitHub announced macos-14 brownouts and retirement. The explicit arm64 check
and macOS 13 deployment target remain in force; this changes the CI builder
image, without adopting another Codex reference or native ABI.

GitHub subsequently cancelled macos-15 arm64 jobs before runner acquisition,
with explicit capacity annotations. The next candidate uses the standard macos-26
arm64 image to discriminate image-pool capacity from shared arm64 scarcity.
The architecture guard, macOS 13 deployment target and original Codex pin remain
unchanged; qualification receipts must establish whether this candidate runs.

Qualification schedules Linux before Mac with one active platform job after
repeated hosted arm64 acquisition cancellations. Both platform checks remain
required. This changes CI scheduling, retaining native ABI, source pin and
deployment target; runner and artifact receipts determine qualification.
