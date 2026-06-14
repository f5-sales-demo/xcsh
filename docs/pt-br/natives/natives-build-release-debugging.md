---
title: 'Runbook de Build, Release e Depuração de Nativos'
description: >-
  Runbook de build, release e depuração do addon nativo em Rust para múltiplas
  plataformas.
sidebar:
  order: 8
  label: 'Build, release e depuração'
i18n:
  sourceHash: 35e5eb6a16f0
  translator: machine
---

# Runbook de Build, Release e Depuração de Nativos

Este runbook descreve como o pipeline de build do `@f5xc-salesdemos/pi-natives` produz addons `.node`, como as distribuições compiladas os carregam e como depurar falhas de carregamento/build.

Segue os termos de arquitetura de `docs/natives-architecture.md`:

- **produção de artefatos em tempo de build** (`scripts/build-native.ts`)
- **geração de manifesto de addon embutido** (`scripts/embed-native.ts`)
- **carregamento de addon em tempo de execução + porta de validação** (`src/native.ts`)

## Arquivos de implementação

- `packages/natives/scripts/build-native.ts`
- `packages/natives/scripts/embed-native.ts`
- `packages/natives/package.json`
- `packages/natives/src/native.ts`
- `crates/pi-natives/Cargo.toml`

## Visão geral do pipeline de build

### 1) Pontos de entrada do build

Scripts do `packages/natives/package.json`:

- `bun scripts/build-native.ts` (`build`) → build de release
- `bun scripts/build-native.ts --dev` (`dev:native`) → build com perfil debug/dev (mesma nomenclatura de saída)
- `bun scripts/embed-native.ts` (`embed:native`) → gera `src/embedded-addon.ts` a partir dos arquivos compilados

### 2) Build do artefato Rust

`build-native.ts` executa o Cargo em `crates/pi-natives`:

- comando base: `cargo build`
- modo release adiciona `--release` a menos que `--dev` seja passado
- target de cross-compilação adiciona `--target <CROSS_TARGET>`

`crates/pi-natives/Cargo.toml` declara `crate-type = ["cdylib"]`, portanto o Cargo emite uma biblioteca compartilhada (`.so`/`.dylib`/`.dll`) que é então copiada/renomeada para um nome de arquivo de addon `.node`.

### 3) Descoberta e instalação do artefato

Após a conclusão do Cargo, `build-native.ts` verifica os diretórios de saída candidatos na seguinte ordem:

1. `${CARGO_TARGET_DIR}` (se definido)
2. `<repo>/target`
3. `crates/pi-natives/target`

Para cada raiz, verifica os diretórios de perfil:

- cross build: `<root>/<crossTarget>/<profile>` e então `<root>/<profile>`
- build nativo: `<root>/<profile>`

Em seguida, busca por um dos seguintes arquivos:

- `libpi_natives.so`
- `libpi_natives.dylib`
- `pi_natives.dll`
- `libpi_natives.dll`

Quando encontrado, é instalado atomicamente em `packages/natives/native/` com semântica de arquivo temporário + renomeação (o fallback para Windows trata explicitamente as falhas de substituição de DLL bloqueada).

## Modelo de target/variante e convenções de nomenclatura

## Tag de plataforma

Tanto o build quanto o tempo de execução utilizam a tag de plataforma:

`<platform>-<arch>` (exemplos: `darwin-arm64`, `linux-x64`)

## Modelo de variante (somente x64)

x64 suporta variantes de CPU:

- `modern` (caminho com suporte a AVX2)
- `baseline` (fallback)

Arquiteturas não-x64 utilizam um único artefato padrão (sem sufixo de variante).

### Nomes dos arquivos de saída

Builds de release:

- x64: `pi_natives.<platform>-<arch>-modern.node` ou `...-baseline.node`
- não-x64: `pi_natives.<platform>-<arch>.node`

Build dev (`--dev`):

- Utiliza flags de perfil debug, mas mantém a nomenclatura de saída padrão com tag de plataforma

Ordem dos candidatos do carregador em tempo de execução em `native.ts`:

- candidatos de release
- no modo compilado, candidatos extraídos/em cache são inseridos antes dos arquivos locais do pacote

## Flags de ambiente e opções de build

## Flags de tempo de execução

- `PI_DEV` (comportamento do carregador): habilita diagnósticos do carregador
- `PI_NATIVE_VARIANT` (comportamento do carregador, somente x64): força a seleção de `modern` ou `baseline` em tempo de execução
- `PI_COMPILED` (comportamento do carregador): habilita o comportamento de candidato/extração do binário compilado

## Flags/opções de tempo de build

- `--dev` (argumento do script): build com perfil debug
- `CROSS_TARGET`: passado para o Cargo via `--target`
- `TARGET_PLATFORM`: sobrepõe a nomenclatura da tag de plataforma na saída
- `TARGET_ARCH`: sobrepõe a nomenclatura da arquitetura na saída
- `TARGET_VARIANT` (somente x64): força `modern` ou `baseline` para o nome do arquivo de saída e política de RUSTFLAGS
- `CARGO_TARGET_DIR`: raiz adicional ao buscar saídas do Cargo
- `RUSTFLAGS`:
  - se não definido e sem cross-compilação, o script define:
    - modern: `-C target-cpu=x86-64-v3`
    - baseline: `-C target-cpu=x86-64-v2`
    - não-x64 / sem variante: `-C target-cpu=native`
  - se já definido, o script não sobrepõe

## Transições de estado/ciclo de vida do build

### Ciclo de vida do build (`build-native.ts`)

1. **Init**: analisa args/env (`--dev`, sobreposições de target, flags de cross)
2. **Resolução de variante**:
   - não-x64 → sem variante
   - x64 + `TARGET_VARIANT` → variante explícita
   - cross-build x64 sem `TARGET_VARIANT` → erro fatal
   - build local x64 sem sobreposição → detecta AVX2 do host
3. **Compilação**: executa o Cargo com perfil/target resolvidos
4. **Localização do artefato**: varre as raízes de target, diretórios de perfil e nomes de biblioteca
5. **Instalação**: copia + renomeação atômica em `packages/natives/native`
6. **Conclusão**: addon de saída pronto para candidatos do carregador

Falhas de execução ocorrem em qualquer etapa com texto de erro explícito (variante inválida, falha no build do cargo, biblioteca de saída ausente, falha na instalação/renomeação).

### Ciclo de vida do embed (`embed-native.ts`)

1. **Init**: calcula a tag de plataforma a partir de `TARGET_PLATFORM`/`TARGET_ARCH` ou valores do host
2. **Conjunto de candidatos**:
   - x64 espera ambos `modern` e `baseline`
   - não-x64 espera um arquivo padrão
3. **Validação de disponibilidade** em `packages/natives/native`
4. **Geração do manifesto** (`src/embedded-addon.ts`) com imports `file` do Bun e versão do pacote
5. **Extração em tempo de execução pronta** para o modo compilado

`--reset` ignora a validação e escreve um stub de manifesto nulo (`embeddedAddon = null`).

## Fluxo de desenvolvimento local vs. comportamento compilado/distribuído

## Fluxo de desenvolvimento local

Loop local típico:

1. Compilar o addon:
   - release: `bun --cwd=packages/natives run build`
   - perfil debug: `bun --cwd=packages/natives run dev:native`
2. Definir `PI_DEV=1` ao testar diagnósticos do carregador
3. O carregador em `native.ts` resolve candidatos em `native/` local do pacote (e fallback para o diretório do executável)
4. `validateNative` verifica a compatibilidade de exports antes de os wrappers utilizarem o binding

## Fluxo de binário compilado/distribuído

No modo compilado (`PI_COMPILED` ou marcadores embutidos do Bun):

1. O carregador calcula o diretório de cache versionado: `<getNativesDir()>/<packageVersion>` (operacionalmente `~/.xcsh/natives/<version>`)
2. Se o manifesto embutido corresponder à plataforma+versão atual, o carregador pode extrair o arquivo embutido selecionado para esse diretório versionado
3. A ordem dos candidatos em tempo de execução inclui:
   - diretório de cache versionado
   - diretório legado de binário compilado (`%LOCALAPPDATA%/xcsh` no Windows, `~/.local/bin` nos demais)
   - diretórios do pacote/executável
4. O primeiro addon carregado com sucesso ainda deve passar em `validateNative`

É por isso que as expectativas de empacotamento e do carregador em tempo de execução devem estar alinhadas: nomes de arquivos, tags de plataforma e símbolos exportados devem corresponder ao que `native.ts` verifica e valida.

## Mapeamento JS API ↔ export Rust (subconjunto da porta de validação)

`native.ts` exige que estes exports visíveis em JS existam no addon carregado. Eles mapeiam para os exports N-API em Rust em `crates/pi-natives/src`:

| Nome JS exigido por `validateNative` | Declaração de export Rust | Arquivo fonte Rust |
| --- | --- | --- |
| `glob` | `#[napi] pub fn glob(...)` | `crates/pi-natives/src/glob.rs` |
| `grep` | `#[napi] pub fn grep(...)` | `crates/pi-natives/src/grep.rs` |
| `search` | `#[napi] pub fn search(...)` | `crates/pi-natives/src/grep.rs` |
| `highlightCode` | `#[napi] pub fn highlight_code(...)` | `crates/pi-natives/src/highlight.rs` |
| `getSystemInfo` | `#[napi] pub fn get_system_info(...)` | `crates/pi-natives/src/system_info.rs` |
| `getWorkProfile` | `#[napi] pub fn get_work_profile(...)` (export em camelCase) | `crates/pi-natives/src/prof.rs` |
| `invalidateFsScanCache` | `#[napi] pub fn invalidate_fs_scan_cache(...)` | `crates/pi-natives/src/fs_cache.rs` |

Se algum símbolo obrigatório estiver ausente, o carregador falha imediatamente com uma dica de rebuild.

## Comportamento de falha e diagnósticos

## Falhas em tempo de build

- Configuração de variante inválida:
  - `TARGET_VARIANT` definido em não-x64 → erro imediato
  - cross-build x64 sem `TARGET_VARIANT` explícito → erro imediato
- Falha no build do Cargo:
  - o script exibe saída não-zero e stderr
- Artefato não encontrado:
  - o script exibe todos os diretórios de perfil verificados
- Falha na instalação:
  - mensagem explícita; no Windows inclui dica sobre arquivo bloqueado

## Falhas do carregador em tempo de execução (`native.ts`)

- Tag de plataforma não suportada:
  - lança exceção com a lista de plataformas suportadas
- Nenhum candidato pôde ser carregado:
  - lança exceção com a lista completa de erros dos candidatos e dicas de correção específicas ao modo
- Exports ausentes:
  - lança exceção com os nomes exatos dos símbolos ausentes e o comando de rebuild
- Problemas na extração do addon embutido:
  - erros de mkdir/escrita na extração são registrados e incluídos nos diagnósticos finais

## Matriz de resolução de problemas

| Sintoma | Causa provável | Verificar | Correção |
| --- | --- | --- | --- |
| `Native addon missing exports ... Missing: <name>` | Binário `.node` desatualizado, nome de export Rust incompatível ou binário errado carregado | Execute com `PI_DEV=1` para ver o caminho carregado; inspecione a lista de exports desse arquivo | Reconstrua com `build`; certifique-se de que o nome do export `#[napi]` no Rust (ou alias explícito quando necessário) corresponde à chave JS; remova arquivos em cache/versionados desatualizados |
| Máquina x64 carrega baseline quando modern é esperado | `PI_NATIVE_VARIANT=baseline`, AVX2 não detectado ou somente o arquivo baseline está presente | Verifique `PI_NATIVE_VARIANT`; inspecione `native/` em busca do arquivo `-modern` | Compile a variante modern (`TARGET_VARIANT=modern ... build`) e certifique-se de que o arquivo é distribuído |
| Cross-build produz binário inutilizável/com rótulo errado | Incompatibilidade entre `CROSS_TARGET` e `TARGET_PLATFORM`/`TARGET_ARCH`, ou `TARGET_VARIANT` ausente para x64 | Confirme a tupla de env e o nome do arquivo de saída | Execute novamente com valores de env consistentes e `TARGET_VARIANT` explícito para x64 |
| Binário compilado falha após atualização | Cache extraído desatualizado (`~/.xcsh/natives/<versão-antiga-ou-incompatível>`) ou incompatibilidade no manifesto embutido | Inspecione o diretório de nativos versionado e a lista de erros do carregador | Exclua o cache de nativos versionado para a versão do pacote e execute novamente; regenere o manifesto embutido durante o empacotamento |
| O carregador verifica muitos caminhos e nenhum funciona | Incompatibilidade de plataforma ou artefato de release ausente em `native/` do pacote | Verifique `platformTag` em relação ao(s) nome(s) de arquivo real(is) | Certifique-se de que o nome do arquivo compilado corresponde exatamente à convenção `pi_natives.<platform>-<arch>(-variant).node` e que o pacote inclui `native/` |
| `embed:native` falha com "Incomplete native addons" | Arquivos de variante necessários não foram compilados antes do embedding | Verifique a lista de esperados vs. encontrados no texto do erro | Compile os arquivos necessários primeiro (x64: ambos modern+baseline; não-x64: padrão) e execute `embed:native` novamente |

## Comandos operacionais

```bash
# Artefato de release para o host atual
bun --cwd=packages/natives run build

# Build de artefato com perfil debug
bun --cwd=packages/natives run dev:native

# Compilar variantes x64 explícitas
TARGET_VARIANT=modern bun --cwd=packages/natives run build
TARGET_VARIANT=baseline bun --cwd=packages/natives run build

# Gerar manifesto de addon embutido a partir dos arquivos nativos compilados
bun --cwd=packages/natives run embed:native

# Redefinir manifesto embutido para stub nulo
bun --cwd=packages/natives run embed:native -- --reset
```
