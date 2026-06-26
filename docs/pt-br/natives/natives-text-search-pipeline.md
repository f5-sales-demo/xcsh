---
title: Pipeline Nativa de Texto e Busca
description: >-
  Pipeline nativa de busca de texto com indexação de conteúdo de arquivos
  baseada em grep, glob e ripgrep.
sidebar:
  order: 6
  label: Texto e busca pipeline
i18n:
  sourceHash: 0e93462fdd12
  translator: machine
---

# Pipeline Nativa de Texto/Busca

Este documento mapeia a superfície de texto/busca do `@f5-sales-demo/pi-natives` (`grep`, `glob`, `text`, `highlight`) desde os wrappers TypeScript até as exportações Rust N-API e de volta aos objetos de resultado JS.

A terminologia segue `docs/natives-architecture.md`:

- **Wrapper**: API TS em `packages/natives/src/*`
- **Camada de módulo Rust**: exportações N-API em `crates/pi-natives/src/*`
- **Cache de varredura compartilhado**: cache de entradas de diretório baseado em `fs_cache` usado pelos fluxos de descoberta/busca

## Arquivos de implementação

- `packages/natives/src/grep/index.ts`
- `packages/natives/src/grep/types.ts`
- `packages/natives/src/glob/index.ts`
- `packages/natives/src/glob/types.ts`
- `packages/natives/src/text/index.ts`
- `packages/natives/src/text/types.ts`
- `packages/natives/src/highlight/index.ts`
- `packages/natives/src/highlight/types.ts`
- `crates/pi-natives/src/grep.rs`
- `crates/pi-natives/src/glob.rs`
- `crates/pi-natives/src/glob_util.rs`
- `crates/pi-natives/src/fs_cache.rs`
- `crates/pi-natives/src/text.rs`
- `crates/pi-natives/src/highlight.rs`
- `crates/pi-natives/src/fd.rs`

## Mapeamento API JS ↔ exportação Rust

| API wrapper JS | Exportação Rust (`#[napi]`, snake_case -> camelCase) | Módulo Rust |
| --- | --- | --- |
| `grep(options, onMatch?)` | `grep` | `grep.rs` |
| `searchContent(content, options)` | `search` | `grep.rs` |
| `hasMatch(content, pattern, options?)` | `hasMatch` | `grep.rs` |
| `fuzzyFind(options)` | `fuzzyFind` | `fd.rs` |
| `glob(options, onMatch?)` | `glob` | `glob.rs` |
| `invalidateFsScanCache(path?)` | `invalidateFsScanCache` | `fs_cache.rs` |
| `wrapTextWithAnsi(text, width)` | `wrapTextWithAnsi` | `text.rs` |
| `truncateToWidth(text, maxWidth, ellipsis, pad)` | `truncateToWidth` | `text.rs` |
| `sliceWithWidth(line, startCol, length, strict?)` | `sliceWithWidth` | `text.rs` |
| `extractSegments(line, beforeEnd, afterStart, afterLen, strictAfter)` | `extractSegments` | `text.rs` |
| `sanitizeText(text)` | `sanitizeText` | `text.rs` |
| `visibleWidth(text)` | `visibleWidth` | `text.rs` |
| `highlightCode(code, lang, colors)` | `highlightCode` | `highlight.rs` |
| `supportsLanguage(lang)` | `supportsLanguage` | `highlight.rs` |
| `getSupportedLanguages()` | `getSupportedLanguages` | `highlight.rs` |

## Visão geral da pipeline por subsistema

## 1) Busca regex (`grep`, `searchContent`, `hasMatch`)

### Fluxo de entrada/opções

1. O wrapper TS encaminha as opções para o nativo:
   - `grep/index.ts` passa `options` praticamente sem alterações e converte o callback de `(match) => void` para o formato de callback threadsafe do napi `(err, match)`.
   - `searchContent` e `hasMatch` passam string/`Uint8Array` diretamente.
2. Structs de opção em Rust em `grep.rs` deserializam campos camelCase (`ignoreCase`, `maxCount`, `contextBefore`, `contextAfter`, `maxColumns`, `timeoutMs`).
3. `grep` cria `CancelToken` a partir de `timeoutMs` + `AbortSignal` e executa dentro de `task::blocking("grep", ...)`.

### Ramificações de execução

- **Ramificação em memória (utilitário puro)**
  - `search` → `search_sync` → `run_search` nos bytes de conteúdo fornecidos.
  - Sem varredura de sistema de arquivos, sem `fs_cache`.
- **Ramificação de arquivo único (dependente do sistema de arquivos)**
  - `grep_sync` resolve o caminho, verifica se os metadados são de arquivo, processa até `MAX_FILE_BYTES` por arquivo (`4 MiB`) através do matcher ripgrep.
- **Ramificação de diretório (dependente do sistema de arquivos)**
  - Consulta opcional ao cache via `fs_cache::get_or_scan` quando `cache: true`.
  - Varredura nova via `fs_cache::force_rescan` quando `cache: false`.
  - Reverificação opcional de resultado vazio quando a idade do cache excede `empty_recheck_ms()`.
  - Filtragem de entradas: somente arquivos + filtro glob opcional (`glob_util`) + filtro de tipo opcional (`js`, `ts`, `rust`, etc.).

### Semântica de busca/coleta

- Motor de regex: `grep_regex::RegexMatcherBuilder` com `ignoreCase` e `multiline`.
- Resolução de contexto:
  - `contextBefore/contextAfter` substituem o legado `context`.
  - Modos sem conteúdo zeram a coleta de contexto.
- Modos de saída:
  - `content` => um `GrepMatch` por ocorrência.
  - `count` e `filesWithMatches` ambos mapeiam para entradas estilo contagem (`lineNumber=0`, `line=""`, `matchCount` definido).
- Limites:
  - `offset` global e `maxCount` aplicados em todos os arquivos.
  - O caminho paralelo é usado apenas quando `maxCount` não está definido e `offset == 0`; caso contrário, o caminho sequencial preserva a semântica determinística de offset/limite global.

### Formatação do resultado de volta para JS

- Os campos de `SearchResult`/`GrepResult` do Rust mapeiam para tipos TS via conversão de campos de objeto N-API.
- Contadores são limitados a `u32` antes de cruzar a fronteira N-API.
- Booleanos opcionais são omitidos a menos que sejam true em alguns caminhos (`limitReached`).
- O callback de streaming recebe cada `GrepMatch` formatado (entrada de conteúdo ou contagem).

### Comportamento em caso de falha

- `searchContent` retorna `SearchResult.error` para falhas de regex/busca em vez de lançar exceção.
- `grep` rejeita em erros graves (caminho inválido, glob/regex inválido, timeout/abort de cancelamento).
- `hasMatch` retorna `Result<bool>` e lança exceção em padrão inválido/erros de decodificação UTF-8.
- Erros de abertura/busca de arquivo em varreduras multi-arquivo são ignorados por arquivo; a varredura continua.

### Tratamento de regex malformado

`grep.rs` sanitiza chaves antes da compilação de regex:

- Chaves semelhantes a repetição inválidas são escapadas (`{`/`}` -> `\{`/`\}`) quando não podem formar `{N}`, `{N,}`, `{N,M}`.
- Isso impede que fragmentos comuns de template literal (por exemplo `${platform}`) falhem como repetição malformada.
- Sintaxe de regex inválida remanescente ainda retorna um erro de regex.

## 2) Descoberta de arquivos (`glob`) e busca fuzzy de caminhos (`fuzzyFind`)

`glob` e `fuzzyFind` compartilham varreduras do `fs_cache`; a lógica de correspondência difere.

### Fluxo do `glob`

1. Wrapper TS (`glob/index.ts`):
   - `path.resolve(options.path)`.
   - Padrões: `pattern="*"`, `hidden=false`, `gitignore=true`, `recursive=true`.
2. O Rust `glob` constrói `GlobConfig` e compila o padrão via `glob_util::compile_glob`.
3. Fonte de entradas:
   - `cache=true` => `get_or_scan` + `force_rescan` opcional para vazio obsoleto.
   - `cache=false` => `force_rescan(..., store=false)` (somente novo).
4. Filtragem:
   - Sempre ignora `.git`.
   - Ignora `node_modules` a menos que solicitado (`includeNodeModules` ou padrão mencionando node_modules).
   - Aplica correspondência glob.
   - Aplica filtro de tipo de arquivo; filtros `file/dir` de symlink resolvem metadados do alvo.
5. Ordenação opcional por mtime decrescente (`sortByMtime`) antes de truncar para `maxResults`.

### Fluxo do `fuzzyFind` (implementado em `fd.rs`)

1. O wrapper TS é exportado do módulo `grep`, mas a implementação Rust reside em `fd.rs`.
2. Fonte de varredura compartilhada do `fs_cache` com a mesma divisão cache/sem-cache e política de reverificação de vazio obsoleto.
3. Pontuação:
   - pontuação fuzzy baseada em exata / começa-com / contém / subsequência
   - caminho de pontuação normalizado por separador/pontuação
   - bônus de diretório e desempate determinístico (`score desc`, depois `path asc`)
4. Entradas de symlink são excluídas dos resultados fuzzy.

### Comportamento em caso de falha

- Padrão glob inválido => erro de `glob_util::compile_glob`.
- A raiz da busca deve ser um diretório existente (`resolve_search_path`), caso contrário erro.
- Cancelamentos/timeouts propagam como erros de abort via verificações de `CancelToken::heartbeat()` nos loops.

### Tratamento de glob malformado

`glob_util::build_glob_pattern` é tolerante:

- Normaliza `\` para `/`.
- Auto-prefixa padrões recursivos simples com `**/` quando `recursive=true`.
- Auto-fecha grupos de alternação `{...` desbalanceados antes da compilação.

## 3) Ciclo de vida do cache/varredura compartilhado (`fs_cache`)

`fs_cache` armazena resultados de varredura como entradas relativas normalizadas (`path`, `fileType`, `mtime` opcional) indexadas por:

- raiz de busca canônica
- `include_hidden`
- `use_gitignore`

### Transições de estado do cache

1. **Miss / desabilitado**
   - TTL é `0` ou chave ausente/expirada -> `collect_entries` novo.
2. **Hit**
   - Idade da entrada `< cache_ttl_ms()` -> retorna entradas em cache + `cache_age_ms`.
3. **Reverificação de vazio obsoleto** (política do chamador em `glob`/`grep`/`fd`)
   - Se a consulta retorna zero correspondências e `cache_age_ms >= empty_recheck_ms()`, força uma revarredura.
4. **Invalidação**
   - `invalidateFsScanCache(path?)`:
     - sem argumento: limpa todas as chaves
     - argumento path: remove chaves cuja raiz é prefixo daquele caminho alvo

### Compromisso de resultado obsoleto

- O cache favorece varreduras repetidas de baixa latência sobre consistência imediata.
- A janela de TTL pode retornar positivos/negativos obsoletos.
- A reverificação de resultado vazio reduz negativos obsoletos para varreduras em cache mais antigas ao custo de uma varredura extra.
- A invalidação explícita é o mecanismo de correção pretendido após mutações de arquivo.

## 4) Utilitários de texto ANSI (`text`)

Estes são utilitários puros, em memória (sem varredura de sistema de arquivos).

### Limites e responsabilidades

- **`text.rs` é responsável pela semântica de células de terminal**:
  - Análise de sequências ANSI
  - Largura e fatiamento conscientes de grafemas
  - Comportamento de wrap/truncate/sanitize
- **Truncamento de linha do `grep.rs` (`maxColumns`) é separado**:
  - truncamento simples por limite de caractere de linhas correspondentes com `...`
  - não preserva estado ANSI e não é consciente de largura de células de terminal

### Comportamentos principais

- `wrapTextWithAnsi`: quebra por largura visível, carrega códigos SGR ativos entre linhas quebradas.
- `truncateToWidth`: truncamento por célula visível com política de reticências (`Unicode`, `Ascii`, `Omit`), preenchimento à direita opcional e caminho rápido retornando a string JS original quando inalterada.
- `sliceWithWidth`: fatiamento por coluna com aplicação opcional de largura estrita.
- `extractSegments`: extrai segmentos antes/depois em torno de uma sobreposição enquanto restaura o estado ANSI para o segmento `after`.
- `sanitizeText`: remove escapes ANSI + caracteres de controle, descarta surrogates isolados, normaliza CR/LF removendo `\r`.
- `visibleWidth`: conta células visíveis do terminal (tabs usam `TAB_WIDTH` fixo da implementação Rust).

### Comportamento em caso de falha

Funções de texto geralmente retornam saída transformada determinística; erros são limitados às fronteiras de conversão de string JS (falhas de conversão de argumentos N-API).

## 5) Destaque de sintaxe (`highlight`)

`highlight.rs` é transformação pura (sem FS, sem cache).

### Fluxo

1. O wrapper encaminha `code`, `lang` opcional e paleta de cores ANSI.
2. O Rust resolve a sintaxe por:
   - busca por token/nome
   - busca por extensão
   - fallback de tabela de alias (`ts/tsx/js -> JavaScript`, etc.)
   - fallback para sintaxe de texto simples quando não resolvido
3. Analisa cada linha com `ParseState` do syntect e pilha de escopos.
4. Mapeia escopos para 11 categorias semânticas de cor e injeta/reseta códigos de cor ANSI.

### Comportamento em caso de falha

- Falha de análise por linha não falha a chamada: aquela linha é adicionada sem destaque e o processamento continua.
- Linguagem desconhecida/não suportada faz fallback para sintaxe de texto simples.

## Fluxos de utilitário puro vs dependentes de sistema de arquivos

| Fluxo | Acesso ao sistema de arquivos | Cache compartilhado | Notas |
| --- | --- | --- | --- |
| `searchContent` / `hasMatch` | Não | Não | regex apenas nos bytes/string fornecidos |
| Funções do módulo `text` | Não | Não | Apenas ANSI/largura/sanitização |
| Funções do módulo `highlight` | Não | Não | Apenas sintaxe + coloração ANSI |
| `glob` | Sim | Opcional | varreduras de diretório + filtragem glob |
| `fuzzyFind` | Sim | Opcional | varreduras de diretório + pontuação fuzzy |
| `grep` (caminho de arquivo/diretório) | Sim | Opcional (modo diretório) | ripgrep sobre arquivos, filtros/callback opcionais |

## Resumo do ciclo de vida ponta a ponta

1. O chamador invoca o wrapper TS com opções tipadas.
2. O wrapper normaliza padrões (notavelmente `glob`) e encaminha para a exportação `native.*`.
3. O Rust valida/normaliza opções e constrói o matcher/configuração de busca.
4. Para fluxos de sistema de arquivos, as entradas são varridas (hit/miss/revarredura do cache) e depois filtradas/pontuadas.
5. Loops de workers periodicamente chamam o heartbeat de cancelamento; timeout/abort pode terminar a execução.
6. O Rust formata as saídas em objetos N-API (`lineNumber`, `matchCount`, `limitReached`, etc.).
7. O wrapper TS retorna objetos JS tipados (e callbacks opcionais por correspondência para `grep`/`glob`).
