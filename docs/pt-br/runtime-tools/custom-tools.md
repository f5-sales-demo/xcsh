---
title: Ferramentas Personalizadas
description: >-
  Registro de ferramentas personalizadas, definição de esquema e pipeline de
  execução para estender o agente.
sidebar:
  order: 4
  label: Ferramentas personalizadas
i18n:
  sourceHash: 4557bc868e23
  translator: machine
---

# Ferramentas Personalizadas

Ferramentas personalizadas são funções chamáveis pelo modelo que se conectam ao mesmo pipeline de execução de ferramentas que as ferramentas integradas.

Uma ferramenta personalizada é um módulo TypeScript/JavaScript que exporta uma factory. A factory recebe uma API do host (`CustomToolAPI`) e retorna uma ferramenta ou um array de ferramentas.

## O que isso é (e o que não é)

- **Ferramenta personalizada**: chamável pelo modelo durante um turno (`execute` + esquema TypeBox).
- **Extensão**: framework de ciclo de vida/eventos que pode registrar ferramentas e interceptar/modificar eventos.
- **Hook**: scripts externos de pré/pós comando.
- **Skill**: pacote estático de orientação/contexto, não código de ferramenta executável.

Se você precisa que o modelo chame código diretamente, use uma ferramenta personalizada.

## Caminhos de integração no código atual

Existem dois estilos de integração ativos:

1. **Ferramentas personalizadas fornecidas pelo SDK** (`options.customTools`)
   - Encapsuladas em ferramentas do agente via `CustomToolAdapter` ou wrappers de extensão.
   - Sempre incluídas no conjunto inicial de ferramentas ativas no bootstrap do SDK.

2. **Módulos descobertos no sistema de arquivos via API de carregamento** (`discoverAndLoadCustomTools` / `loadCustomTools`)
   - Expostos como APIs de biblioteca em `src/extensibility/custom-tools/loader.ts`.
   - O código host pode chamá-los para descobrir e carregar módulos de ferramentas a partir de caminhos de configuração/provedor/plugin.

```text
Model tool call flow

LLM tool call
   │
   ▼
Tool registry (built-ins + custom tool adapters)
   │
   ▼
CustomTool.execute(toolCallId, params, onUpdate, ctx, signal)
   │
   ├─ onUpdate(...)  -> streamed partial result
   └─ return result  -> final tool content/details
```

## Locais de descoberta (API de carregamento)

`discoverAndLoadCustomTools(configuredPaths, cwd, builtInToolNames)` mescla:

1. Provedores de capacidade (`toolCapability`), incluindo:
   - Configuração nativa OMP (`~/.xcsh/agent/tools`, `.xcsh/tools`)
   - Configuração Claude (`~/.claude/tools`, `.claude/tools`)
   - Configuração Codex (`~/.codex/tools`, `.codex/tools`)
   - Provedor de cache de plugins do marketplace Claude
2. Manifestos de plugins instalados (`~/.xcsh/plugins/node_modules/*` via carregador de plugins)
3. Caminhos configurados explicitamente passados ao carregador

### Comportamento importante

- Caminhos resolvidos duplicados são deduplicados.
- Conflitos de nomes de ferramentas são rejeitados contra ferramentas integradas e ferramentas personalizadas já carregadas.
- Arquivos `.md` e `.json` são descobertos como metadados de ferramentas por alguns provedores, mas o carregador de módulos executáveis os rejeita como ferramentas executáveis.
- Caminhos configurados relativos são resolvidos a partir de `cwd`; `~` é expandido.

## Contrato do módulo

Um módulo de ferramenta personalizada deve exportar uma função (exportação padrão preferida):

```ts
import type { CustomToolFactory } from "@f5-sales-demo/xcsh";

const factory: CustomToolFactory = (pi) => ({
 name: "repo_stats",
 label: "Repo Stats",
 description: "Counts tracked TypeScript files",
 parameters: pi.typebox.Type.Object({
  glob: pi.typebox.Type.Optional(pi.typebox.Type.String({ default: "**/*.ts" })),
 }),

 async execute(toolCallId, params, onUpdate, ctx, signal) {
  onUpdate?.({
   content: [{ type: "text", text: "Scanning files..." }],
   details: { phase: "scan" },
  });

  const result = await pi.exec("git", ["ls-files", params.glob ?? "**/*.ts"], { signal, cwd: pi.cwd });
  if (result.killed) {
   throw new Error("Scan was cancelled");
  }
  if (result.code !== 0) {
   throw new Error(result.stderr || "git ls-files failed");
  }

  const files = result.stdout.split("\n").filter(Boolean);
  return {
   content: [{ type: "text", text: `Found ${files.length} files` }],
   details: { count: files.length, sample: files.slice(0, 10) },
  };
 },

 onSession(event) {
  if (event.reason === "shutdown") {
   // cleanup resources if needed
  }
 },
});

export default factory;
```

Tipo de retorno da factory:

- `CustomTool`
- `CustomTool[]`
- `Promise<CustomTool | CustomTool[]>`

## Superfície da API passada às factories (`CustomToolAPI`)

De `types.ts` e `loader.ts`:

- `cwd`: diretório de trabalho do host
- `exec(command, args, options?)`: auxiliar de execução de processos
- `ui`: contexto de UI (pode ser no-op em modos headless)
- `hasUI`: `false` em fluxos não interativos
- `logger`: logger de arquivo compartilhado
- `typebox`: `@sinclair/typebox` injetado
- `pi`: exportações de `@f5-sales-demo/xcsh` injetadas
- `pushPendingAction(action)`: registra uma ação de pré-visualização para a ferramenta oculta `resolve` (`docs/resolve-tool-runtime.md`)

O carregador inicia com um contexto de UI no-op e requer que o código host chame `setUIContext(...)` quando a UI real estiver pronta.

## Contrato de execução e tipagem

Assinatura de `CustomTool.execute`:

```ts
execute(toolCallId, params, onUpdate, ctx, signal)
```

- `params` é tipado estaticamente a partir do seu esquema TypeBox via `Static<TParams>`.
- A validação dos argumentos em tempo de execução ocorre antes da execução no loop do agente.
- `onUpdate` emite resultados parciais para streaming na UI.
- `ctx` inclui estado de sessão/modelo e um auxiliar `abort()`.
- `signal` carrega o cancelamento.

`CustomToolAdapter` faz a ponte para a interface de ferramenta do agente e encaminha as chamadas na ordem correta de argumentos.

## Como as ferramentas são expostas ao modelo

- As ferramentas são encapsuladas em instâncias `AgentTool` (`CustomToolAdapter` ou wrappers de extensão).
- Elas são inseridas no registro de ferramentas da sessão por nome.
- No bootstrap do SDK, ferramentas personalizadas e registradas por extensão são forçosamente incluídas no conjunto ativo inicial.
- O CLI `--tools` atualmente valida apenas nomes de ferramentas integradas; a inclusão de ferramentas personalizadas é tratada através dos caminhos de descoberta/registro e opções do SDK.

## Hooks de renderização

Hooks de renderização opcionais:

- `renderCall(args, theme)`
- `renderResult(result, options, theme, args?)`

Comportamento em tempo de execução na TUI:

- Se os hooks existirem, a saída da ferramenta é renderizada dentro de um contêiner `Box`.
- `renderResult` recebe `{ expanded, isPartial, spinnerFrame? }`.
- Erros do renderizador são capturados e registrados em log; a UI recorre à renderização de texto padrão.

## Tratamento de sessão/estado

O `onSession(event, ctx)` opcional recebe eventos de ciclo de vida da sessão, incluindo:

- `start`, `switch`, `branch`, `tree`, `shutdown`
- `auto_compaction_start`, `auto_compaction_end`
- `auto_retry_start`, `auto_retry_end`
- `ttsr_triggered`, `todo_reminder`

Use `ctx.sessionManager` para reconstruir o estado a partir do histórico quando o contexto de branch/sessão mudar.

## Semântica de falhas e cancelamento

### Falhas síncronas/assíncronas

- Lançar exceções (ou promises rejeitadas) em `execute` é tratado como falha da ferramenta.
- O runtime do agente converte falhas em mensagens de resultado da ferramenta com `isError: true` e conteúdo de texto do erro.
- Com wrappers de extensão, handlers de `tool_result` podem ainda reescrever conteúdo/detalhes e até sobrescrever o status de erro.

### Cancelamento

- O abort do agente se propaga através do `AbortSignal` para `execute`.
- Encaminhe `signal` para trabalho de subprocesso (`pi.exec(..., { signal })`) para cancelamento cooperativo.
- `ctx.abort()` permite que uma ferramenta solicite o abort da operação atual do agente.

### Erros em onSession

- Erros em `onSession` são capturados e registrados como avisos; eles não causam crash na sessão.

## Restrições reais para considerar no design

- Nomes de ferramentas devem ser globalmente únicos no registro ativo.
- Prefira saídas determinísticas e formatadas conforme o esquema em `details` para reconstrução de renderizador/estado.
- Proteja o uso de UI com `pi.hasUI`.
- Trate `.md`/`.json` em diretórios de ferramentas como metadados, não como módulos executáveis.
