---
title: Gemini Manifest Extensions
description: >-
  Formato de extensão de manifesto Gemini para compatibilidade multiplataforma
  de habilidades e agentes.
sidebar:
  order: 7
  label: Manifesto Gemini
i18n:
  sourceHash: 7134165a5f6d
  translator: machine
---

# Extensões de Manifesto Gemini (`gemini-extension.json`)

Este documento aborda como o coding-agent descobre e analisa extensões de manifesto no estilo Gemini (`gemini-extension.json`) na capacidade `extensions`.

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

O provedor Gemini (`id: gemini`, prioridade `60`) registra um carregador de `extensions` que escaneia duas raízes fixas:

- Usuário: `~/.gemini/extensions`
- Projeto: `<cwd>/.gemini/extensions`

A resolução de caminhos é feita diretamente a partir de `ctx.home` e `ctx.cwd` via `getUserPath()` / `getProjectPath()`.

Regra de escopo importante: a busca no projeto é **apenas no cwd**. Ela não percorre diretórios pai.

---

## Regras de escaneamento de diretórios

Para cada raiz (`~/.gemini/extensions` e `<cwd>/.gemini/extensions`), a descoberta realiza:

1. `readDirEntries(root)`
2. mantém apenas diretórios filhos diretos (`entry.isDirectory()`)
3. para cada filho `<name>`, tenta ler exatamente:
   - `<root>/<name>/gemini-extension.json`

Não há escaneamento recursivo além de um nível de diretório.

### Diretórios ocultos

A descoberta de manifesto Gemini **não** filtra nomes de diretórios prefixados com ponto. Se um diretório filho oculto existir e contiver `gemini-extension.json`, ele é considerado.

### Arquivos ausentes/ilegíveis

Se `gemini-extension.json` estiver ausente ou ilegível, esse diretório é ignorado silenciosamente (sem aviso).

---

## Formato do manifesto (conforme implementado)

O tipo de capacidade define este formato de manifesto:

```ts
interface ExtensionManifest {
 name?: string;
 description?: string;
 mcpServers?: Record<string, Omit<MCPServer, "name" | "_source">>;
 tools?: unknown[];
 context?: unknown;
}
```

O comportamento no momento da descoberta é intencionalmente flexível:

- O parse do JSON bem-sucedido é obrigatório.
- Não há validação de esquema em tempo de execução para tipos/conteúdo dos campos além da sintaxe JSON.
- O objeto parseado é armazenado como `manifest` no item de capacidade.

### Normalização do nome

`Extension.name` é definido como:

1. `manifest.name` se não for `null`/`undefined`
2. caso contrário, o nome do diretório da extensão

Nenhuma imposição de tipo string é aplicada aqui.

---

## Materialização em itens de capacidade

Um manifesto parseado válido cria um item de capacidade `Extension`:

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
- A validação de capacidade em nível de registro para `extensions` apenas verifica a presença de `name` e `path`.
- Os internos do manifesto (`mcpServers`, `tools`, `context`) não são validados durante a descoberta.

---

## Tratamento de erros e semântica de avisos

### Com aviso

- JSON inválido em um arquivo de manifesto:
  - formato do aviso: `Invalid JSON in <manifestPath>`

### Sem aviso (ignorado silenciosamente)

- diretório `extensions` ausente
- diretório filho não possui `gemini-extension.json`
- arquivo de manifesto ilegível
- JSON do manifesto é sintaticamente válido mas semanticamente estranho/incompleto

Isso significa que validade parcial é aceita: apenas falha sintática de JSON emite um aviso.

---

## Precedência e deduplicação com outras fontes

A capacidade `extensions` é agregada entre provedores pelo registro de capacidades.

Provedores atuais para esta capacidade:

- `native` (`packages/coding-agent/src/discovery/builtin.ts`) prioridade `100`
- `gemini` (`packages/coding-agent/src/discovery/gemini.ts`) prioridade `60`

A chave de deduplicação é `ext.name` (`extensionCapability.key = ext => ext.name`).

### Precedência entre provedores

O provedor de maior prioridade vence em nomes de extensão duplicados.

- Se `native` e `gemini` ambos emitem o nome de extensão `foo`, o item native é mantido.
- O duplicado de menor prioridade é retido apenas em `result.all` com `_shadowed = true`.

### Efeitos de ordem intra-provedor

Como a deduplicação é "primeiro visto vence", a ordem local dos itens do provedor importa.

- O carregador Gemini anexa **usuário primeiro**, depois **projeto**.
- Portanto, nomes duplicados entre `~/.gemini/extensions` e `<cwd>/.gemini/extensions` mantêm a entrada do usuário e sombreiam a entrada do projeto.

Em contraste, o provedor native constrói a ordem dos diretórios de configuração de forma diferente (`project` depois `user` em `getConfigDirs()`), então o sombreamento intra-provedor do native é na direção oposta.

---

## Resumo do comportamento usuário vs projeto

Para manifestos Gemini especificamente:

- Ambas as raízes de usuário e projeto são escaneadas a cada carregamento.
- A raiz do projeto é fixada em `<cwd>/.gemini/extensions` (sem percorrer ancestrais).
- Nomes duplicados dentro da fonte Gemini são resolvidos priorizando o usuário.
- Nomes duplicados contra provedores de maior prioridade (notavelmente native) perdem por prioridade.

---

## Fronteira: metadados de descoberta vs carregamento de extensões em tempo de execução

A descoberta de `gemini-extension.json` atualmente alimenta metadados de capacidade (itens `Extension`). Ela **não** carrega diretamente módulos de extensão TS/JS executáveis.

O carregamento de módulos em tempo de execução (`discoverAndLoadExtensions()` / `loadExtensions()`) usa `extension-modules` e caminhos explícitos, e atualmente filtra módulos auto-descobertos apenas para o provedor `native`.

Implicação prática:

- Extensões de manifesto Gemini são descobríveis como registros de capacidade.
- Elas não são, por si só, executadas como módulos de extensão em tempo de execução pelo pipeline do carregador de extensões.

Essa fronteira é intencional na implementação atual e explica por que a descoberta de manifestos e o carregamento de módulos executáveis podem divergir.
