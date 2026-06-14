---
title: Extensões de Manifesto Gemini
description: >-
  Formato de extensão de manifesto Gemini para compatibilidade de skills e
  agentes entre plataformas.
sidebar:
  order: 7
  label: Manifesto Gemini
i18n:
  sourceHash: 7134165a5f6d
  translator: machine
---

# Extensões de Manifesto Gemini (`gemini-extension.json`)

Este documento descreve como o agente de codificação descobre e analisa extensões de manifesto no estilo Gemini (`gemini-extension.json`) na capacidade `extensions`.

Ele **não** cobre o carregamento de módulos de extensão TypeScript/JavaScript (`extensions/*.ts`, `index.ts`, `package.json xcsh.extensions`), que está documentado em `extension-loading.md`.

## Arquivos de implementação

- [`../src/discovery/gemini.ts`](../../packages/coding-agent/src/discovery/gemini.ts)
- [`../src/discovery/builtin.ts`](../../packages/coding-agent/src/discovery/builtin.ts)
- [`../src/discovery/helpers.ts`](../../packages/coding-agent/src/discovery/helpers.ts)
- [`../src/capability/extension.ts`](../../packages/coding-agent/src/capability/extension.ts)
- [`../src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`../src/extensibility/extensions/loader.ts`](../../packages/coding-agent/src/extensibility/extensions/loader.ts)

---

## O que é descoberto

O provedor Gemini (`id: gemini`, prioridade `60`) registra um carregador de `extensions` que varre duas raízes fixas:

- Usuário: `~/.gemini/extensions`
- Projeto: `<cwd>/.gemini/extensions`

A resolução de caminho é feita diretamente a partir de `ctx.home` e `ctx.cwd` via `getUserPath()` / `getProjectPath()`.

Regra importante de escopo: a busca no projeto é **somente no cwd**. Ela não percorre diretórios pai.

---

## Regras de varredura de diretório

Para cada raiz (`~/.gemini/extensions` e `<cwd>/.gemini/extensions`), a descoberta realiza:

1. `readDirEntries(root)`
2. mantém apenas subdiretórios diretos (`entry.isDirectory()`)
3. para cada filho `<name>`, tenta ler exatamente:
   - `<root>/<name>/gemini-extension.json`

Não há varredura recursiva além de um nível de diretório.

### Diretórios ocultos

A descoberta de manifesto Gemini **não** filtra nomes de diretórios com prefixo de ponto. Se um subdiretório oculto existir e contiver `gemini-extension.json`, ele será considerado.

### Arquivos ausentes/ilegíveis

Se `gemini-extension.json` estiver ausente ou ilegível, aquele diretório será ignorado silenciosamente (sem aviso).

---

## Estrutura do manifesto (conforme implementado)

O tipo de capacidade define esta estrutura de manifesto:

```ts
interface ExtensionManifest {
 name?: string;
 description?: string;
 mcpServers?: Record<string, Omit<MCPServer, "name" | "_source">>;
 tools?: unknown[];
 context?: unknown;
}
```

O comportamento no momento da descoberta é intencionalmente permissivo:

- É necessário que o parse JSON seja bem-sucedido.
- Não há validação de esquema em tempo de execução para tipos/conteúdo de campos além da sintaxe JSON.
- O objeto analisado é armazenado como `manifest` no item de capacidade.

### Normalização de nome

`Extension.name` é definido como:

1. `manifest.name` se não for `null`/`undefined`
2. caso contrário, o nome do diretório da extensão

Nenhuma imposição de tipo string é aplicada aqui.

---

## Materialização em itens de capacidade

Um manifesto analisado válido cria um item de capacidade `Extension`:

```ts
{
 name: manifest.name ?? <directory-name>,
 path: <extension-directory>,
 manifest: <parsed-json>,
 level: "user" | "project",
 _source: {
  provider: "gemini",
  providerName: "Gemini CLI" // anexado pelo registro de capacidade
  path: <absolute-manifest-path>,
  level: "user" | "project"
 }
}
```

Observações:

- `_source.path` é normalizado para um caminho absoluto por `createSourceMeta()`.
- A validação de capacidade no nível do registro para `extensions` verifica apenas a presença de `name` e `path`.
- Os elementos internos do manifesto (`mcpServers`, `tools`, `context`) não são validados durante a descoberta.

---

## Tratamento de erros e semântica de avisos

### Com aviso

- JSON inválido em um arquivo de manifesto:
  - formato do aviso: `Invalid JSON in <manifestPath>`

### Sem aviso (ignorado silenciosamente)

- diretório `extensions` ausente
- subdiretório não possui `gemini-extension.json`
- arquivo de manifesto ilegível
- JSON do manifesto sintaticamente válido, mas semanticamente estranho/incompleto

Isso significa que validade parcial é aceita: somente falha sintática de JSON emite um aviso.

---

## Precedência e deduplicação com outras fontes

A capacidade `extensions` é agregada entre provedores pelo registro de capacidade.

Provedores atuais para esta capacidade:

- `native` (`packages/coding-agent/src/discovery/builtin.ts`) prioridade `100`
- `gemini` (`packages/coding-agent/src/discovery/gemini.ts`) prioridade `60`

A chave de deduplicação é `ext.name` (`extensionCapability.key = ext => ext.name`).

### Precedência entre provedores

O provedor de maior prioridade vence em nomes de extensão duplicados.

- Se `native` e `gemini` emitirem o nome de extensão `foo`, o item nativo é mantido.
- O duplicado de menor prioridade é retido apenas em `result.all` com `_shadowed = true`.

### Efeitos de ordem intra-provedor

Como a deduplicação segue a política "primeiro visto vence", a ordem dos itens locais do provedor importa.

- O carregador Gemini acrescenta **usuário primeiro**, depois **projeto**.
- Portanto, nomes duplicados entre `~/.gemini/extensions` e `<cwd>/.gemini/extensions` mantêm a entrada do usuário e ocultam a entrada do projeto.

Em contraste, o provedor nativo constrói a ordem de diretórios de configuração de forma diferente (`project` depois `user` em `getConfigDirs()`), portanto o sombreamento intra-provedor nativo ocorre na direção oposta.

---

## Resumo do comportamento usuário vs projeto

Para manifestos Gemini especificamente:

- Ambas as raízes de usuário e projeto são varridas em cada carregamento.
- A raiz do projeto é fixada em `<cwd>/.gemini/extensions` (sem percurso de ancestrais).
- Nomes duplicados dentro da fonte Gemini são resolvidos para usuário-primeiro.
- Nomes duplicados contra provedores de maior prioridade (notadamente o nativo) perdem por prioridade.

---

## Limite: metadados de descoberta vs carregamento de extensão em tempo de execução

A descoberta de `gemini-extension.json` atualmente alimenta metadados de capacidade (itens `Extension`). Ela **não** carrega diretamente módulos de extensão TS/JS executáveis.

O carregamento de módulos em tempo de execução (`discoverAndLoadExtensions()` / `loadExtensions()`) utiliza `extension-modules` e caminhos explícitos, e atualmente filtra os módulos autodescobertos apenas para o provedor `native`.

Implicação prática:

- Extensões de manifesto Gemini são descobríveis como registros de capacidade.
- Elas não são, por si só, executadas como módulos de extensão em tempo de execução pelo pipeline do carregador de extensões.

Este limite é intencional na implementação atual e explica por que a descoberta de manifesto e o carregamento de módulos executáveis podem divergir.
