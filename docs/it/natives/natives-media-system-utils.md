---
title: Utilità native per media e sistema
description: >-
  Utilità native per l'elaborazione dei media, inclusi screenshot, gestione
  immagini e informazioni di sistema.
sidebar:
  order: 7
  label: Utilità media e sistema
i18n:
  sourceHash: 430898c177bc
  translator: machine
---

# Utilità native per media e sistema

Questo documento è un approfondimento del sottosistema per il livello delle **primitive sistema/media/conversione** descritto in [`docs/natives-architecture.md`](./natives-architecture.md): `image`, `html`, `clipboard` e profilazione `work`.

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

> Nota: non esiste alcun file `crates/pi-natives/src/work.rs`; la profilazione del lavoro è implementata in `prof.rs` e alimentata dalla strumentazione in `task.rs`.

## Mappatura API TS ↔ export/modulo Rust

| Export TS (packages/natives)                | Export Rust N-API                                                       | Modulo Rust                           |
| ------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------- |
| `PhotonImage.parse(bytes)`                  | `PhotonImage::parse`                                                     | `image.rs`                            |
| `PhotonImage#resize(width, height, filter)` | `PhotonImage::resize`                                                    | `image.rs`                            |
| `PhotonImage#encode(format, quality)`       | `PhotonImage::encode`                                                    | `image.rs`                            |
| `htmlToMarkdown(html, options)`             | `html_to_markdown`                                                       | `html.rs`                             |
| `copyToClipboard(text)`                     | `copy_to_clipboard` + logica fallback TS                                 | `clipboard.rs` + `clipboard/index.ts` |
| `readImageFromClipboard()`                  | `read_image_from_clipboard`                                              | `clipboard.rs`                        |
| `getWorkProfile(lastSeconds)`               | `get_work_profile`                                                      | `prof.rs`                             |

## Confini dei formati dati e conversioni

### Immagine (`image`)

- **Confine di input JS**: `Uint8Array` con i byte dell'immagine codificata.
- **Confine di decodifica Rust**: i byte vengono copiati in `Vec<u8>`, il formato viene rilevato con `ImageReader::with_guessed_format()`, quindi decodificato in `DynamicImage`.
- **Stato in memoria**: `PhotonImage` memorizza `Arc<DynamicImage>`.
- **Confine di output**: `encode(format, quality)` restituisce `Promise<Uint8Array>` (Rust `Vec<u8>`).

Gli ID dei formati sono numerici:

- `0`: PNG
- `1`: JPEG
- `2`: WebP (encoder lossless)
- `3`: GIF

Vincoli:

- `quality` viene utilizzato solo per JPEG.
- PNG/WebP/GIF ignorano `quality`.
- Gli ID di formato non supportati generano errore (`Invalid image format: <id>`).

### Conversione HTML (`html`)

- **Confine di input JS**: `string` HTML + oggetto opzionale `{ cleanContent?: boolean; skipImages?: boolean }`.
- **Confine di conversione Rust**: l'input `String` viene convertito da `html_to_markdown_rs::convert`.
- **Confine di output**: `string` Markdown.

Comportamento della conversione:

- `cleanContent` ha valore predefinito `false`.
- Quando `cleanContent=true`, il preprocessing è abilitato con `PreprocessingPreset::Aggressive` e flag di rimozione forzata per navigazione/form.
- `skipImages` ha valore predefinito `false`.

### Appunti (`clipboard`)

- **Percorso testo**:
  - TS prima emette OSC 52 (`\x1b]52;c;<base64>\x07`) quando stdout è un TTY.
  - Lo stesso testo viene poi tentato tramite l'API nativa degli appunti (`native.copyToClipboard`) come tentativo best-effort.
  - Su Termux, TS tenta prima `termux-clipboard-set`.
- **Percorso lettura immagine**:
  - Rust legge l'immagine grezza da `arboard`.
  - Rust la ricodifica in byte PNG (crate `image`), restituisce `{ data: Uint8Array, mimeType: "image/png" }`.
  - TS restituisce `null` anticipatamente su Termux o sessioni Linux senza display server (`DISPLAY`/`WAYLAND_DISPLAY` assenti).

### Profilazione del lavoro (`work`)

- **Confine di raccolta**: i campioni di profilazione vengono prodotti dalle guardie `profile_region(tag)` in `task::blocking` e `task::future`.
- **Formato di archiviazione**: buffer circolare a dimensione fissa (`MAX_SAMPLES = 10_000`) che memorizza percorso dello stack + durata (`μs`) + timestamp (`μs dall'avvio del processo`).
- **Confine di output**: `getWorkProfile(lastSeconds)` restituisce un oggetto:
  - `folded`: testo a stack compattato (input per flamegraph)
  - `summary`: tabella riepilogativa in markdown
  - `svg`: SVG flamegraph opzionale
  - `totalMs`, `sampleCount`

## Ciclo di vita e transizioni di stato

### Ciclo di vita dell'immagine

1. `PhotonImage.parse(bytes)` pianifica un task di decodifica bloccante (`image.decode`).
2. In caso di successo, esiste un handle nativo `PhotonImage` in JS.
3. `resize(...)` crea un nuovo handle nativo (`image.resize`), il vecchio e il nuovo handle possono coesistere.
4. `encode(...)` materializza i byte (`image.encode`) senza modificare le dimensioni dell'immagine.

Transizioni di errore:

- Un fallimento nel rilevamento del formato o nella decodifica rigetta la promise di parse.
- Un fallimento nella codifica rigetta la promise di encode.
- Un ID di formato non valido rigetta la promise di encode.

### Ciclo di vita HTML

1. `htmlToMarkdown(html, options)` pianifica un task di conversione bloccante.
2. La conversione viene eseguita con le opzioni predefinite (`cleanContent=false`, `skipImages=false`) salvo diversa specificazione.
3. Restituisce una stringa markdown o rigetta.

Transizioni di errore:

- Un fallimento del convertitore restituisce una promise rigettata (`Conversion error: ...`).

### Ciclo di vita degli appunti

`copyToClipboard(text)` è intenzionalmente best-effort e multi-percorso:

1. Se TTY: tentativo di scrittura OSC 52 (payload base64).
2. Tentativo del comando Termux quando `TERMUX_VERSION` è impostata.
3. Tentativo di copia testo nativa tramite `arboard`.
4. Gli errori vengono soppressi a livello TS.

`readImageFromClipboard()` ha livelli di rigore diversi per fase:

1. TS blocca rigidamente i contesti runtime non supportati (Termux/Linux headless) restituendo `null`.
2. La lettura `arboard` di Rust viene eseguita solo quando TS lo consente.
3. `ContentNotAvailable` viene mappato a `null`.
4. Altri errori Rust rigettano.

### Ciclo di vita della profilazione del lavoro

1. Nessun avvio esplicito: la profilazione è sempre attiva quando gli helper dei task vengono eseguiti.
2. Ogni scope di task strumentato registra un campione al drop della guardia.
3. I campioni sovrascrivono le voci più vecchie dopo il raggiungimento della capacità del buffer.
4. `getWorkProfile(lastSeconds)` legge una finestra temporale e deriva gli artefatti folded/summary/svg.

Transizioni di errore:

- Un fallimento nella generazione SVG è un soft-fail (`svg: null`), mentre folded e summary vengono comunque restituiti.
- Una finestra di campioni vuota restituisce dati folded vuoti e `svg: null`, non un errore.

## Operazioni non supportate e propagazione degli errori

### Immagine

- Input di decodifica non supportato o byte corrotti: fallimento rigoroso (rigetto della promise).
- ID di formato di codifica non supportato: fallimento rigoroso.
- Nessun percorso di fallback best-effort nel wrapper TS.

### HTML

- Gli errori di conversione sono fallimenti rigorosi (rigetto).
- L'omissione delle opzioni è un default best-effort, non un fallimento.

### Appunti

- La copia del testo è best-effort a livello TS: i fallimenti operativi vengono soppressi.
- La lettura dell'immagine distingue tra "nessuna immagine" (`null`) e fallimento operativo (rigetto).
- Termux/Linux headless sono trattati come contesti non supportati per la lettura dell'immagine (`null`).

### Profilazione del lavoro

- Il recupero è rigoroso per la chiamata alla funzione in sé, ma la generazione degli artefatti è parzialmente best-effort (`svg` nullable).
- Il troncamento del buffer è un comportamento atteso (buffer circolare), non un bug di perdita dati.

## Avvertenze di piattaforma

- **Testo negli appunti**: OSC 52 dipende dal supporto del terminale; l'accesso nativo agli appunti dipende dall'ambiente desktop/sessione.
- **Lettura immagine dagli appunti**: bloccata in TS per Termux e Linux senza display server.
