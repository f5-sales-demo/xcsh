---
title: Utilitários Nativos de Mídia e Sistema
description: >-
  Utilitários nativos de processamento de mídia para capturas de tela,
  manipulação de imagens e informações do sistema.
sidebar:
  order: 7
  label: Utilitários de mídia e sistema
i18n:
  sourceHash: 430898c177bc
  translator: machine
---

# Utilitários nativos de mídia + sistema

Este documento é um aprofundamento de subsistema para a camada de **primitivas de sistema/mídia/conversão** descrita em [`docs/natives-architecture.md`](./natives-architecture.md): `image`, `html`, `clipboard` e profiling de `work`.

## Arquivos de implementação

- `crates/pi-natives/src/image.rs`
- `crates/pi-natives/src/html.rs`
- `crates/pi-natives/src/clipboard.rs`
- `crates/pi-natives/src/prof.rs`
- `crates/pi-natives/src/task.rs`
- `packages/natives/src/image/index.ts`
- `packages/natives/src/image/types.ts`
- `packages/natives/src/html/index.ts`
- `packages/natives/src/html/types.ts`
- `packages/natives/src/clipboard/index.ts`
- `packages/natives/src/clipboard/types.ts`
- `packages/natives/src/work/index.ts`
- `packages/natives/src/work/types.ts`

> Nota: não existe `crates/pi-natives/src/work.rs`; o profiling de work é implementado em `prof.rs` e alimentado pela instrumentação em `task.rs`.

## Mapeamento de API TS ↔ exportação/módulo Rust

| Exportação TS (packages/natives)            | Exportação N-API Rust                                                   | Módulo Rust                           |
| ------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------- |
| `PhotonImage.parse(bytes)`                  | `PhotonImage::parse`                                                     | `image.rs`                            |
| `PhotonImage#resize(width, height, filter)` | `PhotonImage::resize`                                                    | `image.rs`                            |
| `PhotonImage#encode(format, quality)`       | `PhotonImage::encode`                                                    | `image.rs`                            |
| `htmlToMarkdown(html, options)`             | `html_to_markdown`                                                       | `html.rs`                             |
| `copyToClipboard(text)`                     | `copy_to_clipboard` + lógica de fallback TS                              | `clipboard.rs` + `clipboard/index.ts` |
| `readImageFromClipboard()`                  | `read_image_from_clipboard`                                              | `clipboard.rs`                        |
| `getWorkProfile(lastSeconds)`               | `get_work_profile`                                                      | `prof.rs`                             |

## Limites de formato de dados e conversões

### Imagem (`image`)

- **Limite de entrada JS**: `Uint8Array` com bytes de imagem codificada.
- **Limite de decodificação Rust**: os bytes são copiados para `Vec<u8>`, o formato é detectado com `ImageReader::with_guessed_format()` e então decodificado para `DynamicImage`.
- **Estado em memória**: `PhotonImage` armazena `Arc<DynamicImage>`.
- **Limite de saída**: `encode(format, quality)` retorna `Promise<Uint8Array>` (Rust `Vec<u8>`).

Os IDs de formato são numéricos:

- `0`: PNG
- `1`: JPEG
- `2`: WebP (codificador lossless)
- `3`: GIF

Restrições:

- `quality` é usado apenas para JPEG.
- PNG/WebP/GIF ignoram `quality`.
- IDs de formato não suportados falham (`Invalid image format: <id>`).

### Conversão HTML (`html`)

- **Limite de entrada JS**: `string` HTML + objeto opcional `{ cleanContent?: boolean; skipImages?: boolean }`.
- **Limite de conversão Rust**: a entrada `String` é convertida por `html_to_markdown_rs::convert`.
- **Limite de saída**: `string` Markdown.

Comportamento da conversão:

- `cleanContent` tem valor padrão `false`.
- Quando `cleanContent=true`, o pré-processamento é habilitado com `PreprocessingPreset::Aggressive` e flags de remoção forçada para navegação/formulários.
- `skipImages` tem valor padrão `false`.

### Área de transferência (`clipboard`)

- **Caminho de texto**:
  - O TS primeiro emite OSC 52 (`\x1b]52;c;<base64>\x07`) quando stdout é um TTY.
  - O mesmo texto é então tentado via API nativa de área de transferência (`native.copyToClipboard`) como melhor esforço.
  - No Termux, o TS tenta `termux-clipboard-set` primeiro.
- **Caminho de leitura de imagem**:
  - O Rust lê a imagem bruta do `arboard`.
  - O Rust recodifica para bytes PNG (crate `image`), retorna `{ data: Uint8Array, mimeType: "image/png" }`.
  - O TS retorna `null` antecipadamente no Termux ou sessões Linux sem servidor de display (`DISPLAY`/`WAYLAND_DISPLAY` ausentes).

### Profiling de work (`work`)

- **Limite de coleta**: amostras de profiling são produzidas por guards `profile_region(tag)` em `task::blocking` e `task::future`.
- **Formato de armazenamento**: buffer circular de tamanho fixo (`MAX_SAMPLES = 10_000`) armazenando caminho da pilha + duração (`μs`) + timestamp (`μs desde o início do processo`).
- **Limite de saída**: `getWorkProfile(lastSeconds)` retorna objeto:
  - `folded`: texto de pilha empilhada (entrada para flamegraph)
  - `summary`: tabela resumo em markdown
  - `svg`: SVG de flamegraph opcional
  - `totalMs`, `sampleCount`

## Ciclo de vida e transições de estado

### Ciclo de vida de imagem

1. `PhotonImage.parse(bytes)` agenda uma tarefa bloqueante de decodificação (`image.decode`).
2. Em caso de sucesso, um handle nativo `PhotonImage` existe no JS.
3. `resize(...)` cria um novo handle nativo (`image.resize`), handles antigos e novos podem coexistir.
4. `encode(...)` materializa bytes (`image.encode`) sem alterar as dimensões da imagem.

Transições de falha:

- Falha na detecção de formato/decodificação rejeita a promise de parse.
- Falha na codificação rejeita a promise de encode.
- ID de formato inválido rejeita a promise de encode.

### Ciclo de vida HTML

1. `htmlToMarkdown(html, options)` agenda uma tarefa bloqueante de conversão.
2. A conversão executa com opções padrão (`cleanContent=false`, `skipImages=false`) a menos que especificado.
3. Retorna string markdown ou rejeita.

Transições de falha:

- Falha no conversor retorna promise rejeitada (`Conversion error: ...`).

### Ciclo de vida da área de transferência

`copyToClipboard(text)` é intencionalmente de melhor esforço e multi-caminho:

1. Se TTY: tenta escrita OSC 52 (payload base64).
2. Tenta comando Termux quando `TERMUX_VERSION` está definido.
3. Tenta cópia de texto nativa via `arboard`.
4. Suprime erros na camada TS.

`readImageFromClipboard()` tem rigor diferente por estágio:

1. O TS bloqueia contextos de runtime não suportados (Termux/Linux headless) para `null`.
2. A leitura `arboard` do Rust executa apenas quando o TS permite.
3. `ContentNotAvailable` é mapeado para `null`.
4. Outros erros do Rust rejeitam.

### Ciclo de vida do profiling de work

1. Sem início explícito: o profiling está sempre ativo quando os helpers de tarefa executam.
2. Cada escopo de tarefa instrumentada registra uma amostra ao dropar o guard.
3. Amostras sobrescrevem as entradas mais antigas após a capacidade do buffer ser atingida.
4. `getWorkProfile(lastSeconds)` lê uma janela de tempo e deriva artefatos folded/summary/svg.

Transições de falha:

- Falha na geração de SVG é falha suave (`svg: null`), enquanto folded e summary ainda retornam.
- Janela de amostras vazia retorna dados folded vazios e `svg: null`, não um erro.

## Operações não suportadas e propagação de erros

### Imagem

- Entrada de decodificação não suportada ou bytes corrompidos: falha estrita (rejeição de promise).
- ID de formato de codificação não suportado: falha estrita.
- Sem caminho de fallback de melhor esforço no wrapper TS.

### HTML

- Erros de conversão são falhas estritas (rejeição).
- Omissão de opções é defaulting de melhor esforço, não falha.

### Área de transferência

- Cópia de texto é de melhor esforço na camada TS: falhas operacionais são suprimidas.
- Leitura de imagem distingue "sem imagem" (`null`) de falha operacional (rejeição).
- Termux/Linux headless são tratados como contextos não suportados para leitura de imagem (`null`).

### Profiling de work

- A recuperação é estrita para a chamada de função em si, mas a geração de artefatos é parcialmente de melhor esforço (`svg` anulável).
- Truncamento do buffer é comportamento esperado (buffer circular), não bug de perda de dados.

## Ressalvas de plataforma

- **Texto da área de transferência**: OSC 52 depende do suporte do terminal; acesso nativo à área de transferência depende do ambiente desktop/sessão.
- **Leitura de imagem da área de transferência**: bloqueada no TS para Termux e Linux sem servidor de display.
