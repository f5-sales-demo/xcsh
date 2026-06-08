---
title: Arquitetura do Cache de Varredura do Sistema de Arquivos
description: >-
  Contrato do cache de varredura do sistema de arquivos para descoberta rápida
  de arquivos com semântica stale-while-revalidate.
sidebar:
  order: 8
  label: Cache de varredura do sistema de arquivos
i18n:
  sourceHash: 2a2bde1726ac
  translator: machine
---

# Contrato de Arquitetura do Cache de Varredura do Sistema de Arquivos

Este documento define o contrato atual para o cache compartilhado de varredura do sistema de arquivos implementado em Rust (`crates/pi-natives/src/fs_cache.rs`) e consumido pelas APIs nativas de descoberta/busca expostas para `packages/coding-agent`.

## O que é este cache

O cache armazena listas completas de entradas de varredura de diretórios (`GlobMatch[]`) indexadas por escopo de varredura e política de travessia, permitindo então que operações de nível superior (filtragem por glob, pontuação fuzzy, seleção de arquivos por grep) sejam executadas sobre essas entradas em cache.

Objetivos principais:

- evitar caminhamentos repetidos no sistema de arquivos para chamadas repetidas de descoberta/busca
- manter consistência entre `glob`, `fuzzyFind` e `grep` quando compartilham a mesma política de varredura
- permitir recuperação explícita de obsolescência para resultados vazios e invalidação explícita após mutações de arquivos

## Propriedade e superfície pública

- Implementação do cache e política: `crates/pi-natives/src/fs_cache.rs`
- Consumidores nativos:
  - `crates/pi-natives/src/glob.rs`
  - `crates/pi-natives/src/fd.rs` (`fuzzyFind`)
  - `crates/pi-natives/src/grep.rs`
- Binding/exportação JS:
  - `packages/natives/src/glob/index.ts` (`invalidateFsScanCache`)
  - `packages/natives/src/glob/types.ts`
  - `packages/natives/src/grep/types.ts`
- Helpers de invalidação por mutação do coding-agent:
  - `packages/coding-agent/src/tools/fs-cache-invalidation.ts`

## Particionamento da chave do cache (contrato rígido)

Cada entrada é indexada por:

- caminho de diretório `root` canonicalizado
- booleano `include_hidden`
- booleano `use_gitignore`

Implicações:

- Varreduras com e sem arquivos ocultos **não** compartilham entradas.
- Varreduras que respeitam gitignore e varreduras com ignore desabilitado **não** compartilham entradas.
- Os consumidores devem passar semânticas estáveis para o comportamento de hidden/gitignore; alterar qualquer uma das flags cria uma partição de cache diferente.

A inclusão de `node_modules` **não** faz parte da chave do cache. O cache armazena entradas com `node_modules` incluído; a filtragem por consumidor é aplicada após a recuperação.

## Comportamento de coleta da varredura

A população do cache utiliza um walker determinístico (`ignore::WalkBuilder`) configurado por `include_hidden` e `use_gitignore`:

- `follow_links(false)`
- ordenado por caminho de arquivo
- `.git` é sempre ignorado
- `node_modules` é sempre coletado no momento da varredura do cache (e opcionalmente filtrado depois)
- tipo de arquivo da entrada + `mtime` são capturados via `symlink_metadata`

As raízes de busca são resolvidas por `resolve_search_path`:

- caminhos relativos são resolvidos em relação ao cwd atual
- o alvo deve ser um diretório existente
- a raiz é canonicalizada quando possível

## Política de frescor e evição

Política global (sobrescrevível por variáveis de ambiente):

- `FS_SCAN_CACHE_TTL_MS` (padrão `1000`)
- `FS_SCAN_EMPTY_RECHECK_MS` (padrão `200`)
- `FS_SCAN_CACHE_MAX_ENTRIES` (padrão `16`)

Comportamento:

- `get_or_scan(...)`
  - se o TTL for `0`: ignora o cache completamente, sempre faz varredura nova (`cache_age_ms = 0`)
  - em cache hit dentro do TTL: retorna entradas em cache + `cache_age_ms` diferente de zero
  - em hit expirado: remove a chave, revarre, armazena entrada nova
- a aplicação do limite máximo de entradas é feita por evição dos mais antigos por `created_at`

## Reverificação rápida de resultado vazio (separada de hits normais)

Cache hit normal:

- um cache hit dentro do TTL retorna as entradas em cache e não faz mais nada.

Reverificação rápida de resultado vazio:

- esta é uma política do **lado do chamador** usando `ScanResult.cache_age_ms`
- se o resultado filtrado/consultado estiver vazio e a idade da varredura em cache for pelo menos `empty_recheck_ms()`, o chamador executa um `force_rescan(...)` e tenta novamente
- destinada a reduzir resultados falso-negativos obsoletos quando arquivos foram adicionados recentemente mas o cache ainda está dentro do TTL

Consumidores atuais:

- `glob`: reverifica quando as correspondências filtradas estão vazias e a idade da varredura excede o limite
- `fuzzyFind` (`fd.rs`): reverifica apenas quando a consulta não está vazia e as correspondências pontuadas estão vazias
- `grep`: reverifica quando a lista de arquivos candidatos selecionados está vazia

## Padrões dos consumidores e uso do cache

O cache é opt-in em todas as APIs expostas (`cache?: boolean`, padrão `false`).

Padrões atuais nas APIs nativas:

- `glob`: `hidden=false`, `gitignore=true`, `cache=false`
- `fuzzyFind`: `hidden=false`, `gitignore=true`, `cache=false`
- `grep`: `hidden=true`, `cache=false`, e a varredura do cache sempre usa `use_gitignore=true`

Chamadores do coding-agent atualmente:

- Descoberta de candidatos a menção em alto volume habilita o cache:
  - `packages/coding-agent/src/utils/file-mentions.ts`
  - perfil: `hidden=true`, `gitignore=true`, `includeNodeModules=true`, `cache=true`
- Integração do `grep` em nível de ferramenta atualmente desabilita o cache de varredura (`cache: false`):
  - `packages/coding-agent/src/tools/grep.ts`

## Contrato de invalidação

Ponto de entrada nativo para invalidação:

- `invalidateFsScanCache(path?: string)`
  - com `path`: remove entradas do cache cuja raiz é prefixo do caminho alvo
  - sem path: limpa todas as entradas do cache de varredura

Detalhes de tratamento de caminho:

- caminhos de invalidação relativos são resolvidos em relação ao cwd
- a invalidação tenta canonicalização
- se o alvo não existir (ex.: exclusão), o fallback canonicaliza o pai e reanexa o nome do arquivo quando possível
- isso preserva o comportamento de invalidação para criação/exclusão/renomeação onde um dos lados pode não existir

## Responsabilidades do fluxo de mutação do coding-agent

O código do coding-agent deve invalidar após mutações bem-sucedidas no sistema de arquivos.

Helpers centrais:

- `invalidateFsScanAfterWrite(path)`
- `invalidateFsScanAfterDelete(path)`
- `invalidateFsScanAfterRename(oldPath, newPath)` (invalida ambos os lados quando os caminhos diferem)

Callsites atuais de ferramentas de mutação:

- `packages/coding-agent/src/tools/write.ts`
- `packages/coding-agent/src/patch/index.ts` (fluxos hashline/patch/replace)

Regra: se um fluxo altera o conteúdo ou localização no sistema de arquivos e ignora esses helpers, bugs de obsolescência do cache são esperados.

## Adicionando um novo consumidor de cache com segurança

Ao introduzir o uso de cache em um novo caminho de scanner/busca:

1. **Use entradas de política de varredura estáveis**
   - decida a semântica de hidden/gitignore primeiro
   - passe-as consistentemente para `get_or_scan`/`force_rescan` para que as partições de cache sejam intencionais

2. **Trate os dados do cache como pré-filtrados apenas pela política de travessia**
   - aplique filtragem específica da ferramenta (padrões glob, filtros de tipo, regras de node_modules) após a recuperação
   - nunca assuma que as entradas em cache já refletem seus filtros de nível superior

3. **Implemente reverificação rápida de resultado vazio apenas para risco de falso-negativo obsoleto**
   - use `scan.cache_age_ms >= empty_recheck_ms()`
   - tente novamente uma vez com `force_rescan(..., store=true, ...)`
   - mantenha esse caminho separado da lógica normal de cache-hit

4. **Respeite o modo sem cache explicitamente**
   - quando o chamador desabilitar o cache, chame `force_rescan(..., store=false, ...)`
   - não popule o cache compartilhado em um caminho de requisição sem cache

5. **Conecte a invalidação por mutação para qualquer novo caminho de escrita**
   - após escrita/edição/exclusão/renomeação bem-sucedida, chame o helper de invalidação do coding-agent
   - para renomeação/movimentação, invalide tanto o caminho antigo quanto o novo

6. **Não adicione controles de TTL por chamada**
   - o contrato atual é apenas política global (configurada por variáveis de ambiente), sem sobrescrita de TTL por requisição

## Limites conhecidos

- O escopo do cache é em memória local ao processo (`DashMap`), não persistido entre reinicializações do processo.
- O cache armazena entradas de varredura, não resultados finais de ferramentas.
- `glob`/`fuzzyFind`/`grep` compartilham entradas de varredura apenas quando as dimensões da chave (`root`, `hidden`, `gitignore`) coincidem.
- `.git` é sempre excluído no momento da coleta da varredura, independentemente das opções do chamador.
