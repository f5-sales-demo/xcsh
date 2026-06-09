---
title: Arquitetura dos Natives
description: >-
  Arquitetura de addon nativo Rust N-API conectando TypeScript e operações
  específicas de plataforma.
sidebar:
  order: 1
  label: Arquitetura
i18n:
  sourceHash: ff6d5d83a9a7
  translator: machine
---

# Arquitetura dos Natives

`@f5xc-salesdemos/pi-natives` é uma pilha de três camadas:

1. **Camada de wrapper/API TypeScript** expõe pontos de entrada JS/TS estáveis.
2. **Camada de carregamento/validação do addon** resolve e valida o binário `.node` para o runtime atual.
3. **Camada de módulo Rust N-API** implementa primitivas críticas de desempenho exportadas para JS.

Este documento é a base para documentações mais aprofundadas em nível de módulo.

## Arquivos de implementação

- `packages/natives/src/index.ts`
- `packages/natives/src/native.ts`
- `packages/natives/src/bindings.ts`
- `packages/natives/src/embedded-addon.ts`
- `packages/natives/scripts/build-native.ts`
- `packages/natives/scripts/embed-native.ts`
- `packages/natives/package.json`
- `crates/pi-natives/src/lib.rs`

## Camada 1: Camada de wrapper/API TypeScript

`packages/natives/src/index.ts` é o barrel público. Ele agrupa exportações por domínio de capacidade e re-exporta wrappers tipados em vez de expor bindings N-API brutos diretamente.

Grupos de nível superior atuais:

- **Primitivas de busca/texto**: `grep`, `glob`, `text`, `highlight`
- **Primitivas de execução/processo/terminal**: `shell`, `pty`, `ps`, `keys`
- **Primitivas de sistema/mídia/conversão**: `image`, `html`, `clipboard`, `system-info`, `work`

`packages/natives/src/bindings.ts` define o contrato base de interface:

- `NativeBindings` começa com membros compartilhados (`cancelWork(id: number)`)
- bindings específicos de módulo são adicionados por declaration merging a partir do `types.ts` de cada módulo
- `Cancellable` padroniza opções de timeout e abort-signal para wrappers que expõem cancelamento

**Contrato garantido (voltado para API):** consumidores importam de `@f5xc-salesdemos/pi-natives` e utilizam wrappers tipados.

**Detalhe de implementação (pode mudar):** declaration merging e layout interno de wrappers (`src/<module>/index.ts`, `src/<module>/types.ts`).

## Camada 2: Carregamento e validação do addon

`packages/natives/src/native.ts` é responsável pela seleção do addon em runtime, extração opcional e validação de exportações.

### Modelo de resolução de candidatos

- A tag de plataforma é `"${process.platform}-${process.arch}"`.
- As tags suportadas atualmente são:
  - `linux-x64`
  - `linux-arm64`
  - `darwin-x64`
  - `darwin-arm64`
  - `win32-x64`
- x64 pode usar variantes de CPU:
  - `modern` (com suporte a AVX2)
  - `baseline` (fallback)
- Não-x64 usa o nome de arquivo padrão (sem sufixo de variante).

Estratégia de nomes de arquivo:

- Release: `pi_natives.<platform>-<arch>.node`
- Release com variante x64: `pi_natives.<platform>-<arch>-modern.node` e/ou `...-baseline.node`
- `PI_DEV` habilita diagnósticos do loader, mas não altera os nomes de arquivo do addon

### Detecção de variante específica por plataforma

Para x64, a seleção de variante utiliza:

- **Linux**: `/proc/cpuinfo`
- **macOS**: `sysctl machdep.cpu.leaf7_features` / `machdep.cpu.features`
- **Windows**: verificação via PowerShell para `System.Runtime.Intrinsics.X86.Avx2`

`PI_NATIVE_VARIANT` pode forçar explicitamente `modern` ou `baseline`.

### Modelo de distribuição e extração de binários

`packages/natives/package.json` inclui tanto `src` quanto `native` nos arquivos publicados. O diretório `native/` armazena artefatos pré-compilados por plataforma.

Para binários compilados (marcadores de runtime `PI_COMPILED` ou Bun embedded), o comportamento do loader é:

1. Verificar caminho de cache do usuário versionado: `<getNativesDir()>/<packageVersion>/...`
2. Verificar localização legada de binário compilado:
   - Windows: `%LOCALAPPDATA%/xcsh` (fallback `%USERPROFILE%/AppData/Local/xcsh`)
   - não-Windows: `~/.local/bin`
3. Recorrer ao `native/` empacotado e candidatos no diretório do executável

Se um manifesto de addon embutido estiver presente (`embedded-addon.ts` gerado por `scripts/embed-native.ts`), `native.ts` pode materializar o binário embutido correspondente no diretório de cache versionado antes do carregamento.

### Validação e modos de falha

Após `require(candidate)`, `validateNative(...)` verifica as exportações necessárias (por exemplo `grep`, `glob`, `highlightCode`, `PtySession`, `Shell`, `getSystemInfo`, `getWorkProfile`, `invalidateFsScanCache`).

Os caminhos de falha são explícitos:

- **Tag de plataforma não suportada**: lança exceção com a lista de plataformas suportadas
- **Nenhum candidato carregável**: lança exceção com todos os caminhos tentados e dicas de remediação
- **Exportações ausentes**: lança exceção com os nomes exatos ausentes e comando de rebuild
- **Erros de extração de addon embutido**: registra falhas de diretório/escrita e as inclui nos diagnósticos finais de carregamento

**Contrato garantido (voltado para API):** o carregamento do addon ou é bem-sucedido com um conjunto de bindings validado ou falha rapidamente com texto de erro acionável.

**Detalhe de implementação (pode mudar):** ordem exata de busca de candidatos e ordenação do caminho de fallback de binários compilados.

## Camada 3: Camada de módulo Rust N-API

`crates/pi-natives/src/lib.rs` é o módulo de entrada Rust que declara a propriedade dos módulos exportados:

- `clipboard`
- `fd`
- `fs_cache`
- `glob`
- `glob_util`
- `grep`
- `highlight`
- `html`
- `image`
- `keys`
- `prof`
- `ps`
- `pty`
- `shell`
- `system_info`
- `task`
- `text`

Esses módulos implementam os símbolos N-API consumidos e validados por `native.ts`. Os nomes no nível JS são expostos através dos wrappers TS em `packages/natives/src`.

**Contrato garantido (voltado para API):** as exportações dos módulos Rust devem corresponder aos nomes de binding esperados por `validateNative` e módulos wrapper.

**Detalhe de implementação (pode mudar):** decomposição interna dos módulos Rust e fronteiras de módulos auxiliares (`glob_util`, `task`, etc.).

## Fronteiras de propriedade

No nível de arquitetura, a propriedade é dividida da seguinte forma:

- **Propriedade do wrapper/API TS (`packages/natives/src`)**
  - agrupamento de API pública, tipagem de opções e ergonomia JS estável
  - superfície de cancelamento (`timeoutMs`, `AbortSignal`) exposta aos chamadores
- **Propriedade do loader (`packages/natives/src/native.ts`)**
  - seleção de binário em runtime
  - seleção de variante de CPU e tratamento de override
  - extração de binário compilado e sondagem de candidatos
  - validação rígida das exportações nativas necessárias
- **Propriedade do Rust (`crates/pi-natives/src`)**
  - implementação algorítmica e em nível de sistema
  - comportamento nativo da plataforma e lógica sensível a desempenho
  - implementação de símbolos N-API que os wrappers TS consomem

## Fluxo em runtime (alto nível)

1. O consumidor importa de `@f5xc-salesdemos/pi-natives`.
2. O módulo wrapper faz chamadas ao binding singleton `native`.
3. `native.ts` seleciona o binário candidato para plataforma/arch/variante.
4. A extração opcional de binário embutido ocorre para distribuições compiladas.
5. O addon é carregado e o conjunto de exportações é validado.
6. O wrapper retorna resultados tipados ao chamador.

## Glossário

- **Addon nativo**: Um binário `.node` carregado via Node-API (N-API).
- **Tag de plataforma**: Tupla de runtime `platform-arch` (por exemplo `darwin-arm64`).
- **Variante**: Flavor de build específico para CPU x64 (`modern` AVX2, `baseline` fallback).
- **Wrapper**: Função/classe TS que fornece API tipada sobre exportações nativas brutas.
- **Declaration merging**: Técnica TS utilizada pelos arquivos `types.ts` dos módulos para estender `NativeBindings`.
- **Modo de binário compilado**: Modo de runtime onde a CLI é empacotada e os addons nativos são resolvidos a partir de caminhos extraídos/cache em vez de apenas caminhos locais do pacote.
- **Addon embutido**: Metadados de artefato de build e referências de arquivo gerados em `embedded-addon.ts` para que binários compilados possam extrair payloads `.node` correspondentes.
- **Gate de validação**: Verificação `validateNative(...)` que rejeita binários obsoletos/incompatíveis que estejam sem as exportações necessárias.
