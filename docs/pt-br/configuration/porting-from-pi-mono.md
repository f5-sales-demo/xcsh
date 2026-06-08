---
title: 'Portando do pi-mono: Um Guia Prático de Merge'
description: >-
  Guia prático para migração de código do monorepo pi-mono para a base de código
  xcsh.
sidebar:
  order: 9
  label: Portando do pi-mono
i18n:
  sourceHash: dbba6f6c0987
  translator: machine
---

# Portando do pi-mono: Um Guia Prático de Merge

Este guia é um checklist repetível para portar alterações do pi-mono para este repositório.
Utilize-o para qualquer merge: arquivo único, branch de feature ou sincronização completa de release.

## Último Ponto de Sincronização

**Commit:** `b21b42d032919de2f2e6920a76fa9a37c3920c0a`
**Data:** 2026-03-22

Atualize esta seção após cada sincronização; não reutilize o intervalo anterior.

Ao iniciar uma nova sincronização, gere patches a partir deste commit:

```bash
git format-patch b21b42d032919de2f2e6920a76fa9a37c3920c0a..HEAD --stdout > changes.patch
```

## 0) Defina o escopo

- Identifique a referência upstream (commit, tag ou PR).
- Liste os pacotes ou pastas que você planeja alterar.
- Decida quais funcionalidades estão no escopo e quais são intencionalmente ignoradas.

## 1) Traga o código de forma segura

- Prefira um diff limpo e focado em vez de uma cópia integral.
- Evite copiar artefatos de build ou arquivos gerados.
- Se o upstream adicionou novos arquivos, adicione-os explicitamente e revise o conteúdo.

## 2) Siga as convenções de extensão de importação

A maioria dos fontes TypeScript de runtime omite `.js` em importações internas, mas alguns entrypoints de test/bench mantêm `.js` para compatibilidade com runtime ESM. Siga o estilo existente do pacote local; não remova extensões indiscriminadamente.

- Em fontes de runtime de `packages/coding-agent`, mantenha importações internas sem extensão, a menos que esteja importando assets não-TS.
- Em `packages/tui/test` e `packages/natives/bench`, mantenha `.js` onde os arquivos ao redor já o utilizam.
- Mantenha extensões de arquivo reais quando exigidas pela ferramenta (ex.: `.json`, `.css`, embeds de texto `.md`).
- Exemplo: `import { x } from "./foo.js";` → `import { x } from "./foo";` (somente quando a convenção do pacote é sem extensão).

## 3) Substitua os escopos de importação

O upstream utiliza escopos de pacote diferentes. Substitua-os consistentemente.

- Substitua os escopos antigos pelo escopo local utilizado aqui.
- Exemplos (ajuste para corresponder aos pacotes reais que você está portando):
  - `@mariozechner/pi-coding-agent` → `@f5xc-salesdemos/xcsh`
  - `@mariozechner/pi-agent-core` → `@f5xc-salesdemos/pi-agent-core`
  - `@mariozechner/pi-tui` → `@f5xc-salesdemos/pi-tui`
  - `@mariozechner/pi-ai` → `@f5xc-salesdemos/pi-ai`

## 4) Use APIs do Bun quando melhoram em relação ao Node

Executamos no Bun. Substitua APIs do Node apenas quando o Bun fornecer uma alternativa melhor.

**SUBSTITUA:**

- Criação de processos: `child_process.spawn` → Bun Shell `$` para comandos simples, `Bun.spawn`/`Bun.spawnSync` para streaming ou trabalho de longa duração
- I/O de arquivo: `fs.readFileSync` → `Bun.file().text()` / `Bun.write()`
- Clientes HTTP: `node-fetch`, `axios` → `fetch` nativo
- Hashing criptográfico: `node:crypto` → Web Crypto ou `Bun.hash`
- SQLite: `better-sqlite3` → `bun:sqlite`
- Carregamento de env: `dotenv` → Bun carrega `.env` automaticamente

**NÃO SUBSTITUA (funcionam perfeitamente no Bun):**

- `os.homedir()` — NÃO substitua por `Bun.env.HOME`, `Bun.env.HOME` ou literal `"~"`
- `os.tmpdir()` — NÃO substitua por `Bun.env.TMPDIR || "/tmp"` ou caminhos hardcoded
- `fs.mkdtempSync()` — NÃO substitua por construção manual de caminho
- `path.join()`, `path.resolve()`, etc. — estão adequados

**Estilo de importação:** Use o prefixo `node:` apenas com importações de namespace (sem importações nomeadas de `node:fs` ou `node:path`).

**Convenções adicionais do Bun:**

- Prefira Bun Shell `$` para comandos curtos e sem streaming; use `Bun.spawn` apenas quando precisar de streaming I/O ou controle de processo.
- Use `Bun.file()`/`Bun.write()` para arquivos e `node:fs/promises` para diretórios.
- Evite verificações `Bun.file().exists()`; use tratamento `isEnoent` em try/catch.
- Prefira `Bun.sleep(ms)` em vez de wrappers de `setTimeout`.

**Incorreto:**

```typescript
// QUEBRADO: variáveis de ambiente podem ser undefined, "~" não é expandido
const home = Bun.env.HOME || "~";
const tmp = Bun.env.TMPDIR || "/tmp";
```

**Correto:**

```typescript
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";

const configDir = path.join(os.homedir(), ".config", "myapp");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "myapp-"));
```

## 5) Prefira embeds do Bun (sem cópia)

Não copie assets de runtime ou arquivos vendor no momento do build.

- Se o upstream copia assets para uma pasta dist, substitua por embeds compatíveis com Bun.
- Prompts são arquivos `.md` estáticos; use importações de texto do Bun (`with { type: "text" }`) e Handlebars em vez de strings de prompt inline.
- Use `import.meta.dir` + `Bun.file` para carregar recursos adjacentes não-texto.
- Mantenha assets no repositório e deixe o bundler incluí-los.
- Elimine scripts de cópia, a menos que o usuário solicite explicitamente.
- Se o upstream lê um arquivo de fallback empacotado em runtime, substitua leituras do filesystem por uma importação de embed de texto do Bun.
  - Exemplo (fallback de instruções Codex):
    - `const FALLBACK_PROMPT_PATH = join(import.meta.dir, "codex-instructions.md");` -> removido
    - `import FALLBACK_INSTRUCTIONS from "./codex-instructions.md" with { type: "text" };`
    - Use `return FALLBACK_INSTRUCTIONS;` em vez de `readFileSync(FALLBACK_PROMPT_PATH, "utf8")`

## 6) Porte `package.json` com cuidado

Trate `package.json` como um contrato. Faça merge intencionalmente.

- Mantenha `name`, `version`, `type`, `exports` e `bin` existentes, a menos que a portagem exija alterações.
- Substitua scripts npm/node por equivalentes Bun (ex.: `bun check`, `bun test`).
- Garanta que as dependências usem o escopo correto.
- Não faça downgrade de dependências para corrigir erros de tipo; faça upgrade em vez disso.
- Valide links de pacotes do workspace e `peerDependencies`.

## 7) Alinhe estilo de código e ferramentas

- Mantenha as convenções de formatação existentes.
- Não introduza `any` a menos que seja necessário.
- Evite importações dinâmicas e importações inline de tipo; use apenas importações de nível superior.
- Nunca construa prompts no código; prompts são arquivos `.md` estáticos renderizados com Handlebars.
- No coding-agent, nunca use `console.log`/`console.warn`/`console.error`; use `logger` de `@f5xc-salesdemos/pi-utils`.
- Use `Promise.withResolvers()` em vez de `new Promise((resolve, reject) => ...)`.
- **Sem palavras-chave `private`/`protected`/`public` em campos ou métodos de classe.** Use campos privados ES `#` para encapsulamento; deixe membros acessíveis sem palavra-chave. A única exceção são propriedades de parâmetro de construtor (`constructor(private readonly x: T)`), onde a palavra-chave é exigida pelo TypeScript. Ao portar código upstream que usa `private foo` ou `protected bar`, converta para `#foo` (privado) ou `bar` simples (acessível).
- Prefira helpers e utilitários existentes em vez de código ad-hoc novo.
- Preserve as alterações de infraestrutura Bun-first já feitas neste repositório:
  - Runtime é Bun (sem entry points Node).
  - Gerenciador de pacotes é Bun (sem lockfiles npm).
  - APIs pesadas do Node (`child_process`, `readline`) são substituídas por equivalentes Bun.
  - APIs leves do Node (`os.homedir`, `os.tmpdir`, `fs.mkdtempSync`, `path.*`) são mantidas.
  - Shebangs de CLI usam `bun` (não `node`, não `tsx`).
  - Pacotes usam arquivos fonte diretamente (sem etapa de build TypeScript).
  - Workflows de CI executam Bun para install/check/test.

## 8) Remova camadas de compatibilidade antigas

A menos que solicitado, remova shims de compatibilidade do upstream.

- Delete APIs antigas que foram substituídas.
- Atualize todos os call sites para a nova API diretamente.
- Não mantenha versões `*_v2` ou paralelas.

## 9) Atualize docs e referências

- Substitua links do repositório pi-mono quando apropriado.
- Atualize exemplos para usar Bun e escopos de pacote corretos.
- Garanta que as instruções do README ainda correspondam ao comportamento atual do repositório.

## 10) Valide a portagem

Execute as verificações padrão após as alterações:

- `bun check`

Se o repositório já tiver verificações falhando não relacionadas às suas alterações, sinalize isso.
Testes usam o runner do Bun (não Vitest), mas execute `bun test` apenas quando explicitamente solicitado.

## 11) Proteja funcionalidades melhoradas (lista de armadilhas de regressão)

Se você já melhorou o comportamento localmente, trate essas melhorias como **inegociáveis**. Antes de portar, documente
as melhorias e adicione verificações explícitas para que não se percam no merge.

- **Congele o comportamento esperado**: adicione uma nota curta "antes/depois" para cada melhoria (entradas, saídas,
  valores padrão, casos extremos). Isso previne reversões silenciosas.
- **Mapeie APIs antigas → novas**: se o upstream renomeou conceitos (hooks → extensions, custom tools → tools, etc.),
  garanta que cada entry point antigo ainda funcione. Um flag ou export esquecido equivale a funcionalidade perdida.
- **Verifique exports**: confira `exports` do `package.json`, tipos públicos e barrel files. Portagens do upstream frequentemente
  esquecem de re-exportar adições locais.
- **Cubra caminhos não-felizes**: se você corrigiu tratamento de erros, timeouts ou lógica de fallback, adicione um teste ou
  pelo menos um checklist manual que exercite esses caminhos.
- **Verifique valores padrão e ordem de merge de configuração**: melhorias frequentemente residem nos valores padrão. Confirme que novos valores padrão
  não reverteram (ex.: nova precedência de configuração, funcionalidades desabilitadas, listas de ferramentas).
- **Audite comportamento de env/shell**: se você corrigiu execução ou sandboxing, verifique que o novo caminho ainda usa seu
  env sanitizado e não reintroduz overrides de alias/função.
- **Re-execute amostras direcionadas**: mantenha um conjunto mínimo de exemplos "known good" e execute-os após a portagem
  (flags de CLI, registro de extensão, execução de ferramentas).

## 12) Detecte e trate código refatorado

Antes de portar um arquivo, verifique se o upstream o refatorou significativamente:

```bash
# Compare o arquivo que você vai portar com o que você tem localmente
git diff HEAD upstream/main -- path/to/file.ts
```

Se o diff mostrar que o arquivo foi **refatorado** (não apenas corrigido):

- Novas abstrações, conceitos renomeados, módulos mesclados, fluxo de dados alterado

Então você deve **ler a nova implementação completamente** antes de portar. Merge cego de código refatorado perde funcionalidade porque:

Nota: o modo interativo foi recentemente dividido em controllers/utils/types. Ao fazer backport de alterações relacionadas, porte as atualizações para os arquivos individuais que criamos e garanta que a ligação em `interactive-mode.ts` permaneça sincronizada.

1. **Valores padrão mudam silenciosamente** - Uma nova variável `defaultFoo = [a, b]` pode substituir um antigo `getAllFoo()` que retornava `[a, b, c, d, e]`.

2. **Opções de API são descartadas** - Quando sistemas são mesclados (ex.: `hooks` + `customTools` → `extensions`), opções antigas podem não ser conectadas à nova implementação.

3. **Caminhos de código ficam obsoletos** - Um conceito renomeado (ex.: `hookMessage` → `custom`) precisa de atualizações em cada switch statement, type guard e handler — não apenas na definição.

4. **Contexto/capacidades encolhem** - APIs antigas podem ter exposto `{ logger, typebox, pi }` que novas APIs esqueceram de incluir.

### Processo de portagem semântica

Quando o upstream refatorou um módulo:

1. **Leia a implementação antiga** - Entenda o que ela fazia, quais opções aceitava, o que expunha.

2. **Leia a nova implementação** - Entenda as novas abstrações e como elas mapeiam para o comportamento antigo.

3. **Verifique a paridade de funcionalidades** - Para cada capacidade no código antigo, confirme que o novo código a preserva ou a remove explicitamente.

4. **Busque por remanescentes** - Procure por nomes/conceitos antigos que podem ter sido perdidos em switch statements, handlers, componentes de UI.

5. **Teste as fronteiras** - Flags de CLI, opções do SDK, event handlers, valores padrão — é onde as regressões se escondem.

### Verificações rápidas

```bash
# Encontre todos os usos de um conceito antigo que pode precisar de atualização
rg "oldConceptName" --type ts

# Compare valores padrão entre versões
git show upstream/main:path/to/file.ts | rg "default|DEFAULT"

# Verifique se todos os valores de enum/union têm handlers
rg "case \"" path/to/file.ts
```

## 13) Checklist rápido de auditoria

Use isto como uma passagem final antes de concluir:

- [ ] Extensões de importação seguem a convenção do pacote local (sem remoção indiscriminada de `.js`)
- [ ] Sem APIs exclusivas do Node em código novo/portado
- [ ] Todos os escopos de pacote atualizados
- [ ] Scripts do `package.json` usam Bun
- [ ] Prompts são importações de texto `.md` (sem strings de prompt inline)
- [ ] Sem `console.*` no coding-agent (use `logger`)
- [ ] Assets carregam via padrões de embed do Bun (sem scripts de cópia)
- [ ] Testes ou verificações executam (ou explicitamente anotados como bloqueados)
- [ ] Sem regressões de funcionalidade (veja seções 11-12)

## 14) Formato da mensagem de commit

Ao commitar um backport, siga o formato do repositório `<type>(scope): <descrição no passado>` e mantenha o
intervalo de commits no título.

```
fix(coding-agent): backported pi-mono changes (<from>..<to>)

packages/<package>:
- <type>: <description>
- <type>: <description> (#<issue> by @<contributor>)

packages/<other-package>:
- <type>: <description>
```

**Exemplo:**

```
fix(coding-agent): backported pi-mono changes (9f3eef65f..52532c7c0)

packages/ai:
- fix: handle "sensitive" stop reason from Anthropic API
- fix: normalize tool call IDs with special characters for Responses API
- fix: add overflow detection for Bedrock, MiniMax, Kimi providers
- fix: 429 status is rate limiting, not context overflow

packages/tui:
- fix: refactored autocomplete state tracking
- fix: file autocomplete should not trigger on empty text
- fix: configurable autocomplete max visible items
- fix: improved table column width calculation with word-aware wrapping

packages/coding-agent:
- fix: preserve external config.yml edits on save (#1046 by @nicobailonMD)
- fix: resolve macOS NFD and curly quote variants in file paths
```

**Regras:**

- Agrupe alterações por pacote
- Use tipos de commit convencionais (`fix`, `feat`, `refactor`, `perf`, `docs`)
- Inclua números de issue/PR do upstream e atribuição de contribuidor para contribuições externas
- O intervalo de commits no título ajuda a rastrear pontos de sincronização

## 15) Divergências Intencionais

Nosso fork tem decisões arquiteturais que diferem do upstream. **Não porte estes padrões do upstream:**

### Arquitetura de UI

| Upstream                                    | Nosso Fork                                                | Razão                                                                 |
| ------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------- |
| Classe `FooterDataProvider`                 | `StatusLineComponent`                                     | Linha de status mais simples e integrada                              |
| `ctx.ui.setHeader()` / `ctx.ui.setFooter()` | Stub em modos não-TUI                                     | Implementado no TUI, no-op nos demais                                 |
| `ctx.ui.setEditorComponent()`               | Stub em modos não-TUI                                     | Implementado no TUI, no-op nos demais                                 |
| Objeto de opções `InteractiveModeOptions`   | Args posicionais no construtor (tipo options ainda exportado) | Mantenha a assinatura do construtor; atualize o tipo quando upstream adicionar campos |

### Nomenclatura de Componentes

| Upstream                     | Nosso Fork              |
| ---------------------------- | ----------------------- |
| `extension-input.ts`         | `hook-input.ts`         |
| `extension-selector.ts`      | `hook-selector.ts`      |
| `ExtensionInputComponent`    | `HookInputComponent`    |
| `ExtensionSelectorComponent` | `HookSelectorComponent` |

### Nomenclatura de API

| Upstream                                 | Nosso Fork                               | Notas                                     |
| ---------------------------------------- | ---------------------------------------- | ----------------------------------------- |
| `sessionManager.appendSessionInfo(name)` | `sessionManager.setSessionName(name)`    | Usamos `sessionName` em todo o código     |
| `sessionManager.getSessionName()`        | `sessionManager.getSessionName()`        | Igual (unificamos para corresponder ao RPC do upstream) |
| `agent.sessionName` / `setSessionName()` | `agent.sessionName` / `setSessionName()` | Igual                                     |

### Consolidação de Arquivos

| Upstream                                           | Nosso Fork                              | Razão                                   |
| -------------------------------------------------- | --------------------------------------- | --------------------------------------- |
| `clipboard.ts` + `clipboard-image.ts` (arquivos de tool) | Módulo clipboard `@f5xc-salesdemos/pi-natives` | Mesclado na implementação nativa N-API  |

### Framework de Testes

| Upstream                  | Nosso Fork                    |
| ------------------------- | ----------------------------- |
| `vitest` com `vi.mock()`  | `bun:test` com `vi` do bun   |
| Assertions `node:test`    | Matchers `expect()`           |

### Arquitetura de Ferramentas

| Upstream                            | Nosso Fork                                                        | Notas                                                     |
| ----------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------- |
| `createTool(cwd: string, options?)` | `createTools(session: ToolSession)` via registro `BUILTIN_TOOLS`  | Factories de ferramentas aceitam `ToolSession` e podem retornar `null` |
| Interfaces `*Operations` por ferramenta | Interfaces por ferramenta permanecem (`FindOperations`, `GrepOperations`) | Usadas para overrides SSH/remoto                          |
| `fs/promises` do Node.js em todo lugar | `Bun.file()`/`Bun.write()` para arquivos; `node:fs/promises` para dirs | Prefira APIs Bun quando simplificam                       |

### Armazenamento de Autenticação

| Upstream                        | Nosso Fork                                  | Notas                                        |
| ------------------------------- | ------------------------------------------- | -------------------------------------------- |
| `proper-lockfile` + `auth.json` | `agent.db` (bun:sqlite)                     | Credenciais armazenadas exclusivamente em `agent.db` |
| Credencial única por provedor   | Multi-credencial com seleção round-robin    | Afinidade de sessão e lógica de backoff preservadas |

### Extensões

| Upstream                      | Nosso Fork                                 |
| ----------------------------- | ------------------------------------------ |
| `jiti` para carregamento TypeScript | `import()` nativo do Bun                   |
| Campo de manifesto `pkg.pi`   | `pkg.xcsh ?? pkg.pi` (preferir nosso namespace) |

### Pule Estas Funcionalidades do Upstream

Ao portar, **pule** estes arquivos/funcionalidades inteiramente:

- `footer-data-provider.ts` — usamos StatusLineComponent
- `clipboard-image.ts` — clipboard está no módulo N-API `@f5xc-salesdemos/pi-natives`
- Arquivos de workflow do GitHub — temos nosso próprio CI
- `models.generated.ts` — auto-gerado, regenere localmente (como models.json em vez disso)

### Funcionalidades que Adicionamos (Preserve Estas)

Estas existem no nosso fork mas não no upstream. **Nunca sobrescreva:**

- `StatusLineComponent` no modo interativo
- Autenticação multi-credencial com afinidade de sessão
- Sistema de descoberta baseado em capacidades (`defineCapability`, `registerProvider`, `loadCapability`, `skillCapability`, etc.)
- Integrações MCP/Exa/SSH
- LSP writethrough para format-on-save
- Interceptação Bash (`checkBashInterception`)
- Sugestões fuzzy de caminho na ferramenta de leitura
