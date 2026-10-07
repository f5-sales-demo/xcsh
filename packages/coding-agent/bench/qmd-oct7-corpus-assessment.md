# October 7 general documentation refresh

The consumer accepts the exact six assets of `content-20261007T031703Z` from source commit
`dd073238958c0c86b3c898c0a20eb3fb8cfc188c`. GitHub reports the producer release as mutable.
Every downloaded size and SHA-256 matches the pinned publication receipt and GitHub asset digest.
The receipt SHA-256 is `38fda94c2a47369ae7d7d38cc60d3139e00ecf1e2e02c86d3891bdfb71502264`.

| Measure | Previous | Curated |
| --- | ---: | ---: |
| Documents | 739 | 715 |
| Media locators | 3,822 | 3,556 |
| Bundled media bytes | 0 | 0 |

There are 24 removed pages, no additions, 71 changed bodies, and one metadata-only change.
The platform concepts page loses its relationship to the retired OCSP concept; its body is unchanged.
All 715 stored Markdown files match the verified archive byte for byte. All 4,883 exact heading reads
and 3,556 public media links pass. All 24 removed exact reads and 266 removed media locators are absent.
The producer verifier validates metadata, unique heading anchors, relationships and source identities.
Document-page citation fallback remains in place because equivalent public section anchors are unverified.

The existing generator made two independent builds with matching metadata, SQLite and canonical gzip bytes.
Identical SQLite bytes also imply identical logical rows. The SQLite SHA-256 is
`9ce6605024724cc9a5b9ad0ab1ecad533c290d00609e734e7fe0d47440952026` (44,793,856 bytes).
The index fingerprint is `7d73c415db742d726539ce04353841d2ad0479bbf26040ed901785027ee2f2d0`.
The text-manifest digest is `dccf724488c27187a4e805e730c1e5954f5db0ebe9608dd94618ce3757e59824`.

Terraform `documentation-v15.2.0` and API `v12.0.0` pins remain unchanged.
Previous frozen qualification evidence is preserved. Subsequent measurements are regression-only.
The user waived independent review; correctness and CI gates remain required.

## Removed destinations

[Producer PR #95](https://github.com/f5-sales-demo/html-to-markdown/pull/95) removes 14 pages from its
729-page baseline through the reviewed legacy policy. [PR #93](https://github.com/f5-sales-demo/html-to-markdown/pull/93)
accounts for the other ten through whole-document `vesctl` retirement. The previously excluded CE examples
were already absent from the consumer baseline.

| Source destination | Policy |
| --- | --- |
| [Introduction to F5 Distributed Cloud Console Rate Limiting Feature](https://community.f5.com/t/69411) | `legacy-retired` |
| [Mitigating OWASP Web Application Risk: Injection exploits using F5 Distributed Cloud Platform](https://community.f5.com/t/69781) | `legacy-retired` |
| [Generate API SDK for F5 Distributed Cloud](https://community.f5.com/t/71350) | `vesctl-retired` |
| [F5 XC CE Debug commands through GUI cloud console and API](https://community.f5.com/t/75640) | `vesctl-retired` |
| [Bulk-Create Secondary DNS Zones in F5 Distributed Cloud (via API)](https://community.f5.com/t/76970) | `vesctl-retired` |
| [Audit Log Reference](https://docs.cloud.f5.com/docs-v2/audit-logs-and-alerts/reference/auditlog-ref) | `legacy-retired` |
| [Configure a Standalone CDN Distribution](https://docs.cloud.f5.com/docs-v2/content-delivery-network/how-to/cdn-mgmt/conf-cdn-dis) | `legacy-retired` |
| [Domain Delegation](https://docs.cloud.f5.com/docs-v2/dns-management/how-to/delegate-domain) | `legacy-retired` |
| [Configure CDN Distribution](https://docs.cloud.f5.com/docs-v2/docs/how-to/app-networking/cdn-distribution) | `legacy-retired` |
| [Domain Delegation](https://docs.cloud.f5.com/docs-v2/docs/how-to/app-networking/domain-delegation) | `legacy-retired` |
| [Reference](https://docs.cloud.f5.com/docs-v2/docs/reference) | `legacy-retired` |
| [OCSP Stapling](https://docs.cloud.f5.com/docs-v2/multi-cloud-app-connect/concepts/ocsp-staple) | `legacy-retired` |
| [Configure OCSP Stapling](https://docs.cloud.f5.com/docs-v2/multi-cloud-app-connect/how-to/adv-security/configure-ocsp) | `legacy-retired` |
| [Manage Multiple Custom Certificates](https://docs.cloud.f5.com/docs-v2/multi-cloud-app-connect/how-to/manage-multiple-custom-certificates) | `legacy-retired` |
| [Blindfold TLS Certificates](https://docs.cloud.f5.com/docs-v2/multi-cloud-network-connect/how-to/adv-security/blindfold-tls-certs) | `vesctl-retired` |
| [Vesctl](https://docs.cloud.f5.com/docs-v2/platform/how-to/volt-automation/vesctl) | `vesctl-retired` |
| [Deploy App Delivery Network](https://docs.cloud.f5.com/docs-v2/platform/quickstart/app-delivery-network) | `vesctl-retired` |
| [Deploy a Secure Application and Monitor Performance](https://docs.cloud.f5.com/docs-v2/platform/quickstart/web-app-security-performance) | `vesctl-retired` |
| [Reference](https://docs.cloud.f5.com/docs-v2/platform/reference) | `legacy-retired` |
| [Enforce Namespace Checks for APIs](https://docs.cloud.f5.com/docs-v2/platform/reference/migrate-api-ns-ref) | `legacy-retired` |
| [Delegated Domains migration](https://my.f5.com/manage/s/article/K000148731) | `legacy-retired` |
| [F5 Distributed Cloud Console](https://www.f5.com/products/distributed-cloud-services/distributed-cloud-console) | `vesctl-retired` |
| [F5 WAF for Distributed Cloud](https://www.f5.com/products/distributed-cloud-services/distributed-cloud-waf) | `vesctl-retired` |
| [Distributed Cloud DDoS Mitigation Service](https://www.f5.com/products/distributed-cloud-services/l3-and-l7-ddos-attack-mitigation) | `vesctl-retired` |

## Changed bodies and metadata

All 71 body diffs were reviewed: retired roles and Delegated Domains/certificate workflows, dependencies
and incoming links, reviewed screenshot/caption removals, and structural empty-heading cleanup.
The one metadata-only change is listed below. No consumer rewriting changes source bodies.
Current workload migration, Mesh/SMSv2, AWS TGW, generic DNS delegation, BIOS, and customer API
examples remain present; their original archive bytes are preserved.

| Document | Removed lines | Added lines |
| --- | ---: | ---: |
| [How to use F5 Distributed Cloud to block (OFAC) Sanctioned Countries](https://community.f5.com/t/69308) | 2 | 0 |
| [Quick and Easy Steps to secure your multi-cloud environment with F5’s Distributed Cloud](https://community.f5.com/t/69333) | 6 | 0 |
| [F5 Distributed Cloud Security Service Insertion With BIG-IP Advanced WAF](https://community.f5.com/t/69462) | 8 | 0 |
| [Use F5 Distributed Cloud to control Primary and Secondary DNS](https://community.f5.com/t/70580) | 2 | 0 |
| [How to Split DNS with Managed Namespace on F5 Distributed Cloud (XC) Part 2 – TCP & UDP](https://community.f5.com/t/70689) | 8 | 0 |
| [Detect and stop exfiltration attempts with F5 Distributed Cloud App Infrastructure Protection](https://community.f5.com/t/70911) | 2 | 0 |
| [Easily Protect Your Applications from DDoS with F5 Distributed Cloud DDoS Auto-Mitigation](https://community.f5.com/t/71491) | 4 | 0 |
| [F5 Distributed Cloud – Multiple custom certificates for HTTP/TCP LB](https://community.f5.com/t/72630) | 4 | 0 |
| [Overview of F5 Distributed Cloud Dashboards](https://community.f5.com/t/72944) | 7 | 0 |
| [Run AI LLMs Centrally and Protect AI Inferencing with F5 Distributed Cloud API Security](https://community.f5.com/t/74028) | 2 | 0 |
| [How I did it - "Remote Logging with the F5 XC Global Log Receiver and Elastic"](https://community.f5.com/t/74191) | 2 | 0 |
| [F5 Distributed Cloud and AWS VPC Lattice](https://community.f5.com/t/74218) | 2 | 0 |
| [Distributed Cloud Support for NAS Migrations from On-Premises Approaches to Azure NetApp Files](https://community.f5.com/t/74394) | 2 | 0 |
| [The Power of &: F5 Hybrid DNS solution](https://community.f5.com/t/74630) | 4 | 0 |
| [Automate NetApp ONTAP Storage Management with Private and Secure API Governance](https://community.f5.com/t/74717) | 4 | 0 |
| [Secure, Deliver and Optimize Your Modern Generative AI Apps with F5](https://community.f5.com/t/74878) | 2 | 0 |
| [F5 App Connect and NetApp S3 Storage – Secured Scalable AI RAG](https://community.f5.com/t/75439) | 4 | 0 |
| [F5 Distributed Cloud and Amazon FSx for NetApp ONTAP - Global Replication and Anywhere Access](https://community.f5.com/t/75748) | 6 | 0 |
| [Accelerate Your Initiatives: Secure & Scale Hybrid Cloud Apps on F5 BIG-IP & Distributed Cloud DNS](https://community.f5.com/t/75784) | 2 | 0 |
| [Streamlining Certificate Management in F5 Distributed Cloud: From Console Clicks to CLI Efficiency](https://community.f5.com/t/76453) | 23 | 0 |
| [HTTP Load Balancer Routes on F5 Distributed Cloud](https://community.f5.com/t/77174) | 2 | 0 |
| [Regional Edge SaaS Application Deployment Recommended Practices](https://community.f5.com/t/77245) | 12 | 0 |
| [Manage Roles](https://docs.cloud.f5.com/docs-v2/administration/how-tos/user-mgmt/roles) | 8 | 0 |
| [User Management](https://docs.cloud.f5.com/docs-v2/administration/how-tos/user-mgmt/users) | 10 | 0 |
| [Advanced iRules](https://docs.cloud.f5.com/docs-v2/bigip-utilities/how-tos/irules/adv-irules) | 4 | 0 |
| [Configure the Bot Defense infrastructure](https://docs.cloud.f5.com/docs-v2/bot-defense/configure-advanced/bot-defense-infra) | 1 | 1 |
| [Configure Bot Defense on an HTTP load balancer](https://docs.cloud.f5.com/docs-v2/bot-defense/configure-advanced/bot-on-http-load-balancer) | 1 | 1 |
| [Plan your Bot Defense Standard deployment](https://docs.cloud.f5.com/docs-v2/bot-defense/how-tos/plan-bot-defense) | 2 | 2 |
| [Configure Bot Defense Advanced with F5 Distributed Cloud Web App & API Protection](https://docs.cloud.f5.com/docs-v2/bot-defense/quickstarts/bot-defense-quickstart) | 1 | 1 |
| [Configure Bot Defense Standard with F5 Distributed Cloud Web App and API Protection](https://docs.cloud.f5.com/docs-v2/bot-defense/quickstarts/bot-defense-waap) | 2 | 0 |
| [Configure CDN Caching on an HTTP Load Balancer](https://docs.cloud.f5.com/docs-v2/content-delivery-network/how-to/cdn-mgmt/conf-cache-lb) | 3 | 3 |
| [Manage DNS Zone](https://docs.cloud.f5.com/docs-v2/dns-management/how-to/manage-dns-zones) | 7 | 1 |
| [Monitor DNS](https://docs.cloud.f5.com/docs-v2/dns-management/how-to/observe/monitor-dns) | 17 | 3 |
| [Configure DNS Services](https://docs.cloud.f5.com/docs-v2/dns-management/quickstart/dns-services) | 13 | 2 |
| [Configure JavaScript Challenge](https://docs.cloud.f5.com/docs-v2/docs/how-to/advanced-security/js-challenge) | 4 | 0 |
| [Create HTTP Load Balancer](https://docs.cloud.f5.com/docs-v2/docs/how-to/app-networking/http-load-balancer) | 20 | 0 |
| [Create Web Application Firewall](https://docs.cloud.f5.com/docs-v2/docs/how-to/app-security/web-app-firewall) | 4 | 0 |
| [User Management](https://docs.cloud.f5.com/docs-v2/docs/how-to/user-mgmt/users) | 10 | 0 |
| [Load Balancing and Service Mesh](https://docs.cloud.f5.com/docs-v2/docs/ves-concepts/load-balancing-and-proxy) | 45 | 0 |
| [Technical Knowledge for F5 Distributed Cloud Services](https://docs.cloud.f5.com/docs-v2) | 3 | 0 |
| [Configure HTTP/2 Support](https://docs.cloud.f5.com/docs-v2/multi-cloud-app-connect/how-to/adv-security/configure-http-2) | 10 | 0 |
| [Configure HTTP Header Processing](https://docs.cloud.f5.com/docs-v2/multi-cloud-app-connect/how-to/adv-security/configure-http-header-processing) | 8 | 0 |
| [Configure JavaScript Challenge](https://docs.cloud.f5.com/docs-v2/multi-cloud-app-connect/how-to/adv-security/js-challenge) | 4 | 0 |
| [Discover Service Endpoints Using HashiCorp Consul](https://docs.cloud.f5.com/docs-v2/multi-cloud-app-connect/how-to/app-nw/discover-consul) | 4 | 0 |
| [Kubernetes Service Discovery](https://docs.cloud.f5.com/docs-v2/multi-cloud-app-connect/how-to/app-nw/service-discovery-k8s) | 4 | 0 |
| [Configure Certificate Revocation List](https://docs.cloud.f5.com/docs-v2/multi-cloud-app-connect/how-to/load-balance/configure-certificate-revocation-list) | 1 | 1 |
| [Create HTTP Load Balancer](https://docs.cloud.f5.com/docs-v2/multi-cloud-app-connect/how-to/load-balance/create-http-load-balancer) | 20 | 0 |
| [Create TCP Load Balancer](https://docs.cloud.f5.com/docs-v2/multi-cloud-app-connect/how-to/load-balance/create-tcp-load-balancer) | 7 | 1 |
| [Create UDP Load Balancer](https://docs.cloud.f5.com/docs-v2/multi-cloud-app-connect/how-to/load-balance/create-udp-load-balancer) | 5 | 1 |
| [Monitor HTTP Load Balancer](https://docs.cloud.f5.com/docs-v2/multi-cloud-app-connect/how-to/observe/monitor-http-load-balancer) | 23 | 0 |
| [Manage Saved Filters](https://docs.cloud.f5.com/docs-v2/multi-cloud-app-connect/how-to/others/filters) | 4 | 0 |
| [Create Dynamic Reverse Proxy](https://docs.cloud.f5.com/docs-v2/multi-cloud-app-connect/how-tos/advanced-app-nwg/dynamic-reverse-proxy) | 4 | 0 |
| [Create and Advertise Virtual Host](https://docs.cloud.f5.com/docs-v2/multi-cloud-app-connect/how-tos/advanced-app-nwg/virtual-hosts) | 9 | 1 |
| [Monitor Site Networking](https://docs.cloud.f5.com/docs-v2/multi-cloud-network-connect/how-to/observe/monitor-your-site-networking) | 15 | 1 |
| [Concepts](https://docs.cloud.f5.com/docs-v2/platform/concepts) | 0 | 0 |
| [Load Balancing and Service Mesh](https://docs.cloud.f5.com/docs-v2/platform/concepts/load-balancing-and-mesh) | 45 | 0 |
| [Role-Based Access Control Concepts](https://docs.cloud.f5.com/docs-v2/platform/concepts/rbac) | 18 | 1 |
| [Workspace and Services](https://docs.cloud.f5.com/docs-v2/platform/concepts/wkspc-and-srvcs) | 4 | 0 |
| [Manage Known Labels and Known Keys](https://docs.cloud.f5.com/docs-v2/shared-configuration/how-tos/others/create-known-labels-keys) | 8 | 0 |
| [Enable API Endpoint Discovery and Schema Learning](https://docs.cloud.f5.com/docs-v2/web-app-and-api-protection/how-to/app-security/apiep-discovery-control) | 8 | 0 |
| [Create Web Application Firewall](https://docs.cloud.f5.com/docs-v2/web-app-and-api-protection/how-to/app-security/application-firewall) | 4 | 0 |
| [Configure DDoS Detection](https://docs.cloud.f5.com/docs-v2/web-app-and-api-protection/how-to/app-security/ddos-detection) | 10 | 0 |
| [Monitor Web App & API Protection](https://docs.cloud.f5.com/docs-v2/web-app-and-api-protection/how-to/observe/monitor-waap) | 2 | 1 |
| [Setting Up API Protection](https://docs.cloud.f5.com/docs-v2/web-app-and-api-protection/quickstart/api-protection) | 5 | 1 |
| [Setting Up API Discovery](https://docs.cloud.f5.com/docs-v2/web-app-and-api-protection/quickstart/api-security) | 5 | 1 |
| [TLS Versions and Cipher Suites for Load Balancer Reference](https://docs.cloud.f5.com/docs-v2/web-app-and-api-protection/reference/tls-reference) | 12 | 0 |
| [Host rewrite behavior in F5 Distributed Cloud HTTP Load Balancers](https://my.f5.com/manage/s/article/K000146653) | 1 | 0 |
| [How to test API in Distributed Cloud](https://my.f5.com/manage/s/article/K000147726) | 1 | 1 |
| [F5 Distributed Cloud  Support Case Escalation](https://my.f5.com/manage/s/article/K000147739) | 1 | 0 |
| [Distributed Cloud Services](https://www.f5.com/products/distributed-cloud-services) | 2 | 2 |
| [Secure Apps with F5 Distributed Cloud Managed Services](https://www.f5.com/products/distributed-cloud-services/managed-services) | 1 | 1 |
| [Web application and API protection solutions](https://www.f5.com/solutions/web-app-and-api-protection) | 6 | 6 |

## Evidence and standalone artifacts

Issue: [xcsh #4761](https://github.com/f5-sales-demo/xcsh/issues/4761).
The delivery directory contains SQLite, canonical gzip, consumer pin, complete comparison JSON,
body-section diff, relationships/taxonomy comparison, preserved-topic identities, and SHA256SUMS.
Archives, source media bytes and producer curation audits stay outside the installed database.
Snapshot, corrupt-receipt, malformed/duplicate/unsafe archive, cache, citation, history, streaming,
export and installed-smoke checks are recorded separately from frozen qualification results.

Ubuntu candidate acceptance passed 715 queries with five repetitions per query, warm p95 25.90 ms,
network-disabled QMD and Terraform smokes. Complete-corpus checks passed 715 documents, 4,883
anchors, all public media links and all removed identities. Historical retirement impact is recorded
separately for eight evidence files; their bytes and frozen qualification labels remain unchanged.

Cross-platform complete response comparison found one floating-point section-selection tie.
Rounding BM25 before the per-document section choice resolves it deterministically by ordinal.
The query regression failed before the fix and passed afterward. All 715 complete response hashes
now match across Mac and Ubuntu, with five repetitions; warm p95 Mac 13.98 ms and Ubuntu 21.93 ms.
