# Task settings on an empty host

The iPhone loads `config/read`, `configRequirements/read`, and `model/list`
before it creates its first thread. An empty host must therefore resolve its
model catalog from authenticated host configuration without creating a thread
or registering a placeholder terminal.

The previous folderless-chat repair retained model metadata from a live terminal
or a persisted managed thread. That behavior still applies. The empty-host path
now resolves current visible authenticated models and default reasoning, caches
the read-only metadata briefly, and closes the temporary credential store. The
first thread request uses the advertised model/provider and default effort.
Unavailable phone selections fail before worker creation. An active terminal
continues to own its catalog and defaults.

Verification must run the phone's setup sequence while `thread/list` is empty,
then confirm that it remains empty. A test that creates a thread before asking
for models cannot verify first-chat setup. Preserve the failed installed probe,
the sanitized phone requests, and the exact candidate identities before retrying
the physical screen.

After a phone chat is persisted, its worker may unload between visits. Model
discovery continues to use the authenticated host catalog in this state and
while managed workers are loaded. The persisted chat still supplies the selected
model identity; it does not replace the catalog with one model or erase reasoning
options. A live interactive terminal keeps its own dynamic catalog. Check models
both before the first chat and after worker unload/reopen.

## Preserved iPhone checkpoint

See [the integration inventory](iphone-integration-checkpoint.md) and [root handoff](../HANDOFF.md)
for the retained native registration/backend baseline and separate Home Screen WebRTC prototype.
Registration, source checks and automated speech do not establish physical voice acceptance.
Native identity failed; native startup-policy consumption and further phone/endurance tests remain unfinished.
