# @f5-sales-demo/xcsh

Core implementation package for the `xcsh` coding agent in the `xcsh` monorepo.

For installation, setup, provider configuration, model roles, slash commands, and full CLI reference, see:

- [Monorepo README (local)](../../README.md)
- [Monorepo README (GitHub)](https://github.com/f5-sales-demo/xcsh#readme)

Package-specific references:

- [CHANGELOG](./CHANGELOG.md)
- [MCP configuration guide](../../docs/mcp-config.md)
- [MCP runtime lifecycle](../../docs/mcp-runtime-lifecycle.md)
- [MCP server/tool authoring](../../docs/mcp-server-tool-authoring.md)
- [Remote-control implementation](./src/remote-control/IMPLEMENTATION.md)
- [Remote-control acceptance](./src/remote-control/ACCEPTANCE.md)
- [CONTRIBUTING](../../CONTRIBUTING.md)

Remote control is managed explicitly with `xcsh remote-control enable`,
`restart`, `status`, and `disable`. Linux installations reconcile an owner-only
systemd user supervisor so enabled sessions recover after login, reboot, or host
failure; `disable` persists the stopped state.
