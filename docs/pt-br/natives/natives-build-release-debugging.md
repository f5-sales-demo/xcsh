---
title: 'Natives Build, Release, and Debugging Runbook'
description: >-
  Runbook de build, release e depuração para o addon nativo Rust em múltiplas
  plataformas.
sidebar:
  order: 8
  label: 'Build, release e depuração'
i18n:
  sourceHash: 35e5eb6a16f0
  translator: machine
---

# Runbook de Build, Release e Depuração de Natives

Este runbook descreve como o pipeline de build do `@f5xc-salesdemos/pi-natives` produz addons `.node`, como as distribuições compiladas os carregam e como depurar falhas de loader/build.

Ele segue os termos de arquitetura de `docs/natives-architecture.md`:

- **produção de artefatos em tempo de build** (`scripts/build-native.ts`)
- **geração de manifesto de addon embutido** (`scripts/embed-native.ts`)
- **carregamento de addon em runtime + portão de validação** (`src/native.ts`)

## Arquivos de implementação

- `packages/natives/scripts/build-native.ts`
- `packages/natives/scripts/embed-native.ts`
- `packages/natives/package.json`
- `packages/natives/src/native.ts`
- `crates/pi-natives/Cargo.toml`

## Visão geral do pipeline de build

### 1) Pontos de entrada do build

Scripts em `packages/natives/package.json`:

- `bun scripts/build-native.ts` (`build`) → build de release
- `bun scripts/build-native.ts --dev` (`dev:native`) → build com perfil debug/dev (mesma nomenclatura de saída)
- `bun scripts/embed-native.ts` (`embed:native`) → gera `src/embedded-addon.ts` a partir dos arquivos compilados

### 2) Build do artefato Rust

`build-native.ts` executa o Cargo em `crates/pi-natives`:

- comando base: `cargo build`
- modo release adiciona `--release` a menos que `--dev` seja passado
- target cruzado adiciona `--target <CROSS_TARGET>`

`crates/pi-natives/Cargo.toml` declara `crate-type = ["cdylib"]`, então o Cargo emite uma biblioteca compartilhada (`.so`/`.dylib`/`.dll`) que é então copiada/renomeada para um nome de arquivo de addon `.node`.

### 3) Descoberta e instalação do artefato

Após o Cargo completar, `build-native.ts` examina diretórios candidatos de saída em ordem:

1. `${CARGO_TARGET_DIR}` (se definido)
2. `<repo>/target`
3. `crates/pi-natives/target`

Para cada raiz, ele verifica diretórios de perfil:

- build cruzado: `<root>/<crossTarget>/<profile>` depois `<root>/<profile>`
- build nativo: `<root>/<profile>`

Em seguida, procura por um dos seguintes:

- `libpi_natives.so`
- `libpi_natives.dylib`
- `pi_natives.dll`
- `libpi_natives.dll`

Quando encontrado, instala atomicamente em `packages/natives/native/` com semântica de arquivo temporário + renomeação (o fallback do Windows lida explicitamente com falhas de substituição de DLL bloqueada).

## Modelo de target/variante e convenções de nomenclatura

## Tag de plataforma

Tanto o build quanto o runtime usam a tag de plataforma:

`<platform>-<arch>` (exemplo: `darwin-arm64`, `linux-x64`)

## Modelo de variante (apenas x64)

x64 suporta variantes de CPU:

- `modern` (caminho com capacidade AVX2)
- `baseline` (fallback)

Não-x64 usa um único artefato padrão (sem sufixo de variante).

### Nomes de arquivo de saída

Builds de release:

- x64: `pi_natives.<platform>-<arch>-modern.node` ou `...-baseline.node`
- não-x64: `pi_natives.<platform>-<arch>.node`

Build dev (`--dev`):

- Usa flags de perfil debug, mas mantém a nomenclatura padrão de saída com tag de plataforma

Ordem de candidatos do loader em runtime em `native.ts`:

- candidatos de release
- modo compilado prepende candidatos extraídos/cache antes dos arquivos locais do pacote

## Flags de ambiente e opções de build

## Flags de runtime

- `PI_DEV` (comportamento do loader): habilita diagnósticos do loader
- `PI_NATIVE_VARIANT` (comportamento do loader, apenas x64): força seleção `modern` ou `baseline` em runtime
- `PI_COMPILED` (comportamento do loader): habilita comportamento de candidato/extração de binário compilado

## Flags/opções em tempo de build

- `--dev` (argumento do script): build com perfil debug
- `CROSS_TARGET`: passado para `--target` do Cargo
- `TARGET_PLATFORM`: sobrescreve a nomenclatura da tag de plataforma na saída
- `TARGET_ARCH`: sobrescreve a nomenclatura da arquitetura na saída
- `TARGET_VARIANT` (apenas x64): força `modern` ou `baseline` para o nome do arquivo de saída e política de RUSTFLAGS
- `CARGO_TARGET_DIR`: raiz adicional ao buscar saídas do Cargo
- `RUSTFLAGS`:
  - se não definido e não compilando cruzado, o script define:
    - modern: `-C target-cpu=x86-64-v3`
    - baseline: `-C target-cpu=x86-64-v2`
    - não-x64 / sem variante: `-C target-cpu=native`
  - se já definido, o script não sobrescreve

## Transições de estado/ciclo de vida do build

### Ciclo de vida do build (`build-native.ts`)

1. **Init**: analisa args/env (`--dev`, sobrescritas de target, flags de cross)
2. **Resolução de variante**:
   - não-x64 → sem variante
   - x64 + `TARGET_VARIANT` → variante explícita
   - x64 cross-build sem `TARGET_VARIANT` → erro fatal
   - x64 build local sem sobrescrita → detecta AVX2 do host
3. **Compilação**: executa Cargo com perfil/target resolvidos
4. **Localizar artefato**: examina raízes de target/diretórios de perfil/nomes de biblioteca
5. **Instalar**: copiar + renomeação atômica em `packages/natives/native`
6. **Completo**: addon de saída pronto para candidatos do loader

Saídas com falha acontecem em qualquer estágio com texto de erro explícito (variante inválida, falha no build do cargo, biblioteca de saída ausente, falha na instalação/renomeação).

### Ciclo de vida do embed (`embed-native.ts`)

1. **Init**: computa a tag de plataforma a partir de `TARGET_PLATFORM`/`TARGET_ARCH` ou valores do host
2. **Conjunto de candidatos**:
   - x64 espera tanto `modern` quanto `baseline`
   - não-x64 espera um arquivo padrão
3. **Validar disponibilidade** em `packages/natives/native`
4. **Gerar manifesto** (`src/embedded-addon.ts`) com imports `file` do Bun e versão do pacote
5. **Extração em runtime pronta** para modo compilado

`--reset` ignora a validação e escreve um stub de manifesto nulo (`embeddedAddon = null`).

## Fluxo de trabalho dev vs comportamento distribuído/compilado

## Fluxo de trabalho de desenvolvimento local

Loop local típico:

1. Compilar addon:
   - release: `bun --cwd=packages/natives run build`
   - perfil debug: `bun --cwd=packages/natives run dev:native`
2. Definir `PI_DEV=1` ao testar diagnósticos do loader
3. O loader em `native.ts` resolve candidatos do `native/` local do pacote (e fallback do diretório do executável)
4. `validateNative` garante compatibilidade de exports antes que os wrappers usem o binding

## Fluxo de trabalho de binário distribuído/compilado

No modo compilado (`PI_COMPILED` ou marcadores embutidos do Bun):

1. O loader computa diretório de cache versionado: `<getNativesDir()>/<packageVersion>` (operacionalmente `~/.xcsh/natives/<version>`)
2. Se o manifesto embutido corresponde à plataforma+versão atual, o loader pode extrair o arquivo embutido selecionado naquele diretório versionado
3. A ordem de candidatos em runtime inclui:
   - diretório de cache versionado
   - diretório legado de binário compilado (`%LOCALAPPDATA%/xcsh` no Windows, `~/.local/bin` nos demais)
   - diretórios do pacote/executável
4. O primeiro addon carregado com sucesso ainda deve passar pela `validateNative`

É por isso que as expectativas de empacotamento + loader em runtime devem estar alinhadas: nomes de arquivo, tags de plataforma e símbolos exportados devem corresponder ao que `native.ts` sonda e valida.

## Mapeamento API JS ↔ export Rust (subconjunto do portão de validação)

`native.ts` exige que estes exports visíveis ao JS existam no addon carregado. Eles mapeiam para exports N-API do Rust em `crates/pi-natives/src`:

| Nome JS exigido por `validateNative` | Declaração de export Rust | Arquivo fonte Rust |
| --- | --- | --- |
| `glob` | `#[napi] pub fn glob(...)` | `crates/pi-natives/src/glob.rs` |
| `grep` | `#[napi] pub fn grep(...)` | `crates/pi-natives/src/grep.rs` |
| `search` | `#[napi] pub fn search(...)` | `crates/pi-natives/src/grep.rs` |
| `highlightCode` | `#[napi] pub fn highlight_code(...)` | `crates/pi-natives/src/highlight.rs` |
| `getSystemInfo` | `#[napi] pub fn get_system_info(...)` | `crates/pi-natives/src/system_info.rs` |
| `getWorkProfile` | `#[napi] pub fn get_work_profile(...)` (export em camelCase) | `crates/pi-natives/src/prof.rs` |
| `invalidateFsScanCache` | `#[napi] pub fn invalidate_fs_scan_cache(...)` | `crates/pi-natives/src/fs_cache.rs` |

Se qualquer símbolo exigido estiver ausente, o loader falha imediatamente com uma dica de rebuild.

## Comportamento de falha e diagnósticos

## Falhas em tempo de build

- Configuração de variante inválida:
  - `TARGET_VARIANT` definido em não-x64 → erro imediato
  - x64 cross-build sem `TARGET_VARIANT` explícito → erro imediato
- Falha no build do Cargo:
  - o script exibe saída diferente de zero e stderr
- Artefato não encontrado:
  - o script imprime cada diretório de perfil verificado
- Falha na instalação:
  - mensagem explícita; Windows inclui dica de arquivo bloqueado

## Falhas do loader em runtime (`native.ts`)

- Tag de plataforma não suportada:
  - lança exceção com lista de plataformas suportadas
- Nenhum candidato pôde ser carregado:
  - lança exceção com lista completa de erros de candidatos e dicas de remediação específicas do modo
- Exports ausentes:
  - lança exceção com nomes exatos dos símbolos ausentes e comando de rebuild
- Problemas de extração embutida:
  - erros de mkdir/write na extração são registrados e incluídos nos diagnósticos finais

## Matriz de troubleshooting

| Sintoma | Causa provável | Verificar | Correção |
| --- | --- | --- | --- |
| `Native addon missing exports ... Missing: <name>` | Binário `.node` desatualizado, incompatibilidade de nome de export Rust, ou binário errado carregado | Execute com `PI_DEV=1` para ver o caminho carregado; inspecione a lista de exports daquele arquivo | Recompile com `build`; certifique-se de que o nome do export `#[napi]` do Rust (ou alias explícito quando necessário) corresponde à chave JS; remova arquivos versionados/em cache desatualizados |
| Máquina x64 carrega baseline quando modern era esperado | `PI_NATIVE_VARIANT=baseline`, AVX2 não detectado, ou apenas arquivo baseline presente | Verifique `PI_NATIVE_VARIANT`; inspecione `native/` pelo arquivo `-modern` | Compile a variante modern (`TARGET_VARIANT=modern ... build`) e certifique-se de que o arquivo está incluído |
| Cross-build produz binário inutilizável/com rótulo errado | Incompatibilidade entre `CROSS_TARGET` e `TARGET_PLATFORM`/`TARGET_ARCH`, ou `TARGET_VARIANT` ausente para x64 | Confirme a tupla de env e o nome do arquivo de saída | Re-execute com valores de env consistentes e `TARGET_VARIANT` explícito para x64 |
| Binário compilado falha após atualização | Cache extraído desatualizado (`~/.xcsh/natives/<versão-antiga-ou-incompatível>`) ou incompatibilidade no manifesto embutido | Inspecione o diretório versionado de natives e a lista de erros do loader | Delete o cache versionado de natives para a versão do pacote e re-execute; regenere o manifesto embutido durante o empacotamento |
| Loader sonda muitos caminhos e nenhum funciona | Incompatibilidade de plataforma ou artefato de release ausente no `native/` do pacote | Verifique `platformTag` vs nome(s) de arquivo reais | Certifique-se de que o nome do arquivo compilado corresponde exatamente à convenção `pi_natives.<platform>-<arch>(-variant).node` e que o pacote inclui `native/` |
| `embed:native` falha com "Incomplete native addons" | Arquivos de variante necessários não foram compilados antes do embedding | Verifique a lista esperada vs encontrada no texto do erro | Compile os arquivos necessários primeiro (x64: tanto modern quanto baseline; não-x64: padrão), depois re-execute `embed:native` |

## Comandos operacionais

```bash
# Release artifact for current host
bun --cwd=packages/natives run build

# Debug profile artifact build
bun --cwd=packages/natives run dev:native

# Build explicit x64 variants
TARGET_VARIANT=modern bun --cwd=packages/natives run build
TARGET_VARIANT=baseline bun --cwd=packages/natives run build

# Generate embedded addon manifest from built native files
bun --cwd=packages/natives run embed:native

# Reset embedded manifest to null stub
bun --cwd=packages/natives run embed:native -- --reset
```
