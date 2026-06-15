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

Este runbook descreve como o pipeline de build do `@f5xc-salesdemos/pi-natives` produz addons `.node`, como as distribuições compiladas os carregam e como depurar falhas de carregador/build.

Segue os termos de arquitetura de `docs/natives-architecture.md`:

- **produção de artefatos em tempo de build** (`scripts/build-native.ts`)
- **geração de manifesto de addon embutido** (`scripts/embed-native.ts`)
- **carregamento de addon em runtime + porta de validação** (`src/native.ts`)

## Arquivos de implementação

- `packages/natives/scripts/build-native.ts`
- `packages/natives/scripts/embed-native.ts`
- `packages/natives/package.json`
- `packages/natives/src/native.ts`
- `crates/pi-natives/Cargo.toml`

## Visão geral do pipeline de build

### 1) Entrypoints de build

Scripts em `packages/natives/package.json`:

- `bun scripts/build-native.ts` (`build`) → build de release
- `bun scripts/build-native.ts --dev` (`dev:native`) → build de perfil debug/dev (mesma nomenclatura de saída)
- `bun scripts/embed-native.ts` (`embed:native`) → gerar `src/embedded-addon.ts` a partir dos arquivos compilados

### 2) Build do artefato Rust

`build-native.ts` executa o Cargo em `crates/pi-natives`:

- comando base: `cargo build`
- modo release adiciona `--release`, a menos que `--dev` seja passado
- alvo de cross-compilação adiciona `--target <CROSS_TARGET>`

`crates/pi-natives/Cargo.toml` declara `crate-type = ["cdylib"]`, portanto o Cargo emite uma biblioteca compartilhada (`.so`/`.dylib`/`.dll`) que é então copiada/renomeada para um nome de arquivo de addon `.node`.

### 3) Descoberta e instalação do artefato

Após a conclusão do Cargo, `build-native.ts` verifica os diretórios de saída candidatos na seguinte ordem:

1. `${CARGO_TARGET_DIR}` (se definido)
2. `<repo>/target`
3. `crates/pi-natives/target`

Para cada raiz, verifica os diretórios de perfil:

- cross build: `<root>/<crossTarget>/<profile>` depois `<root>/<profile>`
- build nativo: `<root>/<profile>`

Em seguida, procura por um dos seguintes:

- `libpi_natives.so`
- `libpi_natives.dylib`
- `pi_natives.dll`
- `libpi_natives.dll`

Quando encontrado, instala atomicamente em `packages/natives/native/` com semântica de arquivo temporário + renomeação (o fallback do Windows trata explicitamente falhas de substituição de DLL bloqueada).

## Modelo de alvo/variante e convenções de nomenclatura

## Tag de plataforma

Tanto o build quanto o runtime utilizam a tag de plataforma:

`<platform>-<arch>` (exemplo: `darwin-arm64`, `linux-x64`)

## Modelo de variante (somente x64)

x64 suporta variantes de CPU:

- `modern` (caminho com suporte a AVX2)
- `baseline` (fallback)

Arquiteturas diferentes de x64 utilizam um único artefato padrão (sem sufixo de variante).

### Nomes de arquivo de saída

Builds de release:

- x64: `pi_natives.<platform>-<arch>-modern.node` ou `...-baseline.node`
- não-x64: `pi_natives.<platform>-<arch>.node`

Build de dev (`--dev`):

- Utiliza flags de perfil debug, mas mantém a nomenclatura de saída padrão com tag de plataforma

Ordem dos candidatos do carregador em `native.ts`:

- candidatos de release
- o modo compilado antepõe candidatos extraídos/em cache antes dos arquivos locais do pacote

## Flags de ambiente e opções de build

## Flags de runtime

- `PI_DEV` (comportamento do carregador): ativa diagnósticos do carregador
- `PI_NATIVE_VARIANT` (comportamento do carregador, somente x64): força a seleção de `modern` ou `baseline` em runtime
- `PI_COMPILED` (comportamento do carregador): ativa o comportamento de candidato/extração para binário compilado

## Flags/opções em tempo de build

- `--dev` (argumento do script): compila perfil debug
- `CROSS_TARGET`: passado ao `--target` do Cargo
- `TARGET_PLATFORM`: sobrescreve a nomenclatura da tag de plataforma na saída
- `TARGET_ARCH`: sobrescreve a nomenclatura de arquitetura na saída
- `TARGET_VARIANT` (somente x64): força `modern` ou `baseline` para o nome do arquivo de saída e política de RUSTFLAGS
- `CARGO_TARGET_DIR`: raiz adicional ao buscar saídas do Cargo
- `RUSTFLAGS`:
  - se não definido e sem cross-compilação, o script define:
    - modern: `-C target-cpu=x86-64-v3`
    - baseline: `-C target-cpu=x86-64-v2`
    - não-x64 / sem variante: `-C target-cpu=native`
  - se já definido, o script não sobrescreve

## Transições de estado/ciclo de vida do build

### Ciclo de vida do build (`build-native.ts`)

1. **Init**: analisa args/env (`--dev`, sobrescritas de alvo, flags de cross)
2. **Resolução de variante**:
   - não-x64 → sem variante
   - x64 + `TARGET_VARIANT` → variante explícita
   - cross-build x64 sem `TARGET_VARIANT` → erro fatal
   - build local x64 sem sobrescrita → detecta AVX2 do host
3. **Compilação**: executa o Cargo com perfil/alvo resolvidos
4. **Localização do artefato**: varre raízes de alvo/diretórios de perfil/nomes de biblioteca
5. **Instalação**: copia + renomeação atômica em `packages/natives/native`
6. **Conclusão**: addon de saída pronto para candidatos do carregador

As saídas por falha ocorrem em qualquer etapa com texto de erro explícito (variante inválida, falha no build do cargo, biblioteca de saída ausente, falha de instalação/renomeação).

### Ciclo de vida do embed (`embed-native.ts`)

1. **Init**: computa a tag de plataforma a partir de `TARGET_PLATFORM`/`TARGET_ARCH` ou dos valores do host
2. **Conjunto de candidatos**:
   - x64 espera ambos `modern` e `baseline`
   - não-x64 espera um arquivo padrão
3. **Valida disponibilidade** em `packages/natives/native`
4. **Gera manifesto** (`src/embedded-addon.ts`) com imports `file` do Bun e versão do pacote
5. **Extração em runtime pronta** para o modo compilado

`--reset` ignora a validação e escreve um stub de manifesto nulo (`embeddedAddon = null`).

## Fluxo de desenvolvimento local vs. comportamento compilado/distribuído

## Fluxo de trabalho de desenvolvimento local

Loop local típico:

1. Compilar o addon:
   - release: `bun --cwd=packages/natives run build`
   - perfil debug: `bun --cwd=packages/natives run dev:native`
2. Definir `PI_DEV=1` ao testar diagnósticos do carregador
3. O carregador em `native.ts` resolve candidatos em `native/` local ao pacote (e fallback de diretório do executável)
4. `validateNative` impõe a compatibilidade de exports antes que os wrappers utilizem o binding

## Fluxo de trabalho de binário compilado/distribuído

No modo compilado (`PI_COMPILED` ou marcadores embutidos do Bun):

1. O carregador computa o diretório de cache versionado: `<getNativesDir()>/<packageVersion>` (operacionalmente `~/.xcsh/natives/<version>`)
2. Se o manifesto embutido corresponder à plataforma+versão atual, o carregador pode extrair o arquivo embutido selecionado para esse diretório versionado
3. A ordem dos candidatos em runtime inclui:
   - diretório de cache versionado
   - diretório legado de binário compilado (`%LOCALAPPDATA%/xcsh` no Windows, `~/.local/bin` em outros sistemas)
   - diretórios do pacote/executável
4. O primeiro addon carregado com sucesso ainda deve passar por `validateNative`

É por isso que as expectativas de empacotamento e do carregador em runtime devem estar alinhadas: nomes de arquivo, tags de plataforma e símbolos exportados devem corresponder ao que `native.ts` sonda e valida.

## Mapeamento de API JS ↔ export Rust (subconjunto da porta de validação)

`native.ts` exige que esses exports visíveis em JS existam no addon carregado. Eles mapeiam para exports N-API em Rust em `crates/pi-natives/src`:

| Nome JS exigido por `validateNative` | Declaração de export Rust | Arquivo-fonte Rust |
| --- | --- | --- |
| `glob` | `#[napi] pub fn glob(...)` | `crates/pi-natives/src/glob.rs` |
| `grep` | `#[napi] pub fn grep(...)` | `crates/pi-natives/src/grep.rs` |
| `search` | `#[napi] pub fn search(...)` | `crates/pi-natives/src/grep.rs` |
| `highlightCode` | `#[napi] pub fn highlight_code(...)` | `crates/pi-natives/src/highlight.rs` |
| `getSystemInfo` | `#[napi] pub fn get_system_info(...)` | `crates/pi-natives/src/system_info.rs` |
| `getWorkProfile` | `#[napi] pub fn get_work_profile(...)` (export em camelCase) | `crates/pi-natives/src/prof.rs` |
| `invalidateFsScanCache` | `#[napi] pub fn invalidate_fs_scan_cache(...)` | `crates/pi-natives/src/fs_cache.rs` |

Se algum símbolo obrigatório estiver ausente, o carregador falha imediatamente com uma dica de rebuild.

## Comportamento em caso de falha e diagnósticos

## Falhas em tempo de build

- Configuração de variante inválida:
  - `TARGET_VARIANT` definido em não-x64 → erro imediato
  - cross-build x64 sem `TARGET_VARIANT` explícito → erro imediato
- Falha no build do Cargo:
  - o script exibe saída não-zero e stderr
- Artefato não encontrado:
  - o script imprime cada diretório de perfil verificado
- Falha na instalação:
  - mensagem explícita; no Windows inclui dica sobre arquivo bloqueado

## Falhas do carregador em runtime (`native.ts`)

- Tag de plataforma não suportada:
  - lança exceção com a lista de plataformas suportadas
- Nenhum candidato pôde ser carregado:
  - lança exceção com a lista completa de erros dos candidatos e dicas de correção específicas ao modo
- Exports ausentes:
  - lança exceção com os nomes exatos dos símbolos ausentes e o comando de rebuild
- Problemas de extração embutida:
  - erros de mkdir/escrita na extração são registrados e incluídos no diagnóstico final

## Matriz de solução de problemas

| Sintoma | Causa provável | Como verificar | Correção |
| --- | --- | --- | --- |
| `Native addon missing exports ... Missing: <name>` | Binário `.node` desatualizado, nome do export Rust incompatível ou binário errado carregado | Execute com `PI_DEV=1` para ver o caminho carregado; inspecione a lista de exports desse arquivo | Recompile com `build`; certifique-se de que o nome do export `#[napi]` em Rust (ou alias explícito quando necessário) corresponda à chave JS; remova arquivos versionados/em cache desatualizados |
| Máquina x64 carrega baseline quando modern é esperado | `PI_NATIVE_VARIANT=baseline`, AVX2 não detectado ou apenas arquivo baseline presente | Verifique `PI_NATIVE_VARIANT`; inspecione `native/` em busca do arquivo `-modern` | Compile a variante modern (`TARGET_VARIANT=modern ... build`) e certifique-se de que o arquivo seja distribuído |
| Cross-build produz binário inutilizável/rotulado incorretamente | Incompatibilidade entre `CROSS_TARGET` e `TARGET_PLATFORM`/`TARGET_ARCH`, ou `TARGET_VARIANT` ausente para x64 | Confirme a tupla de env e o nome do arquivo de saída | Reexecute com valores de env consistentes e `TARGET_VARIANT` x64 explícito |
| Binário compilado falha após atualização | Cache extraído desatualizado (`~/.xcsh/natives/<versão-antiga-ou-incompatível>`) ou incompatibilidade no manifesto embutido | Inspecione o diretório de nativos versionado e a lista de erros do carregador | Exclua o cache de nativos versionado para a versão do pacote e reexecute; regenere o manifesto embutido durante o empacotamento |
| O carregador verifica muitos caminhos e nenhum funciona | Incompatibilidade de plataforma ou artefato de release ausente em `native/` do pacote | Verifique `platformTag` versus o(s) nome(s) real(is) do(s) arquivo(s) | Certifique-se de que o nome do arquivo compilado corresponda exatamente à convenção `pi_natives.<platform>-<arch>(-variant).node` e que o pacote inclua `native/` |
| `embed:native` falha com "Incomplete native addons" | Arquivos de variante necessários não compilados antes do embedding | Verifique a lista de esperados vs. encontrados no texto de erro | Compile os arquivos necessários primeiro (x64: ambos modern+baseline; não-x64: padrão) e então reexecute `embed:native` |

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
