// AUTO-GENERATED — do not edit. Run `bun generate-sitecli-index` to regenerate.
//
// Source: f5-sales-demo/mcn sitecli/catalog.json, captured from a live Customer Edge.
// The command surface depends on the node software build, so SITECLI_BUILD records
// which build this describes.

export const SITECLI_BUILD = "crt-20250613-3382";

export const SITECLI_SOURCE = {
	node: "f5-xc-ce-vm-01",
	site: "ar-bgp-eastus01",
} as const;

export const SITECLI_COMMANDS = {
	"chronyc-sources": {
		category: "Network Troubleshooting",
		tier: "ExecUser",
		transport: "exec-user",
		mutating: false,
	},
	"crictl-images": {
		category: "System Troubleshooting",
		tier: "ExecUser",
		transport: "exec-user",
		mutating: false,
	},
	"crictl-inspect": {
		category: "System Troubleshooting",
		tier: "ExecUser",
		transport: "exec-user",
		mutating: false,
		example: "container-id",
	},
	"crictl-logs": {
		category: "System Troubleshooting",
		tier: "ExecUser",
		transport: "exec-user",
		mutating: false,
		example: "container-id",
	},
	"crictl-ps": {
		category: "System Troubleshooting",
		tier: "ExecUser",
		transport: "exec-user",
		mutating: false,
	},
	"crictl-ps-a": {
		category: "System Troubleshooting",
		tier: "ExecUser",
		transport: "exec-user",
		mutating: false,
	},
	"curl-host": {
		category: "Network Troubleshooting",
		tier: "ExecUser",
		transport: "exec-user",
		mutating: false,
		example: "-v cloud.f5.com",
	},
	"curl-vega": {
		category: "Network Troubleshooting",
		tier: "ExecUser",
		transport: "exec-user",
		mutating: false,
		example: "-v cloud.f5.com",
	},
	diagnosis: {
		category: "System Troubleshooting",
		tier: "ExecUser",
		transport: "global-get",
		mutating: false,
		example: "no argument needed",
		scope: "GLOBAL",
	},
	dig: {
		category: "Network Troubleshooting",
		tier: "ExecUser",
		transport: "exec-user",
		mutating: false,
		example: "@192.168.0.2 http://volterra.azurecr.io",
	},
	"docker-images": {
		category: "System Troubleshooting",
		tier: "ExecUser",
		transport: "exec-user",
		mutating: false,
	},
	"docker-inspect": {
		category: "System Troubleshooting",
		tier: "ExecUser",
		transport: "exec-user",
		mutating: false,
		example: "container-id OR name",
	},
	"docker-logs": {
		category: "System Troubleshooting",
		tier: "ExecUser",
		transport: "exec-user",
		mutating: false,
		example: "container-id OR name",
	},
	"docker-ps": {
		category: "System Troubleshooting",
		tier: "ExecUser",
		transport: "exec-user",
		mutating: false,
	},
	"docker-ps-a": {
		category: "System Troubleshooting",
		tier: "ExecUser",
		transport: "exec-user",
		mutating: false,
	},
	dropstats: {
		category: "Network Troubleshooting",
		tier: "ExecUser",
		transport: "exec-user",
		mutating: false,
	},
	"dropstats-non-zero": {
		category: "Network Troubleshooting",
		tier: "ExecUser",
		transport: "exec-user",
		mutating: false,
	},
	"flow-l": {
		category: "Network Troubleshooting",
		tier: "ExecUser",
		transport: "exec-user",
		mutating: false,
	},
	"flow-l-match": {
		category: "Network Troubleshooting",
		tier: "ExecUser",
		transport: "exec-user",
		mutating: false,
		example: "100.127.192.10:53",
	},
	health: {
		category: "System Troubleshooting",
		tier: "ExecUser",
		transport: "global-get",
		mutating: false,
		example: "no argument needed",
		scope: "GLOBAL",
	},
	ip: {
		category: "Network Troubleshooting",
		tier: "ExecUser",
		transport: "exec-user",
		mutating: false,
		example: "help OR addr",
	},
	"ip-link-set": {
		category: "Network Troubleshooting",
		tier: "Exec",
		transport: "exec",
		mutating: true,
		example: "(<device>||<group>) (up||down)",
	},
	"ip-link-show": {
		category: "Network Troubleshooting",
		tier: "ExecUser",
		transport: "exec-user",
		mutating: false,
	},
	"ipsec-status": {
		category: "Network Troubleshooting",
		tier: "ExecUser",
		transport: "exec-user",
		mutating: false,
	},
	"ipsec-statusall": {
		category: "Network Troubleshooting",
		tier: "ExecUser",
		transport: "exec-user",
		mutating: false,
	},
	journalctl: {
		category: "System Troubleshooting",
		tier: "ExecUser",
		transport: "exec-user",
		mutating: false,
		example: "-u vpm -n 200",
	},
	netstat: {
		category: "Network Troubleshooting",
		tier: "ExecUser",
		transport: "exec-user",
		mutating: false,
	},
	nh: {
		category: "Network Troubleshooting",
		tier: "ExecUser",
		transport: "exec-user",
		mutating: false,
		example: "--help OR --list",
	},
	rt: {
		category: "Network Troubleshooting",
		tier: "ExecUser",
		transport: "exec-user",
		mutating: false,
		example: "--help OR --dump $vrf-id OR --get $ipv4 --vrf $vrf-id",
	},
	"show-ip-bgp": {
		category: "Network Troubleshooting",
		tier: "ExecUser",
		transport: "exec-user",
		mutating: false,
	},
	"show-ip-bgp-neighbors": {
		category: "Network Troubleshooting",
		tier: "ExecUser",
		transport: "exec-user",
		mutating: false,
	},
	"show-ip-bgp-neighbors-advertised-route": {
		category: "Network Troubleshooting",
		tier: "ExecUser",
		transport: "exec-user",
		mutating: false,
	},
	"show-ip-bgp-summary": {
		category: "Network Troubleshooting",
		tier: "ExecUser",
		transport: "exec-user",
		mutating: false,
	},
	vif: {
		category: "Network Troubleshooting",
		tier: "ExecUser",
		transport: "exec-user",
		mutating: false,
		example: "--list",
	},
} as const;
