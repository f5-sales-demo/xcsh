# Managed workers in lifecycle preflight

The installed candidate runs a supervisor, relay host, and a separate worker for
each loaded phone chat. Preflight must recognize the registered worker without
accepting an arbitrary process that happens to use the same executable.

The campaign adapter passively reads the owned session catalog and Linux process
state. A worker is accepted only when its thread record, PID, process start time,
exact command, executable path and SHA-256 agree with the installed candidate.
The recorded socket must be under the private workers directory, owned by the
test user, listening, and held by that process as an open socket descriptor.
Inspection rechecks process identity after reading the evidence. It never opens
the worker protocol connection or displaces the relay host as its IPC owner.

Each runtime receipt records the verified workers. Creating the first worker is
a permitted lifecycle transition; replacing a loaded thread's owner or losing
the case's existing owner invalidates the attempt. Supervisor/relay replacement,
artifact changes, unexpected processes, and invalid worker metadata still fail.
Historical receipts without worker fields keep their original strict comparison.

The controller is separate test infrastructure. Pin its source commit and script
digests in the campaign's local harness receipt. Updating this inspector does
not replace the installed xcsh artifact or transfer prior physical passes to a
different candidate. Historical failures remain in their original receipts.

## Preserved iPhone checkpoint

See [the integration inventory](iphone-integration-checkpoint.md) and [root handoff](../HANDOFF.md)
for the retained native registration/backend baseline and separate Home Screen WebRTC prototype.
Registration, source checks and automated speech do not establish physical voice acceptance.
Native identity failed; native startup-policy consumption and further phone/endurance tests remain unfinished.
