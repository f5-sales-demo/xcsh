---
title: Carregamento de Extensões (Módulos TypeScript/JavaScript)
description: >-
  Pipeline de carregamento de módulos TypeScript e JavaScript para extensões com
  resolução, validação e cache.
sidebar:
  order: 2
  label: Carregamento de extensões
i18n:
  sourceHash: a8cea231c660
  translator: machine
---

# Carregamento de Extensões (Módulos TypeScript/JavaScript)

Este documento aborda como o agente de codificação descobre e carrega **módulos de extensão** (`.ts`/`.js`) na inicialização.

Ele **não** aborda extensões de manifesto `gemini-extension.json` (documentadas separadamente).

## O que este subsistema faz

O carregamento de extensões constrói uma lista de arquivos de entrada de módulos, importa cada módulo com Bun, executa sua factory e retorna:

- definições de extensão carregadas
- erros de carregamento por caminho (sem abortar todo o carregamento)
- um objeto compartilhado de runtime de extensão usado posteriormente pelo `ExtensionRunner`

## Arquivos de implementação principais

- `src/extensibility/extensions/loader.ts` — descoberta de caminhos + importação/execução
- `src/extensibility/extensions/index.ts` — exportações públicas
- `src/extensibility/extensions/runner.ts` — runtime/execução de eventos após o carregamento
- `src/discovery/builtin.ts` — provedor nativo de autodescoberta para módulos de extensão
- `src/config/settings.ts` — carrega configurações mescladas de `extensions` / `disabledExtensions`

---

## Entradas para o carregamento de extensões

### 1) Módulos de extensão nativos autodescobertos

`discoverAndLoadExtensions()` primeiro solicita aos provedores de descoberta itens com capacidade `extension-module`, depois mantém apenas os itens do provedor `native`.

Localizações nativas efetivas:

- Projeto: `<cwd>/.xcsh/extensions`
- Usuário: `~/.xcsh/agent/extensions`

As raízes de caminho vêm do provedor nativo (`SOURCE_PATHS.native`).

Notas:

- A autodescoberta nativa atualmente é baseada em `.xcsh`.
- O legado `.pi` ainda é aceito nas chaves de manifesto do `package.json` (`pi.extensions`), mas não como raiz nativa aqui.

### 2) Caminhos explicitamente configurados

Após a autodescoberta, os caminhos configurados são adicionados e resolvidos.

Fontes de caminhos configurados no caminho de inicialização da sessão principal (`sdk.ts`):

1. Caminhos fornecidos via CLI (`--extension/-e`, e `--hook` também é tratado como um caminho de extensão)
2. Array `extensions` nas configurações (configurações globais + projeto mescladas)

Arquivo de configurações globais:

- `~/.xcsh/agent/config.yml` (ou diretório de agente personalizado via `PI_CODING_AGENT_DIR`)

Arquivo de configurações do projeto:

- `<cwd>/.xcsh/settings.json`

Exemplos:

```yaml
# ~/.xcsh/agent/config.yml
extensions:
  - ~/my-exts/safety.ts
  - ./local/ext-pack
```

```json
{
  "extensions": ["./.xcsh/extensions/my-extra"]
}
```

---

## Controles de ativação/desativação

### Desativar descoberta

- CLI: `--no-extensions`
- Opção do SDK: `disableExtensionDiscovery`

Divisão de comportamento:

- SDK: quando `disableExtensionDiscovery=true`, ainda carrega `additionalExtensionPaths` via `loadExtensions()`.
- A construção de caminhos do CLI (`main.ts`) atualmente limpa os caminhos de extensão do CLI quando `--no-extensions` está definido, então `-e/--hook` explícitos não são encaminhados nesse modo.

### Desativar módulos de extensão específicos

A configuração `disabledExtensions` filtra pelo formato de id da extensão:

- `extension-module:<derivedName>`

`derivedName` é baseado no caminho de entrada (`getExtensionNameFromPath`), por exemplo:

- `/x/foo.ts` -> `foo`
- `/x/bar/index.ts` -> `bar`

Exemplo:

```yaml
disabledExtensions:
  - extension-module:foo
```

---

## Resolução de caminhos e entradas

### Normalização de caminhos

Para caminhos configurados:

1. Normalizar espaços unicode
2. Expandir `~`
3. Se relativo, resolver em relação ao `cwd` atual

### Se o caminho configurado é um arquivo

Ele é usado diretamente como candidato a entrada de módulo.

### Se o caminho configurado é um diretório

Ordem de resolução:

1. `package.json` nesse diretório com `xcsh.extensions` (ou legado `pi.extensions`) -> usar entradas declaradas
2. `index.ts`
3. `index.js`
4. Caso contrário, varrer um nível em busca de entradas de extensão:
   - `*.ts` / `*.js` diretos
   - subdiretório `index.ts` / `index.js`
   - subdiretório `package.json` com `xcsh.extensions` / `pi.extensions`

Regras e restrições:

- sem descoberta recursiva além de um nível de subdiretório
- entradas de manifesto `extensions` declaradas são resolvidas em relação ao diretório do pacote
- entradas declaradas são incluídas apenas se o arquivo existir/acesso for permitido
- em pares `*/index.{ts,js}`, TypeScript é preferido em relação a JavaScript
- links simbólicos são tratados como arquivos/diretórios elegíveis

### O comportamento de ignorar difere por fonte

- A autodescoberta nativa (`discoverExtensionModulePaths` nos helpers de descoberta) usa glob nativo com `gitignore: true` e `hidden: false`.
- A varredura explícita de diretórios configurados em `loader.ts` usa regras de `readdir` e **não** aplica filtragem de gitignore.

---

## Ordem de carregamento e precedência

`discoverAndLoadExtensions()` constrói uma lista ordenada e então chama `loadExtensions()`.

Ordem:

1. Módulos nativos autodescobertos
2. Caminhos explicitamente configurados (na ordem fornecida)

Em `sdk.ts`, a ordem configurada é:

1. Caminhos adicionais do CLI
2. `extensions` das configurações

Deduplicação:

- baseada em caminho absoluto
- o primeiro caminho encontrado prevalece
- duplicatas posteriores são ignoradas

Implicação: se o mesmo caminho de módulo for autodescoberto e explicitamente configurado, ele é carregado uma vez na primeira posição (estágio de autodescoberta).

---

## Importação de módulo e contrato da factory

Cada caminho candidato é carregado com importação dinâmica:

- `await import(resolvedPath)`
- a factory é `module.default ?? module`
- a factory deve ser uma função (`ExtensionFactory`)

Se a exportação não for uma função, esse caminho falha com um erro estruturado e o carregamento continua.

---

## Tratamento de falhas e isolamento

### Durante o carregamento

Por caminho de extensão, falhas são capturadas como `{ path, error }` e não impedem o carregamento de outros caminhos.

Casos comuns:

- falha na importação / arquivo ausente
- exportação de factory inválida (não é função)
- exceção lançada durante a execução da factory

### Modelo de isolamento em runtime

- As extensões **não são sandboxed** (mesmo processo/runtime).
- Elas compartilham um `EventBus` e uma instância de `ExtensionRuntime`.
- Durante o carregamento, os métodos de ação do runtime intencionalmente lançam `ExtensionRuntimeNotInitializedError`; a vinculação de ações acontece posteriormente em `ExtensionRunner.initialize()`.

### Após o carregamento

Quando eventos são executados através do `ExtensionRunner`, exceções nos handlers são capturadas e emitidas como erros de extensão em vez de causar crash no loop do runner.

---

## Exemplos mínimos de layout de usuário/projeto

### Nível de usuário

```text
~/.xcsh/agent/
  config.yml
  extensions/
    guardrails.ts
    audit/
      index.ts
```

### Nível de projeto

```text
<repo>/
  .xcsh/
    settings.json
    extensions/
      checks/
        package.json
      lint-gates.ts
```

`checks/package.json`:

```json
{
  "xcsh": {
    "extensions": ["./src/check-a.ts", "./src/check-b.js"]
  }
}
```

Chave de manifesto legada ainda aceita:

```json
{
  "pi": {
    "extensions": ["./index.ts"]
  }
}
```
