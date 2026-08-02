Run diagnostic commands on an F5 Distributed Cloud Customer Edge node.

The Site CLI runs on the CE itself and is reached over the `vpm/debug` API. The command
surface is embedded at `xcsh://sitecli` — read it rather than guessing, because command
availability depends on the node software build.

<critical>
The transport is decided by the command's catalog entry, NOT by preference. Sending a
command to the wrong endpoint returns `command not supported`, which is the SAME message
returned for a command that does not exist. Reporting "that command is unavailable" when
the transport was wrong is a confidently wrong answer, and it is the most common failure
here.
</critical>

## Three transports

|Entry says|Send to|Returns|
|---|---|---|
|`transport: global-get`|`GET …/vpm/debug/global/<cmd>`|JSON|
|`transport: exec-user`|`POST …/vpm/debug/<node>/exec-user`|text|
|`transport: exec`|`POST …/vpm/debug/<node>/exec`|text|

`exec-user` and `exec` take a body of the form:

```json
{ "namespace": "system", "site": "<site>", "node": "<node>", "command": ["<cmd>", "<arg>", "..."] }
```

Arguments are separate array elements, not one string:
`["journalctl", "-u", "vpm", "-n", "200"]`.

`global-get` takes no body and no arguments. Only `health` and `diagnosis` use it.

<prohibited>
Never run a command whose entry has `mutating: true` unless the user has asked for that
specific change and understands the node is live. On the current build that is
`ip-link-set`, which takes an interface down — including, on a remote CE, the interface
you are managing it through. Newer builds add `systemctl-restart-NetworkManager`,
`systemctl-restart-crio`, `systemctl-restart-kubelet` and `systemctl-start-crio-prune`,
which restart services under a live data plane.
</prohibited>

## Discovering the surface on an unknown node

POST to `exec-user` with the `command` key **omitted**. That returns the node's own
catalog. Sending an unknown command value instead returns an error, not the catalog.

## Before running anything, check the node is reachable

The `vpm/debug` API is served through the F5 Distributed Cloud control plane over the
tunnel that registration establishes. It answers only when the site is `ONLINE`:

```
GET /api/config/namespaces/system/sites/<site>  ->  .spec.site_state
```

If the site is not `ONLINE`, no command on this page will work, and the node also
refuses SSH as shipped. The only remaining route is the Azure Serial Console, which
needs a human at a terminal.

## Reading results

- `health` first. It is cheap and structured, and `state: PROVISIONED` confirms the node
  registered and is configured.
- Long output is genuinely long: `nh --list` runs to thousands of lines and the flow
  table holds hundreds of thousands of entries. Prefer `flow-l-match <ip>[:port]` over
  `flow-l`, and `dropstats-non-zero` over `dropstats`.
- Drop counters are lifetime totals, not rates. A non-zero counter means nothing on its
  own; run the command twice and compare while reproducing the problem.

<instruction>
Two traps that produce plausible but wrong conclusions:
1. `rt --dump` takes the vRouter table id, which is NOT the `vrf-id` that
   `show-ip-bgp-summary` prints. Passing the BGP number returns
   `No such file or directory`, which reads as a broken node rather than a wrong
   argument.
2. The node runs Docker AND CRI-O simultaneously. `vpm`, `argo_watch` and
   `site-console` are Docker containers; Kubernetes workloads are CRI-O. A three-entry
   `docker-ps` is the complete list, not a symptom, and `crictl-*` will not show `vpm`.
</instruction>

For anything beyond the command surface — what output means, and the diagnostic
sequences that chain commands — read the Customer Edge documentation in the `mcn`
documentation set rather than inferring it.
