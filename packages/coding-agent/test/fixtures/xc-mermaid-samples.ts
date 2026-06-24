/**
 * F5 Distributed Cloud (XC) mermaid sample library.
 *
 * Each sample pairs a plain-English prompt (the kind of request a user would
 * type into xcsh) with the mermaid source that represents it. Used by:
 *   - the functionality matrix tests (mermaid-matrix.test.ts), and
 *   - the visual gallery harness (scripts/mermaid-gallery.ts) for human UAT.
 *
 * Sources are kept within the subset of mermaid that beautiful-mermaid renders
 * (flowchart, sequence, class, er, state, xychart).
 */

export type XcMermaidType = "flowchart" | "sequence" | "class" | "er" | "state" | "xychart";

export interface XcMermaidSample {
	id: string;
	/** Plain-English request a user would make. */
	prompt: string;
	category: string;
	type: XcMermaidType;
	source: string;
}

export const XC_MERMAID_SAMPLES: XcMermaidSample[] = [
	// ── Load balancing ──────────────────────────────────────────────────────
	{
		id: "http-lb-origin-pool",
		prompt: "Show how an HTTP Load Balancer routes traffic to an Origin Pool with a Health Check.",
		category: "Load Balancing",
		type: "flowchart",
		source: `graph LR
  Client[Client] --> LB[HTTP Load Balancer]
  LB --> Route{Route Match}
  Route -->|/api| Pool[Origin Pool]
  Route -->|/static| CDN[CDN Distribution]
  Pool --> HC[Health Check]
  Pool --> O1[Origin 1]
  Pool --> O2[Origin 2]`,
	},
	{
		id: "http-lb-security-pipeline",
		prompt:
			"Diagram the security pipeline a request flows through on an HTTP Load Balancer: WAF, bot, API, and DDoS.",
		category: "Load Balancing",
		type: "flowchart",
		source: `graph LR
  Req[Client Request] --> WAF[App Firewall]
  WAF --> Bot[Bot Defense]
  Bot --> API[API Protection]
  API --> DDoS[DDoS Mitigation]
  DDoS --> SP[Service Policy]
  SP --> Pool[Origin Pool]`,
	},
	{
		id: "tcp-lb",
		prompt: "Show a TCP Load Balancer forwarding to an origin pool across two sites.",
		category: "Load Balancing",
		type: "flowchart",
		source: `graph LR
  Client[Client] --> TLB[TCP Load Balancer]
  TLB --> P[Origin Pool]
  P --> S1[Site us-east]
  P --> S2[Site eu-west]`,
	},
	{
		id: "dns-lb",
		prompt: "Diagram a DNS Load Balancer with geo and failover load-balancing rules.",
		category: "Load Balancing",
		type: "flowchart",
		source: `graph TD
  Q[DNS Query] --> DLB[DNS Load Balancer]
  DLB --> Rule{LB Rule}
  Rule -->|geo: NA| PoolA[Pool North America]
  Rule -->|geo: EU| PoolB[Pool Europe]
  Rule -->|failover| PoolC[Backup Pool]`,
	},
	{
		id: "lb-vip-advertise",
		prompt: "Show how a Load Balancer VIP is advertised to the internet versus a custom set of sites.",
		category: "Load Balancing",
		type: "flowchart",
		source: `graph LR
  LB[HTTP Load Balancer] --> Adv{Advertise Policy}
  Adv -->|Internet| RE[Regional Edge]
  Adv -->|Custom| CE[Customer Edge Sites]
  RE --> Internet[Public Internet]
  CE --> Inside[Internal Network]`,
	},

	// ── Origin pools ────────────────────────────────────────────────────────
	{
		id: "origin-pool-members",
		prompt: "Diagram an Origin Pool with multiple origin servers and TLS to the origins.",
		category: "Origin Pools",
		type: "flowchart",
		source: `graph LR
  Pool[Origin Pool] --> LBAlgo{Load Balancing}
  LBAlgo -->|round robin| M1[Origin 10.0.0.1]
  LBAlgo -->|round robin| M2[Origin 10.0.0.2]
  LBAlgo -->|round robin| M3[Origin 10.0.0.3]
  Pool --> TLS[Origin TLS]`,
	},
	{
		id: "origin-pool-health-state",
		prompt: "Show the health states an origin transitions through under active health checking.",
		category: "Origin Pools",
		type: "state",
		source: `stateDiagram-v2
  [*] --> Healthy
  Healthy --> Degraded: probe timeout
  Degraded --> Unhealthy: threshold exceeded
  Degraded --> Healthy: probe success
  Unhealthy --> Healthy: recovered
  Unhealthy --> [*]: removed`,
	},

	// ── Security ────────────────────────────────────────────────────────────
	{
		id: "waf-evaluation",
		prompt: "Diagram how the App Firewall evaluates a request and either blocks or allows it.",
		category: "Security",
		type: "flowchart",
		source: `graph TD
  R[Incoming Request] --> Sig{Signature Match}
  Sig -->|attack| Block[Block 403]
  Sig -->|clean| Score{Threat Score}
  Score -->|high| Block
  Score -->|low| Allow[Forward to Origin]`,
	},
	{
		id: "service-policy-rules",
		prompt: "Show how a Service Policy evaluates rules in order to allow or deny a client.",
		category: "Security",
		type: "flowchart",
		source: `graph TD
  Req[Request] --> R1{Rule 1: IP allowlist}
  R1 -->|no match| R2{Rule 2: rate limit}
  R1 -->|deny| Deny[Deny]
  R2 -->|exceeded| Deny
  R2 -->|ok| R3{Rule 3: geo block}
  R3 -->|blocked country| Deny
  R3 -->|allow| Allow[Allow]`,
	},
	{
		id: "bot-defense",
		prompt: "Diagram Bot Defense classifying traffic into human, good bot, and malicious automation.",
		category: "Security",
		type: "flowchart",
		source: `graph LR
  T[Traffic] --> BD[Bot Defense]
  BD --> C{Classification}
  C -->|human| Pass[Allow]
  C -->|good bot| Pass
  C -->|automation| Mitigate{Mitigation}
  Mitigate -->|block| Block[Block]
  Mitigate -->|flag| Log[Log and Continue]`,
	},
	{
		id: "api-protection",
		prompt: "Show API Protection discovering endpoints and enforcing an API schema.",
		category: "Security",
		type: "flowchart",
		source: `graph LR
  API[API Traffic] --> Disc[Endpoint Discovery]
  Disc --> Inv[API Inventory]
  Inv --> Val{Schema Validation}
  Val -->|valid| Fwd[Forward]
  Val -->|invalid| Rej[Reject 400]`,
	},
	{
		id: "mtls-handshake",
		prompt: "Show the mTLS handshake between a client and an F5 XC Load Balancer.",
		category: "Security",
		type: "sequence",
		source: `sequenceDiagram
  participant C as Client
  participant LB as XC Load Balancer
  participant O as Origin
  C->>LB: ClientHello
  LB->>C: ServerHello + Certificate
  C->>LB: Client Certificate
  LB->>C: Verify + Finished
  C->>LB: Application Data
  LB->>O: Forward (origin TLS)
  O-->>LB: Response
  LB-->>C: Response`,
	},
	{
		id: "client-side-defense",
		prompt: "Diagram Client-Side Defense monitoring third-party scripts on a web page.",
		category: "Security",
		type: "flowchart",
		source: `graph TD
  Page[Web Page] --> CSD[Client-Side Defense]
  CSD --> Scan{Script Inventory}
  Scan -->|known| OK[Approved Script]
  Scan -->|new| Review[Flag for Review]
  Scan -->|exfil detected| Alert[Alert and Block]`,
	},

	// ── Sites & networking ──────────────────────────────────────────────────
	{
		id: "secure-mesh-site",
		prompt: "Show a Secure Mesh Site connecting an on-prem network to Regional Edges.",
		category: "Sites & Networking",
		type: "flowchart",
		source: `graph LR
  OnPrem[On-Prem Network] --> CE[Secure Mesh Site CE]
  CE --> Tunnel[IPsec / SSL Tunnel]
  Tunnel --> RE1[Regional Edge us-east]
  Tunnel --> RE2[Regional Edge eu-west]
  RE1 --> Global[Global Network]
  RE2 --> Global`,
	},
	{
		id: "multicloud-mesh",
		prompt: "Diagram a multi-cloud mesh across AWS, Azure, GCP, and on-prem sites via the XC global network.",
		category: "Sites & Networking",
		type: "flowchart",
		source: `graph TD
  Global[XC Global Network]
  Global --> AWS[AWS VPC Site]
  Global --> Azure[Azure VNet Site]
  Global --> GCP[GCP VPC Site]
  Global --> DC[On-Prem Data Center]
  AWS --> AppA[App Workload]
  Azure --> AppB[App Workload]
  GCP --> AppC[App Workload]`,
	},
	{
		id: "virtual-site-grouping",
		prompt: "Show how a Virtual Site groups several Customer Edge sites by label for deployment.",
		category: "Sites & Networking",
		type: "flowchart",
		source: `graph TD
  VS[Virtual Site: prod-edge] --> L{Label Selector}
  L -->|site=ce-1| CE1[CE Site 1]
  L -->|site=ce-2| CE2[CE Site 2]
  L -->|site=ce-3| CE3[CE Site 3]
  VS --> Deploy[Deploy Load Balancer]`,
	},
	{
		id: "fleet-config",
		prompt: "Diagram a Fleet applying common configuration to all member Customer Edge sites.",
		category: "Sites & Networking",
		type: "flowchart",
		source: `graph LR
  Fleet[Fleet: retail-stores] --> Cfg[Fleet Config]
  Cfg --> N[Network Interfaces]
  Cfg --> S[Storage]
  Cfg --> Sec[Security Policy]
  Fleet --> Members{Members}
  Members --> Store1[Store CE 1]
  Members --> Store2[Store CE 2]`,
	},
	{
		id: "segment-connector",
		prompt: "Show network segmentation connecting two segments through a Segment Connector with a firewall policy.",
		category: "Sites & Networking",
		type: "flowchart",
		source: `graph LR
  SegA[Segment: prod] --> Conn[Segment Connector]
  SegB[Segment: shared] --> Conn
  Conn --> FW{Firewall Policy}
  FW -->|allow| Route[Route Traffic]
  FW -->|deny| Drop[Drop]`,
	},
	{
		id: "bgp-peering",
		prompt: "Diagram BGP peering between a Customer Edge site and two on-prem routers.",
		category: "Sites & Networking",
		type: "flowchart",
		source: `graph LR
  CE[Customer Edge] --> BGP{BGP}
  BGP -->|AS 65001| R1[Router A]
  BGP -->|AS 65001| R2[Router B]
  R1 --> Core[Core Network]
  R2 --> Core`,
	},
	{
		id: "vnet-peering",
		prompt: "Show an Azure VNet site peered into the XC global network reaching a private app.",
		category: "Sites & Networking",
		type: "flowchart",
		source: `graph LR
  VNet[Azure VNet Site] --> Peer[VNet Peering]
  Peer --> XC[XC Global Network]
  XC --> LB[Internal HTTP LB]
  LB --> App[Private App]`,
	},

	// ── Customer Edge lifecycle ─────────────────────────────────────────────
	{
		id: "ce-registration",
		prompt: "Show the registration handshake when a new Customer Edge node comes online.",
		category: "Customer Edge",
		type: "sequence",
		source: `sequenceDiagram
  participant CE as Customer Edge
  participant RE as Regional Edge
  participant CP as XC Control Plane
  CE->>RE: Register (token)
  RE->>CP: Validate token
  CP-->>RE: Approved
  RE-->>CE: Config bundle
  CE->>RE: Heartbeat
  RE-->>CE: Ack`,
	},
	{
		id: "ce-lifecycle-state",
		prompt: "Diagram the lifecycle states of a Customer Edge site from pending to online and upgrading.",
		category: "Customer Edge",
		type: "state",
		source: `stateDiagram-v2
  [*] --> Pending
  Pending --> Registered: token accepted
  Registered --> Online: tunnels up
  Online --> Upgrading: new SW version
  Upgrading --> Online: upgrade complete
  Online --> Offline: heartbeat lost
  Offline --> Online: recovered`,
	},

	// ── Service mesh ────────────────────────────────────────────────────────
	{
		id: "service-mesh-sidecar",
		prompt: "Show service-to-service traffic through sidecar proxies with mTLS in the service mesh.",
		category: "Service Mesh",
		type: "flowchart",
		source: `graph LR
  SvcA[Service A] --> PxA[Sidecar Proxy A]
  PxA --> mTLS[mTLS]
  mTLS --> PxB[Sidecar Proxy B]
  PxB --> SvcB[Service B]`,
	},
	{
		id: "request-lifecycle",
		prompt: "Walk through the full request lifecycle from client to origin across the XC data plane.",
		category: "Service Mesh",
		type: "sequence",
		source: `sequenceDiagram
  participant U as User
  participant RE as Regional Edge
  participant W as App Firewall
  participant SP as Service Policy
  participant O as Origin Pool
  U->>RE: HTTPS request
  RE->>W: Inspect
  W->>SP: Evaluate policy
  SP->>O: Forward
  O-->>RE: Response
  RE-->>U: Response`,
	},

	// ── Identity & tenancy ──────────────────────────────────────────────────
	{
		id: "tenant-namespace-rbac",
		prompt: "Diagram how a Tenant contains Namespaces and how Users get roles via RBAC.",
		category: "Identity & Tenancy",
		type: "flowchart",
		source: `graph TD
  Tenant[Tenant] --> NS1[Namespace: shared]
  Tenant --> NS2[Namespace: app-team]
  Tenant --> Users{Users}
  Users -->|role: admin| Admin[Admin]
  Users -->|role: developer| Dev[Developer]
  Admin --> NS1
  Dev --> NS2`,
	},
	{
		id: "tenancy-er",
		prompt: "Show the data model relating tenant, namespace, load balancer, origin pool, and origin.",
		category: "Identity & Tenancy",
		type: "er",
		source: `erDiagram
  TENANT ||--o{ NAMESPACE : contains
  NAMESPACE ||--o{ LOAD_BALANCER : hosts
  LOAD_BALANCER ||--o{ ROUTE : has
  LOAD_BALANCER }o--|| ORIGIN_POOL : uses
  ORIGIN_POOL ||--o{ ORIGIN : includes
  ORIGIN_POOL ||--|| HEALTH_CHECK : monitored_by`,
	},

	// ── Object model ────────────────────────────────────────────────────────
	{
		id: "lb-object-model",
		prompt: "Show the object model of an HTTP Load Balancer and the resources it references.",
		category: "Object Model",
		type: "class",
		source: `classDiagram
  class HttpLoadBalancer {
    +string name
    +list domains
    +AdvertisePolicy advertise
  }
  class OriginPool {
    +string name
    +int port
    +LoadBalancingAlgo algo
  }
  class HealthCheck {
    +int interval
    +int timeout
  }
  HttpLoadBalancer --> OriginPool
  OriginPool --> HealthCheck`,
	},
	{
		id: "security-object-model",
		prompt: "Diagram the relationship between an App Firewall, Service Policy, and Rate Limiter objects.",
		category: "Object Model",
		type: "class",
		source: `classDiagram
  class AppFirewall {
    +string mode
    +bool blocking
  }
  class ServicePolicy {
    +list rules
  }
  class RateLimiter {
    +int requests
    +string window
  }
  AppFirewall --> ServicePolicy
  ServicePolicy --> RateLimiter`,
	},

	// ── Certificates ────────────────────────────────────────────────────────
	{
		id: "cert-lifecycle",
		prompt: "Show the lifecycle of a managed TLS certificate from request through renewal.",
		category: "Certificates",
		type: "state",
		source: `stateDiagram-v2
  [*] --> Requested
  Requested --> Validating: ACME challenge
  Validating --> Issued: validated
  Issued --> Active: bound to LB
  Active --> Renewing: near expiry
  Renewing --> Active: renewed
  Active --> Expired: renewal failed`,
	},

	// ── App stack ───────────────────────────────────────────────────────────
	{
		id: "app-stack-vk8s",
		prompt: "Diagram an App Stack (vK8s) site running workloads exposed by an XC Load Balancer.",
		category: "App Stack",
		type: "flowchart",
		source: `graph TD
  Site[App Stack Site] --> vK8s[Virtual Kubernetes]
  vK8s --> D1[Deployment: web]
  vK8s --> D2[Deployment: api]
  D1 --> Svc[Service]
  D2 --> Svc
  Svc --> LB[HTTP Load Balancer]
  LB --> User[User]`,
	},

	// ── Observability (xychart) ─────────────────────────────────────────────
	{
		id: "requests-per-min",
		prompt: "Chart requests per minute hitting a Load Balancer over a six-interval window.",
		category: "Observability",
		type: "xychart",
		source: `xychart-beta
  title "Requests per minute"
  x-axis [t1, t2, t3, t4, t5, t6]
  y-axis "Requests" 0 --> 1000
  bar [120, 340, 560, 820, 640, 480]`,
	},
	{
		id: "latency-trend",
		prompt: "Plot p95 latency in milliseconds across regions over time.",
		category: "Observability",
		type: "xychart",
		source: `xychart-beta
  title "p95 latency (ms)"
  x-axis [09:00, 10:00, 11:00, 12:00, 13:00]
  y-axis "ms" 0 --> 200
  line [45, 60, 120, 90, 70]`,
	},
	{
		id: "waf-blocks-trend",
		prompt: "Chart the number of App Firewall blocks per hour during an attack window.",
		category: "Observability",
		type: "xychart",
		source: `xychart-beta
  title "WAF blocks per hour"
  x-axis [h1, h2, h3, h4, h5]
  y-axis "Blocks" 0 --> 5000
  bar [200, 800, 4200, 3600, 900]`,
	},

	// ── More flowcharts for breadth ─────────────────────────────────────────
	{
		id: "cdn-distribution",
		prompt: "Show a CDN Distribution serving cached content and falling back to the origin on a miss.",
		category: "Load Balancing",
		type: "flowchart",
		source: `graph LR
  User[User] --> CDN[CDN Distribution]
  CDN --> Cache{Cache}
  Cache -->|hit| Serve[Serve Cached]
  Cache -->|miss| Origin[Origin Pool]
  Origin --> Fill[Fill Cache]
  Fill --> Serve`,
	},
	{
		id: "ddos-mitigation",
		prompt: "Diagram volumetric DDoS mitigation scrubbing traffic before it reaches the Load Balancer.",
		category: "Security",
		type: "flowchart",
		source: `graph LR
  Internet[Internet] --> Scrub[DDoS Scrubbing]
  Scrub --> D{Anomaly?}
  D -->|attack| Drop[Drop Traffic]
  D -->|legit| Clean[Clean Traffic]
  Clean --> LB[Load Balancer]`,
	},
	{
		id: "ip-reputation",
		prompt: "Show how IP reputation and an allow/deny list gate inbound clients.",
		category: "Security",
		type: "flowchart",
		source: `graph TD
  Client[Client IP] --> Rep{IP Reputation}
  Rep -->|malicious| Block[Block]
  Rep -->|unknown| List{Allow/Deny List}
  List -->|deny| Block
  List -->|allow| Proceed[Proceed to LB]`,
	},
	{
		id: "global-namespace-lb",
		prompt:
			"Diagram one HTTP Load Balancer in a namespace advertising an app across regional edges to users worldwide.",
		category: "Load Balancing",
		type: "flowchart",
		source: `graph TD
  NS[Namespace: app-prod] --> LB[HTTP Load Balancer]
  LB --> RE1[RE North America]
  LB --> RE2[RE Europe]
  LB --> RE3[RE Asia]
  RE1 --> U1[Users NA]
  RE2 --> U2[Users EU]
  RE3 --> U3[Users APAC]`,
	},
];
