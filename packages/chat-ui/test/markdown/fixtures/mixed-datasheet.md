# F5 Distributed Cloud WAF

A quick datasheet comparing **enforcement modes** for the *Web Application Firewall*.

## Mode comparison

| Mode | Latency | Blocks traffic |
| :--- | :---: | ---: |
| Monitoring | low | no |
| Blocking | low | yes |

## Rollout checklist

- Planning
  - Inventory the apps
  - Define the ~~legacy~~ baseline policy
- Enablement
  - [x] Enable monitoring mode
  - [ ] Promote to blocking mode

> Start in monitoring mode, then promote to blocking once signatures are tuned.

### Signature tuning

Review false positives weekly before promoting to blocking.

Example policy snippet:

```yaml
mode: blocking
signatures: recommended
```

---

See https://www.f5.com or email dana@example.com for details.
