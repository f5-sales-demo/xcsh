---
title: Extensões de Manifesto Gemini
description: >-
  Formato de extensão de manifesto Gemini para compatibilidade de habilidades e
  agentes entre plataformas.
sidebar:
  order: 7
  label: Manifesto Gemini
i18n:
  sourceHash: 7134165a5f6d
  translator: machine
---

# Extensões de Manifesto Gemini (`gemini-extension.json`)

Este documento aborda como o agente de codificação descobre e analisa extensões de manifesto no estilo Gemini (`gemini-extension.json`) na capacidade `extensions`.

Ele **não** aborda o carregamento de módulos de extensão TypeScript/JavaScript (`extensions/*.ts`, `index.ts`, `package.json xcsh.extensions`), que está documentado em `extension-loading.md`.

## Arquivos de implementação

- [`../src/discovery/gemini.ts`](../../packages/coding-agent/src/discovery/gemini.ts)
- [`../src/discovery/builtin.ts`](../../packages/coding-agent/src/discovery/builtin.ts)
- [`../src/discovery/helpers.ts`](../../packages/coding-agent/src/discovery/helpers.ts)
- [`../src/capability/extension.ts`](../../packages/coding-agent/src/capability/extension.ts)
- [`../src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`../src/extensibility/extensions/loader.ts`](../../packages/coding-agent/src/extensibility/extensions/loader.ts)

---

## O que é descoberto

O provedor Gemini (`id: gemini`, prioridade `60`) registra um carregador de `extensions` que examina duas raízes fixas:

- Usuário: `~/.gemini/extensions`
- Projeto: `<cwd>/.gemini/extensions`

A resolução de caminhos é feita diretamente a partir de `ctx.home` e `ctx.cwd` via `getUserPath()` / `getProjectPath()`.

Regra importante de escopo: a pesquisa de projeto é **somente no diretório de trabalho atual (cwd)**. Ela não percorre diretórios pai.

---

## Regras de varredura de diretório

Para cada raiz (`~/.gemini/extensions` e `<cwd>/.gemini/extensions`), a descoberta realiza:

1. `readDirEntries(root)`
2. mantém apenas subdiretórios filhos diretos (`entry.isDirectory()`)
3. para cada filho `<name>`, tenta ler exatamente:
   - `<root>/<name>/gemini-extension.json`

Não há varredura recursiva além de um nível de diretório.

### Diretórios ocultos

A descoberta de manifesto Gemini **não** filtra nomes de diretórios com prefixo de ponto. Se um subdiretório filho oculto existir e contiver `gemini-extension.json`, ele será considerado.

### Arquivos ausentes/ilegíveis

Se `gemini-extension.json` estiver ausente ou ilegível, esse diretório será ignorado silenciosamente (sem aviso).

---

## Estrutura do manifesto (conforme implementado)

O tipo de capacidade define a seguinte estrutura de manifesto:

```ts
interface ExtensionManifest {
 name?: string;
 description?: string;
 mcpServers?: Record<string, Omit<MCPServer, "name" | "_source">>;
 tools?: unknown[];
 context?: unknown;
}
```

O comportamento durante a descoberta é intencionalmente flexível:

- O sucesso na análise do JSON é obrigatório.
- Não há validação de esquema em tempo de execução para tipos/conteúdo de campos além da sintaxe JSON.
- O objeto analisado é armazenado como `manifest` no item de capacidade.

### Normalização de nomes

`Extension.name` é definido como:

1. `manifest.name` se não for `null`/`undefined`
2. caso contrário, o nome do diretório da extensão

Nenhuma imposição de tipo string é aplicada aqui.

---

## Materialização em itens de capacidade

Um manifesto analisado com sucesso cria um item de capacidade `Extension`:

```ts
{
 name: manifest.name ?? <directory-name>,
 path: <extension-directory>,
 manifest: <parsed-json>,
 level: "user" | "project",
 _source: {
  provider: "gemini",
  providerName: "Gemini CLI" // anexado pelo registro de capacidades
  path: <absolute-manifest-path>,
  level: "user" | "project"
 }
}
```

Observações:

- `_source.path` é normalizado para um caminho absoluto por `createSourceMeta()`.
- A validação de capacidade no nível do registro para `extensions` verifica apenas a presença de `name` e `path`.
- Os internos do manifesto (`mcpServers`, `tools`, `context`) não são validados durante a descoberta.

---

## Tratamento de erros e semântica de avisos

### Avisado

- JSON inválido em um arquivo de manifesto:
  - formato do aviso: `Invalid JSON in <manifestPath>`

### Não avisado (ignorado silenciosamente)

- Diretório `extensions` ausente
- Subdiretório filho não possui `gemini-extension.json`
- Arquivo de manifesto ilegível
- JSON do manifesto é sintaticamente válido, mas semanticamente estranho/incompleto

Isso significa que a validade parcial é aceita: somente a falha sintática de JSON emite um aviso.

---

## Precedência e deduplicação com outras fontes

A capacidade `extensions` é agregada entre provedores pelo registro de capacidades.

Provedores atuais para esta capacidade:

- `native` (`packages/coding-agent/src/discovery/builtin.ts`) prioridade `100`
- `gemini` (`packages/coding-agent/src/discovery/gemini.ts`) prioridade `60`

A chave de deduplicação é `ext.name` (`extensionCapability.key = ext => ext.name`).

### Precedência entre provedores

O provedor de maior prioridade vence em nomes de extensão duplicados.

- Se `native` e `gemini` ambos emitirem o nome de extensão `foo`, o item nativo é mantido.
- A duplicata de menor prioridade é retida apenas em `result.all` com `_shadowed = true`.

### Efeitos de ordem dentro do provedor

Como a deduplicação é "o primeiro encontrado vence", a ordem dos itens locais do provedor é importante.

- O carregador Gemini acrescenta **usuário primeiro**, depois **projeto**.
- Portanto, nomes duplicados entre `~/.gemini/extensions` e `<cwd>/.gemini/extensions` mantêm a entrada do usuário e ocultam a entrada do projeto.

Em contraste, o provedor nativo constrói a ordem dos diretórios de configuração de forma diferente (`project` e depois `user` em `getConfigDirs()`), portanto a ocultação intra-provedor do nativo ocorre na direção oposta.

---

## Resumo do comportamento: usuário vs projeto

Para manifestos Gemini especificamente:

- Ambas as raízes de usuário e projeto são examinadas a cada carregamento.
- A raiz do projeto é fixada em `<cwd>/.gemini/extensions` (sem percurso de ancestrais).
- Nomes duplicados dentro da fonte Gemini são resolvidos com usuário em primeiro lugar.
- Nomes duplicados em relação a provedores de maior prioridade (notadamente o nativo) perdem por prioridade.

---

## Limite: metadados de descoberta vs carregamento de extensão em tempo de execução

A descoberta de `gemini-extension.json` atualmente alimenta os metadados de capacidade (itens `Extension`). Ela **não** carrega diretamente módulos de extensão TS/JS executáveis.

O carregamento de módulos em tempo de execução (`discoverAndLoadExtensions()` / `loadExtensions()`) utiliza `extension-modules` e caminhos explícitos, e atualmente filtra os módulos descobertos automaticamente apenas para o provedor `native`.

Implicação prática:

- As extensões de manifesto Gemini são descobríveis como registros de capacidade.
- Elas não são, por si próprias, executadas como módulos de extensão em tempo de execução pelo pipeline do carregador de extensões.

Esse limite é intencional na implementação atual e explica por que a descoberta de manifesto e o carregamento de módulo executável podem divergir.
