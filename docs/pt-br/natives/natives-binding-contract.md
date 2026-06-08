---
title: Contrato de Binding Nativo (Lado TypeScript)
description: >-
  Contrato de binding do lado TypeScript para chamadas a funções nativas Rust
  via N-API.
sidebar:
  order: 2
  label: Contrato de binding
i18n:
  sourceHash: f5b74267cdd5
  translator: machine
---

# Contrato de Binding Nativo (Lado TypeScript)

Este documento define o contrato do lado TypeScript que se posiciona entre os chamadores de `@f5xc-salesdemos/pi-natives` e o addon N-API carregado.

Ele foca em três partes:

1. forma do contrato (`NativeBindings` + module augmentation),
2. comportamento dos wrappers (`src/<module>/index.ts`),
3. superfície de exportação pública (`src/index.ts`).

## Arquivos de implementação

- `packages/natives/src/bindings.ts`
- `packages/natives/src/native.ts`
- `packages/natives/src/index.ts`
- `packages/natives/src/clipboard/types.ts`
- `packages/natives/src/clipboard/index.ts`
- `packages/natives/src/glob/types.ts`
- `packages/natives/src/glob/index.ts`
- `packages/natives/src/grep/types.ts`
- `packages/natives/src/grep/index.ts`
- `packages/natives/src/highlight/types.ts`
- `packages/natives/src/highlight/index.ts`
- `packages/natives/src/html/types.ts`
- `packages/natives/src/html/index.ts`
- `packages/natives/src/image/types.ts`
- `packages/natives/src/image/index.ts`
- `packages/natives/src/keys/types.ts`
- `packages/natives/src/keys/index.ts`
- `packages/natives/src/ps/types.ts`
- `packages/natives/src/ps/index.ts`
- `packages/natives/src/pty/types.ts`
- `packages/natives/src/pty/index.ts`
- `packages/natives/src/shell/types.ts`
- `packages/natives/src/shell/index.ts`
- `packages/natives/src/system-info/types.ts`
- `packages/natives/src/system-info/index.ts`
- `packages/natives/src/text/types.ts`
- `packages/natives/src/text/index.ts`
- `packages/natives/src/work/types.ts`
- `packages/natives/src/work/index.ts`

## Modelo do contrato

`packages/natives/src/bindings.ts` define o contrato base:

- `NativeBindings` (interface base, atualmente inclui `cancelWork(id: number): void`)
- `Cancellable` (`timeoutMs?: number`, `signal?: AbortSignal`)
- `TsFunc<T>` formato de callback utilizado por callbacks threadsafe do N-API

Cada módulo adiciona seus próprios campos por declaration merging:

```ts
// packages/natives/src/<module>/types.ts
declare module "../bindings" {
 interface NativeBindings {
  grep(options: GrepOptions, onMatch?: TsFunc<GrepMatch>): Promise<GrepResult>;
 }
}
```

Isso mantém uma única interface de binding agregada sem um arquivo de tipos monolítico central.

## Ciclo de vida do declaration-merging e transições de estado

### 1) Montagem de tipos em tempo de compilação

- `bindings.ts` fornece o símbolo base `NativeBindings`.
- Cada `src/<module>/types.ts` aumenta `NativeBindings`.
- `src/native.ts` importa todos os arquivos `./<module>/types` por seus efeitos colaterais para que o contrato mesclado esteja no escopo onde `NativeBindings` é utilizado.

Transição de estado: **Contrato base** → **Contrato mesclado**.

### 2) Carregamento do addon em tempo de execução e portão de validação

- `src/native.ts` carrega binários `.node` candidatos.
- O objeto carregado é tratado como `NativeBindings` e imediatamente passado por `validateNative(...)`.
- `validateNative` verifica as chaves de exportação necessárias por `typeof bindings[name] === "function"`.

Transição de estado: **Objeto addon não confiável** → **Objeto de binding nativo validado** (ou falha definitiva).

### 3) Invocação do wrapper

- Os wrappers de módulo em `src/<module>/index.ts` chamam `native.<export>`.
- Os wrappers adaptam valores padrão e formato de callback (`(err, value)` para padrões de callback somente com valor nas APIs JS).
- `src/index.ts` re-exporta wrappers/tipos de módulo como a API pública do pacote.

Transição de estado: **Bindings brutos validados** → **API pública ergonômica**.

## Responsabilidades dos wrappers

Os wrappers são intencionalmente finos; eles não reimplementam lógica nativa.

Responsabilidades principais:

- **Normalização/definição de valores padrão dos argumentos**
  - `glob()` resolve `options.path` para caminho absoluto e define padrões para `hidden`, `gitignore`, `recursive`.
  - `hasMatch()` preenche flags padrão (`ignoreCase`, `multiline`) antes da chamada nativa.
- **Adaptação de callbacks**
  - `grep()`, `glob()`, `executeShell()` convertem `TsFunc<T>` (`error, value`) em callback do usuário recebendo apenas valores bem-sucedidos.
- **Comportamento de ambiente ou política em torno das chamadas nativas**
  - O wrapper de clipboard adiciona tratamento de OSC52/Termux/headless e trata a cópia como melhor esforço.
- **Nomeação pública e curadoria de re-exportação**
  - `searchContent()` mapeia para a exportação nativa `search`.

## Organização da superfície de exportação pública

`packages/natives/src/index.ts` é o barrel público canônico. Ele agrupa exportações por domínio de capacidade:

- Busca/texto: `grep`, `glob`, `text`, `highlight`
- Execução/processo/terminal: `shell`, `pty`, `ps`, `keys`
- Sistema/mídia/conversão: `image`, `html`, `clipboard`, `system-info`, `work`

Regra para mantenedores: se um wrapper não é re-exportado de `src/index.ts`, ele não faz parte da superfície pública pretendida do pacote.

## Mapeamento API JS ↔ exportação nativa (representativo)

O lado Rust usa nomes de exportação N-API (tipicamente da conversão `#[napi]` snake_case -> camelCase, com aliases explícitos ocasionais) que devem corresponder a essas chaves de binding.

| Categoria | API JS pública (wrapper) | Chave de binding nativo | Tipo de retorno | Async? |
|---|---|---|---|---|
| Grep | `grep(options, onMatch?)` | `grep` | `Promise<GrepResult>` | Sim |
| Grep | `searchContent(content, options)` | `search` | `SearchResult` | Não |
| Grep | `hasMatch(content, pattern, opts?)` | `hasMatch` | `boolean` | Não |
| Grep | `fuzzyFind(options)` | `fuzzyFind` | `Promise<FuzzyFindResult>` | Sim |
| Glob | `glob(options, onMatch?)` | `glob` | `Promise<GlobResult>` | Sim |
| Glob | `invalidateFsScanCache(path?)` | `invalidateFsScanCache` | `void` | Não |
| Shell | `executeShell(options, onChunk?)` | `executeShell` | `Promise<ShellExecuteResult>` | Sim |
| Shell | `Shell` | `Shell` | construtor de classe | N/A |
| PTY | `PtySession` | `PtySession` | construtor de classe | N/A |
| Text | `truncateToWidth(...)` | `truncateToWidth` | `string` | Não |
| Text | `sliceWithWidth(...)` | `sliceWithWidth` | `SliceWithWidthResult` | Não |
| Text | `visibleWidth(text)` | `visibleWidth` | `number` | Não |
| Highlight | `highlightCode(code, lang, colors)` | `highlightCode` | `string` | Não |
| HTML | `htmlToMarkdown(html, options?)` | `htmlToMarkdown` | `Promise<string>` | Sim |
| System | `getSystemInfo()` | `getSystemInfo` | `SystemInfo` | Não |
| Work | `getWorkProfile(lastSeconds)` | `getWorkProfile` | `WorkProfile` | Não |
| Process | `killTree(pid, signal)` | `killTree` | `number` | Não |
| Process | `listDescendants(pid)` | `listDescendants` | `number[]` | Não |
| Clipboard | `copyToClipboard(text)` | `copyToClipboard` | `Promise<void>` (comportamento de melhor esforço do wrapper) | Sim |
| Clipboard | `readImageFromClipboard()` | `readImageFromClipboard` | `Promise<ClipboardImage \| null>` | Sim |
| Keys | `parseKey(data, kittyProtocolActive)` | `parseKey` | `string \| null` | Não |

## Diferenças de contrato síncrono vs assíncrono

O contrato mistura APIs síncronas e assíncronas; os wrappers preservam o estilo de chamada nativa em vez de forçar um único modelo:

- **Exportações assíncronas baseadas em Promise** para I/O ou trabalhos de longa duração (`grep`, `glob`, `htmlToMarkdown`, `executeShell`, clipboard, operações de imagem).
- **Exportações síncronas** para transformações/parsers determinísticos em memória (`search`, `hasMatch`, highlighting, largura/fatiamento de texto, parsing de teclas, consultas de processo).
- **Exportações de construtores** para objetos de runtime com estado (`Shell`, `PtySession`, `PhotonImage`).

Implicação para mantenedores: alterar síncrono ↔ assíncrono para uma exportação existente é uma mudança de API e contrato com quebra de compatibilidade em todos os wrappers e chamadores.

## Padrões de tipagem de objetos e enums

### Padrões de objeto (objetos JS no estilo `#[napi(object)]`)

O TS modela valores nativos em formato de objeto como interfaces, por exemplo:

- `GrepResult`, `SearchResult`, `GlobResult`
- `SystemInfo`, `WorkProfile`
- `ClipboardImage`, `ParsedKittyResult`

Estes são contratos estruturais em tempo de compilação; a correção da forma em tempo de execução é de responsabilidade da implementação nativa.

### Padrões de enum

Enums nativos numéricos são representados como valores `const enum` no TS:

- `FileType` (`1=file`, `2=dir`, `3=symlink`)
- `ImageFormat` (`0=PNG`, `1=JPEG`, `2=WEBP`, `3=GIF`)
- `SamplingFilter`, `Ellipsis`, `KeyEventType`

Os chamadores veem membros nomeados do enum; o limite do binding transmite números.

## Como incompatibilidades são detectadas

A detecção de incompatibilidades ocorre em duas camadas:

1. **Verificações de contrato TypeScript em tempo de compilação**
   - Os wrappers chamam `native.<name>` contra o `NativeBindings` mesclado.
   - Chaves de binding ausentes/renomeadas quebram a verificação de tipos do TS nos wrappers.

2. **Validação em tempo de execução no `validateNative`**
   - Após o carregamento, `native.ts` verifica as exportações necessárias e lança erro se alguma estiver ausente.
   - A mensagem de erro inclui as chaves ausentes e instruções de rebuild.

Isso captura a desincronização comum de binário obsoleto: wrapper/tipo existe, mas o `.node` carregado não possui a exportação.

## Comportamento de falha e ressalvas

### Falhas de carregamento/validação (falhas definitivas)

- Falha no carregamento do addon ou plataforma não suportada lança erro durante a inicialização do módulo em `native.ts`.
- Exportações necessárias ausentes lançam erro antes que os wrappers sejam utilizáveis.

Efeito: o pacote falha rapidamente em vez de adiar a falha para a primeira chamada.

### Diferenças de comportamento no nível do wrapper

- Alguns wrappers intencionalmente suavizam falhas (`copyToClipboard` é melhor esforço e suprime falhas nativas).
- Callbacks de streaming ignoram payloads de erro do callback e encaminham apenas eventos de valor bem-sucedidos.

### Ressalvas no nível de tipos (runtime mais restritivo que o TS)

- Campos opcionais do TS não garantem validade semântica; a camada nativa ainda pode rejeitar valores malformados.
- A tipagem `const enum` não impede valores numéricos fora do intervalo de chamadores não tipados em tempo de execução.
- `validateNative` verifica apenas presença/natureza de função das exportações necessárias, não compatibilidade profunda de argumentos/forma de retorno.
- `bindings.ts` inclui `cancelWork(id)` na interface base, mas a lista de validação em tempo de execução atual não impõe essa chave.

## Checklist do mantenedor para alterações de binding

Ao adicionar/alterar uma exportação, atualize todos os seguintes:

1. `src/<module>/types.ts` (augmentation + tipos do contrato)
2. `src/<module>/index.ts` (comportamento do wrapper)
3. Importações em `src/native.ts` para os tipos do módulo (se for módulo novo)
4. Verificações de exportações necessárias no `validateNative`
5. Re-exportações públicas em `src/index.ts`

Pular qualquer etapa cria desincronização em tempo de compilação ou falha em tempo de carregamento na execução.
