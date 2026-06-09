---
title: Runtime do Carregador de Addon Nativo
description: >-
  Runtime do carregador de addon N-API com detecção de plataforma, estratégias
  de fallback e resolução de módulos.
sidebar:
  order: 3
  label: Carregador de addon
i18n:
  sourceHash: 1bcb4f2bbe71
  translator: machine
---

# Runtime do Carregador de Addon Nativo

Este documento aprofunda a camada de carregamento/validação de addon em `@f5xc-salesdemos/pi-natives`: como `native.ts` decide qual arquivo `.node` carregar, quando a extração de payload embarcado é executada e como falhas de inicialização são reportadas.

## Arquivos de implementação

- `packages/natives/src/native.ts`
- `packages/natives/src/embedded-addon.ts`
- `packages/natives/src/bindings.ts`
- `packages/natives/package.json`

## Escopo e responsabilidade

As responsabilidades do carregador/runtime são intencionalmente restritas:

- Construir uma lista de candidatos ciente de plataforma/CPU para nomes de arquivos e diretórios de addon.
- Opcionalmente materializar um addon embarcado em um diretório de cache versionado por usuário.
- Tentar candidatos em ordem determinística.
- Rejeitar addons obsoletos ou incompatíveis via `validateNative` antes de expor os bindings.

Fora do escopo aqui: comportamento específico de módulo para grep/texto/highlight.

## Entradas de runtime e estado derivado

Na inicialização do módulo (`export const native = loadNative();`), `native.ts` computa o contexto estático:

- **Tag de plataforma**: ``${process.platform}-${process.arch}`` (por exemplo `darwin-arm64`).
- **Versão do pacote**: de `packages/natives/package.json` (campo `version`).
- **Diretórios principais**:
  - `nativeDir`: `packages/natives/native` local ao pacote.
  - `execDir`: diretório contendo `process.execPath`.
  - `versionedDir`: `<getNativesDir()>/<packageVersion>`.
  - Fallback `userDataDir`:
    - Windows: `%LOCALAPPDATA%/xcsh` (ou `%USERPROFILE%/AppData/Local/xcsh`).
    - Não-Windows: `~/.local/bin`.
- **Modo de binário compilado** (`isCompiledBinary`): verdadeiro se qualquer condição:
  - Variável de ambiente `PI_COMPILED` está definida, ou
  - `import.meta.url` contém marcadores embarcados do Bun (`$bunfs`, `~BUN`, `%7EBUN`).
- **Substituição de variante**: `PI_NATIVE_VARIANT` (somente `modern`/`baseline`; valores inválidos são ignorados).
- **Variante selecionada**: substituição explícita, caso contrário detecção de AVX2 em runtime no x64 (`modern` se AVX2, senão `baseline`).

## Suporte a plataformas e resolução de tags

`SUPPORTED_PLATFORMS` é fixo em:

- `linux-x64`
- `linux-arm64`
- `darwin-x64`
- `darwin-arm64`
- `win32-x64`

Detalhes de comportamento:

- Plataformas não suportadas não são rejeitadas antecipadamente.
- O carregador ainda tenta todos os candidatos computados primeiro.
- Se nada carregar, ele lança um erro explícito de plataforma não suportada listando as tags suportadas.

Isso preserva diagnósticos úteis para casos quase compatíveis enquanto ainda falha fortemente para alvos verdadeiramente não suportados.

## Seleção de variante (`modern` / `baseline` / padrão)

### Comportamento x64

1. Se `PI_NATIVE_VARIANT` é `modern` ou `baseline`, esse valor prevalece.
2. Caso contrário, detectar suporte a AVX2:
   - Linux: varrer `/proc/cpuinfo` procurando `avx2`.
   - macOS: consultar `sysctl` (`machdep.cpu.leaf7_features`, fallback `machdep.cpu.features`).
   - Windows: executar PowerShell `[System.Runtime.Intrinsics.X86.Avx2]::IsSupported`.
3. Resultado:
   - AVX2 disponível -> `modern`
   - AVX2 indisponível/indetectável -> `baseline`

### Comportamento não-x64

- Nenhuma variante é usada; o carregador permanece no nome de arquivo padrão (`pi_natives.<platform>-<arch>.node`).

### Construção do nome de arquivo

Dado `tag = <platform>-<arch>`:

- Não-x64 ou sem variante: `pi_natives.<tag>.node`
- x64 + `modern`: tentar na ordem
  1. `pi_natives.<tag>-modern.node`
  2. `pi_natives.<tag>-baseline.node` (fallback intencional)
- x64 + `baseline`: somente `pi_natives.<tag>-baseline.node`

O `addonLabel` usado nas mensagens de erro finais é `<tag>` ou `<tag> (<variant>)`.

## Construção de caminhos candidatos e ordem de fallback

`native.ts` constrói pools de candidatos antes de qualquer chamada `require(...)`.

### Candidatos de release

Construídos a partir da lista de nomes de arquivo resolvida por variante e pesquisados nesta ordem:

- **Runtime não compilado**:
  1. `<nativeDir>/<filename>`
  2. `<execDir>/<filename>`

- **Runtime compilado** (`PI_COMPILED` ou marcadores embarcados do Bun):
  1. `<versionedDir>/<filename>`
  2. `<userDataDir>/<filename>`
  3. `<nativeDir>/<filename>`
  4. `<execDir>/<filename>`

`dedupedCandidates` remove duplicatas preservando a ordem da primeira ocorrência.

### Sequência final de runtime

No momento do carregamento:

1. O candidato de extração embarcada opcional (se produzido) é inserido no início.
2. Os candidatos deduplicados restantes são tentados em ordem.
3. O primeiro candidato que tanto executa `require(...)` quanto passa em `validateNative(...)` vence.

## Ciclo de vida da extração de addon embarcado

`embedded-addon.ts` define uma forma de manifesto gerado:

- `platformTag`
- `version`
- `files[]` onde cada entrada tem `variant`, `filename`, `filePath`

O padrão atualmente registrado é `embeddedAddon: null`; artefatos compilados podem substituir isso com metadados reais.

### Máquina de estados da extração

A extração (`maybeExtractEmbeddedAddon`) executa somente quando todas as condições são atendidas:

1. `isCompiledBinary === true`
2. `embeddedAddon !== null`
3. `embeddedAddon.platformTag === platformTag`
4. `embeddedAddon.version === packageVersion`
5. Um arquivo embarcado apropriado à variante é encontrado

A seleção de arquivo por variante espelha a intenção da variante em runtime:

- Não-x64: preferir `default`, depois primeiro arquivo disponível.
- x64 + `modern`: preferir `modern`, fallback para `baseline`.
- x64 + `baseline`: requer `baseline`.

Comportamento de materialização:

1. Garantir que `<versionedDir>` existe (`mkdirSync(..., { recursive: true })`).
2. Se `<versionedDir>/<selected filename>` já existe, reutilizá-lo (sem reescrita).
3. Caso contrário, ler o `filePath` fonte embarcado e escrever o arquivo de destino.
4. Retornar o caminho de destino para a tentativa de carregamento de maior prioridade.

Em caso de falha, a extração não causa crash imediato; ela adiciona uma entrada de erro (falha na criação de diretório ou escrita) e o carregador prossegue para a sondagem normal de candidatos.

## Ciclo de vida e transições de estado

```text
Init
  -> Compute platform/version/variant/candidate lists
  -> (Compiled + embedded manifest matches?)
       yes -> Try extract embedded to versionedDir (record errors, continue)
       no  -> Skip extraction
  -> For each runtime candidate in order:
       require(candidate)
       -> success: validateNative
            -> pass: return bindings (READY)
            -> fail: record error, continue
       -> failure: record error, continue
  -> none loaded:
       if unsupported platform tag -> throw Unsupported platform
       else -> throw Failed to load (full tried-path diagnostics + hints)
```

## Verificações de contrato do `validateNative`

`validateNative(bindings, source)` aplica um contrato somente de funções sobre `NativeBindings` na inicialização.

Mecânica:

- Para cada nome de exportação requerido, verifica `typeof bindings[name] === "function"`.
- Nomes ausentes são agregados.
- Se algum estiver ausente, o carregador lança:
  - caminho do addon fonte,
  - lista de exportações ausentes,
  - dica de comando de rebuild.

Este é um portão de compatibilidade rígido contra binários obsoletos, builds parciais e desvio de símbolos/nomes.

### Mapeamento da API JS ↔ exportação nativa (portão de validação)

| Nome do binding JS verificado em `validateNative` | Nome esperado da exportação nativa |
| --- | --- |
| `grep` | `grep` |
| `glob` | `glob` |
| `highlightCode` | `highlightCode` |
| `executeShell` | `executeShell` |
| `PtySession` | `PtySession` |
| `Shell` | `Shell` |
| `visibleWidth` | `visibleWidth` |
| `getSystemInfo` | `getSystemInfo` |
| `getWorkProfile` | `getWorkProfile` |
| `invalidateFsScanCache` | `invalidateFsScanCache` |

Nota: `bindings.ts` declara apenas o membro base `cancelWork(id)`; arquivos `types.ts` dos módulos fazem declaration-merge de símbolos adicionais que `validateNative` aplica.

## Comportamento de falha e diagnósticos

## Plataforma não suportada

Se todos os candidatos falharem e `platformTag` não estiver em `SUPPORTED_PLATFORMS`, o carregador lança:

- `Unsupported platform: <tag>`
- Lista completa de plataformas suportadas
- Orientação explícita para reporte de issues

## Sintomas de binário obsoleto / incompatibilidade

Sinal típico de incompatibilidade obsoleta:

- `Native addon missing exports (<candidate>). Missing: ...`

Causas comuns:

- Binário `.node` antigo de versão/formato de API anterior do pacote.
- Artefato de variante errado selecionado (para x64).
- Nova exportação Rust não presente no artefato carregado.

Comportamento do carregador:

- Registra falhas de exportação ausente por candidato.
- Continua sondando os candidatos restantes.
- Se nenhum candidato validar, o erro final inclui cada caminho tentado com cada mensagem de falha.

## Falhas de inicialização em binário compilado

No modo compilado, os diagnósticos finais incluem:

- caminhos esperados do cache versionado de destino (`<versionedDir>/<filename>`),
- remediação para deletar `<versionedDir>` obsoleto e reexecutar,
- comandos `curl` de download direto da release para cada nome de arquivo esperado.

## Falhas de inicialização não compilado

No modo normal de pacote/runtime, os diagnósticos finais incluem:

- dica de reinstalação (`bun install @f5xc-salesdemos/pi-natives`),
- comando de rebuild local (`bun --cwd=packages/natives run build`),
- dica opcional de build de variante x64 (`TARGET_VARIANT=baseline|modern ...`).

## Comportamento de runtime

- O carregador sempre usa a cadeia de candidatos de release.
- Definir `PI_DEV` apenas habilita diagnósticos por candidato no console (`Loaded native addon...` e erros de carregamento).
