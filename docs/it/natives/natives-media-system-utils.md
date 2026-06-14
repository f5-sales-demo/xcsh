---
title: Utilità native per media e sistema
description: >-
  Utilità native per l'elaborazione di media, gestione delle immagini e
  informazioni di sistema.
sidebar:
  order: 7
  label: Utilità media e sistema
i18n:
  sourceHash: 430898c177bc
  translator: machine
---

# Utilità native per media + sistema

Questo documento è un'analisi approfondita del sottosistema relativo al livello **system/media/conversion primitives** descritto in [`docs/natives-architecture.md`](./natives-architecture.md): `image`, `html`, `clipboard` e profiling `work`.

## File di implementazione

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

> Nota: non esiste un file `crates/pi-natives/src/work.rs`; il profiling work è implementato in `prof.rs` e alimentato dalla strumentazione in `task.rs`.

## Mappatura TS API ↔ export/modulo Rust

| Export TS (packages/natives)                | Export Rust N-API                                                       | Modulo Rust                           |
| ------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------- |
| `PhotonImage.parse(bytes)`                  | `PhotonImage::parse`                                                     | `image.rs`                            |
| `PhotonImage#resize(width, height, filter)` | `PhotonImage::resize`                                                    | `image.rs`                            |
| `PhotonImage#encode(format, quality)`       | `PhotonImage::encode`                                                    | `image.rs`                            |
| `htmlToMarkdown(html, options)`             | `html_to_markdown`                                                       | `html.rs`                             |
| `copyToClipboard(text)`                     | `copy_to_clipboard` + logica di fallback TS                              | `clipboard.rs` + `clipboard/index.ts` |
| `readImageFromClipboard()`                  | `read_image_from_clipboard`                                              | `clipboard.rs`                        |
| `getWorkProfile(lastSeconds)`               | `get_work_profile`                                                      | `prof.rs`                             |

## Confini dei formati dati e conversioni

### Immagine (`image`)

- **Confine di input JS**: byte dell'immagine codificati come `Uint8Array`.
- **Confine di decodifica Rust**: i byte vengono copiati in `Vec<u8>`, il formato viene rilevato con `ImageReader::with_guessed_format()`, quindi decodificato in `DynamicImage`.
- **Stato in memoria**: `PhotonImage` memorizza `Arc<DynamicImage>`.
- **Confine di output**: `encode(format, quality)` restituisce `Promise<Uint8Array>` (Rust `Vec<u8>`).

Gli ID di formato sono numerici:

- `0`: PNG
- `1`: JPEG
- `2`: WebP (encoder lossless)
- `3`: GIF

Vincoli:

- `quality` viene utilizzato solo per JPEG.
- PNG/WebP/GIF ignorano `quality`.
- Gli ID di formato non supportati causano un errore (`Invalid image format: <id>`).

### Conversione HTML (`html`)

- **Confine di input JS**: `string` HTML + oggetto opzionale `{ cleanContent?: boolean; skipImages?: boolean }`.
- **Confine di conversione Rust**: l'input `String` viene convertito da `html_to_markdown_rs::convert`.
- **Confine di output**: `string` Markdown.

Comportamento della conversione:

- `cleanContent` ha valore predefinito `false`.
- Quando `cleanContent=true`, il preprocessing è abilitato con `PreprocessingPreset::Aggressive` e flag di rimozione forzata per navigazione/form.
- `skipImages` ha valore predefinito `false`.

### Clipboard (`clipboard`)

- **Percorso testo**:
  - TS emette prima OSC 52 (`\x1b]52;c;<base64>\x07`) quando stdout è un TTY.
  - Lo stesso testo viene poi tentato tramite l'API clipboard nativa (`native.copyToClipboard`) come tentativo non garantito.
  - Su Termux, TS tenta prima `termux-clipboard-set`.
- **Percorso lettura immagine**:
  - Rust legge l'immagine grezza da `arboard`.
  - Rust la ri-codifica in byte PNG (crate `image`), restituisce `{ data: Uint8Array, mimeType: "image/png" }`.
  - TS restituisce `null` anticipatamente su Termux o sessioni Linux senza display server (variabili `DISPLAY`/`WAYLAND_DISPLAY` assenti).

### Profiling work (`work`)

- **Confine di raccolta**: i campioni di profiling sono prodotti dai guard `profile_region(tag)` in `task::blocking` e `task::future`.
- **Formato di archiviazione**: buffer circolare di dimensione fissa (`MAX_SAMPLES = 10_000`) che memorizza percorso dello stack + durata (`μs`) + timestamp (`μs dall'avvio del processo`).
- **Confine di output**: `getWorkProfile(lastSeconds)` restituisce un oggetto:
  - `folded`: testo a stack folded (input per flamegraph)
  - `summary`: tabella di riepilogo in markdown
  - `svg`: SVG del flamegraph opzionale
  - `totalMs`, `sampleCount`

## Ciclo di vita e transizioni di stato

### Ciclo di vita dell'immagine

1. `PhotonImage.parse(bytes)` pianifica un task di decodifica bloccante (`image.decode`).
2. In caso di successo, un handle nativo `PhotonImage` esiste in JS.
3. `resize(...)` crea un nuovo handle nativo (`image.resize`); i vecchi e i nuovi handle possono coesistere.
4. `encode(...)` materializza i byte (`image.encode`) senza mutare le dimensioni dell'immagine.

Transizioni di errore:

- Il fallimento del rilevamento del formato/decodifica rigetta la promise di parse.
- Il fallimento della codifica rigetta la promise di encode.
- Un ID di formato non valido rigetta la promise di encode.

### Ciclo di vita HTML

1. `htmlToMarkdown(html, options)` pianifica un task di conversione bloccante.
2. La conversione viene eseguita con le opzioni predefinite (`cleanContent=false`, `skipImages=false`) salvo diversa indicazione.
3. Restituisce una stringa markdown o rigetta.

Transizioni di errore:

- Il fallimento del convertitore restituisce una promise rigettata (`Conversion error: ...`).

### Ciclo di vita della clipboard

`copyToClipboard(text)` è intenzionalmente non garantito e multi-percorso:

1. Se TTY: tentativo di scrittura OSC 52 (payload base64).
2. Tentativo del comando Termux quando `TERMUX_VERSION` è impostata.
3. Tentativo di copia testo nativa con `arboard`.
4. Gli errori vengono soppressi a livello TS.

La rigorosità di `readImageFromClipboard()` differisce per fase:

1. TS blocca rigidamente i contesti di runtime non supportati (Termux/Linux headless) restituendo `null`.
2. La lettura Rust tramite `arboard` viene eseguita solo quando TS lo consente.
3. `ContentNotAvailable` viene mappato a `null`.
4. Altri errori Rust causano il rigetto.

### Ciclo di vita del profiling work

1. Nessun avvio esplicito: il profiling è sempre attivo quando vengono eseguiti i task helper.
2. Ogni scope di task strumentato registra un campione al rilascio del guard.
3. I campioni sovrascrivono le voci più vecchie al raggiungimento della capacità del buffer.
4. `getWorkProfile(lastSeconds)` legge una finestra temporale e produce gli artefatti folded/summary/svg.

Transizioni di errore:

- Il fallimento della generazione SVG è non bloccante (`svg: null`), mentre folded e summary vengono comunque restituiti.
- Una finestra di campioni vuota restituisce dati folded vuoti e `svg: null`, non un errore.

## Operazioni non supportate e propagazione degli errori

### Immagine

- Input di decodifica non supportato o byte corrotti: errore rigido (rigetto della promise).
- ID di formato di codifica non supportato: errore rigido.
- Nessun percorso di fallback nel wrapper TS.

### HTML

- Gli errori di conversione sono errori rigidi (rigetto).
- L'omissione delle opzioni applica i valori predefiniti, non è un errore.

### Clipboard

- La copia del testo è non garantita a livello TS: i fallimenti operativi vengono soppressi.
- La lettura delle immagini distingue tra "nessuna immagine" (`null`) e fallimento operativo (rigetto).
- Termux/Linux headless sono trattati come contesti non supportati per la lettura delle immagini (`null`).

### Profiling work

- Il recupero è rigido per la chiamata alla funzione stessa, ma la generazione degli artefatti è parzialmente non garantita (`svg` nullable).
- La troncatura del buffer è un comportamento atteso (ring buffer), non un bug di perdita di dati.

## Avvertenze sulla Piattaforma

- **Testo clipboard**: OSC 52 dipende dal supporto del terminale; l'accesso nativo alla clipboard dipende dall'ambiente desktop/sessione.
- **Lettura immagine dalla clipboard**: bloccata in TS per Termux e Linux senza display server.
