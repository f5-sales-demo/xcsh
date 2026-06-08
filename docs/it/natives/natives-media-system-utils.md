---
title: Utilità native per media e sistema
description: >-
  Utilità native di elaborazione media per screenshot, gestione immagini e
  informazioni di sistema.
sidebar:
  order: 7
  label: Media & system utils
i18n:
  sourceHash: 430898c177bc
  translator: machine
---

# Utilità native per media + sistema

Questo documento è un approfondimento sui sottosistemi del livello delle **primitive di sistema/media/conversione** descritto in [`docs/natives-architecture.md`](./natives-architecture.md): `image`, `html`, `clipboard` e profilazione `work`.

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

> Nota: non esiste un file `crates/pi-natives/src/work.rs`; la profilazione del lavoro è implementata in `prof.rs` e alimentata dalla strumentazione in `task.rs`.

## Mappatura API TS ↔ export/moduli Rust

| Export TS (packages/natives)                | Export N-API Rust                                                       | Modulo Rust                           |
| ------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------- |
| `PhotonImage.parse(bytes)`                  | `PhotonImage::parse`                                                     | `image.rs`                            |
| `PhotonImage#resize(width, height, filter)` | `PhotonImage::resize`                                                    | `image.rs`                            |
| `PhotonImage#encode(format, quality)`       | `PhotonImage::encode`                                                    | `image.rs`                            |
| `htmlToMarkdown(html, options)`             | `html_to_markdown`                                                       | `html.rs`                             |
| `copyToClipboard(text)`                     | `copy_to_clipboard` + logica di fallback TS                              | `clipboard.rs` + `clipboard/index.ts` |
| `readImageFromClipboard()`                  | `read_image_from_clipboard`                                              | `clipboard.rs`                        |
| `getWorkProfile(lastSeconds)`               | `get_work_profile`                                                      | `prof.rs`                             |

## Confini dei formati dati e conversioni

### Immagini (`image`)

- **Confine di input JS**: `Uint8Array` con byte dell'immagine codificata.
- **Confine di decodifica Rust**: i byte vengono copiati in `Vec<u8>`, il formato viene individuato con `ImageReader::with_guessed_format()`, quindi decodificato in `DynamicImage`.
- **Stato in memoria**: `PhotonImage` memorizza `Arc<DynamicImage>`.
- **Confine di output**: `encode(format, quality)` restituisce `Promise<Uint8Array>` (`Vec<u8>` lato Rust).

Gli ID formato sono numerici:

- `0`: PNG
- `1`: JPEG
- `2`: WebP (encoder lossless)
- `3`: GIF

Vincoli:

- `quality` è utilizzato solo per JPEG.
- PNG/WebP/GIF ignorano `quality`.
- Gli ID formato non supportati falliscono (`Invalid image format: <id>`).

### Conversione HTML (`html`)

- **Confine di input JS**: `string` HTML + oggetto opzionale `{ cleanContent?: boolean; skipImages?: boolean }`.
- **Confine di conversione Rust**: l'input `String` viene convertito da `html_to_markdown_rs::convert`.
- **Confine di output**: `string` Markdown.

Comportamento della conversione:

- `cleanContent` ha valore predefinito `false`.
- Quando `cleanContent=true`, viene abilitato il preprocessing con `PreprocessingPreset::Aggressive` e flag di rimozione forzata per navigazione/form.
- `skipImages` ha valore predefinito `false`.

### Appunti (`clipboard`)

- **Percorso testo**:
  - TS emette prima OSC 52 (`\x1b]52;c;<base64>\x07`) quando stdout è un TTY.
  - Lo stesso testo viene poi tentato tramite l'API nativa degli appunti (`native.copyToClipboard`) come best-effort.
  - Su Termux, TS tenta prima `termux-clipboard-set`.
- **Percorso lettura immagine**:
  - Rust legge l'immagine raw da `arboard`.
  - Rust la ricodifica in byte PNG (crate `image`), restituisce `{ data: Uint8Array, mimeType: "image/png" }`.
  - TS restituisce `null` anticipatamente su Termux o sessioni Linux senza display server (`DISPLAY`/`WAYLAND_DISPLAY` assenti).

### Profilazione del lavoro (`work`)

- **Confine di raccolta**: i campioni di profilazione sono prodotti dai guard `profile_region(tag)` in `task::blocking` e `task::future`.
- **Formato di archiviazione**: buffer circolare a dimensione fissa (`MAX_SAMPLES = 10_000`) che memorizza percorso dello stack + durata (`μs`) + timestamp (`μs dall'avvio del processo`).
- **Confine di output**: `getWorkProfile(lastSeconds)` restituisce un oggetto:
  - `folded`: testo con stack compressi (input per flamegraph)
  - `summary`: tabella di riepilogo in markdown
  - `svg`: SVG flamegraph opzionale
  - `totalMs`, `sampleCount`

## Ciclo di vita e transizioni di stato

### Ciclo di vita delle immagini

1. `PhotonImage.parse(bytes)` pianifica un task di decodifica bloccante (`image.decode`).
2. In caso di successo, un handle nativo `PhotonImage` esiste in JS.
3. `resize(...)` crea un nuovo handle nativo (`image.resize`), vecchio e nuovo handle possono coesistere.
4. `encode(...)` materializza i byte (`image.encode`) senza modificare le dimensioni dell'immagine.

Transizioni di errore:

- Un fallimento nel rilevamento del formato o nella decodifica rifiuta la promise di parse.
- Un fallimento nella codifica rifiuta la promise di encode.
- Un ID formato non valido rifiuta la promise di encode.

### Ciclo di vita HTML

1. `htmlToMarkdown(html, options)` pianifica un task di conversione bloccante.
2. La conversione viene eseguita con le opzioni predefinite (`cleanContent=false`, `skipImages=false`) salvo diversa indicazione.
3. Restituisce una stringa markdown oppure rifiuta.

Transizioni di errore:

- Un fallimento del convertitore restituisce una promise rifiutata (`Conversion error: ...`).

### Ciclo di vita degli appunti

`copyToClipboard(text)` è intenzionalmente best-effort e multi-percorso:

1. Se TTY: tentativo di scrittura OSC 52 (payload base64).
2. Tentativo con comando Termux quando `TERMUX_VERSION` è impostato.
3. Tentativo di copia testo nativa tramite `arboard`.
4. Gli errori vengono soppressi al livello TS.

`readImageFromClipboard()` ha un livello di rigore diverso per fase:

1. TS blocca in modo rigido i contesti di runtime non supportati (Termux/Linux headless) restituendo `null`.
2. La lettura `arboard` in Rust viene eseguita solo quando TS lo consente.
3. `ContentNotAvailable` viene mappato a `null`.
4. Altri errori Rust provocano un rifiuto.

### Ciclo di vita della profilazione del lavoro

1. Nessun avvio esplicito: la profilazione è sempre attiva quando vengono eseguiti gli helper dei task.
2. Ogni scope di task strumentato registra un campione al rilascio del guard.
3. I campioni sovrascrivono le voci più vecchie una volta raggiunta la capacità del buffer.
4. `getWorkProfile(lastSeconds)` legge una finestra temporale e genera gli artefatti folded/summary/svg.

Transizioni di errore:

- Un fallimento nella generazione SVG è un soft-fail (`svg: null`), mentre folded e summary vengono comunque restituiti.
- Una finestra di campioni vuota restituisce dati folded vuoti e `svg: null`, non un errore.

## Operazioni non supportate e propagazione degli errori

### Immagini

- Input di decodifica non supportato o byte corrotti: fallimento rigido (rifiuto della promise).
- ID formato di codifica non supportato: fallimento rigido.
- Nessun percorso di fallback best-effort nel wrapper TS.

### HTML

- Gli errori di conversione sono fallimenti rigidi (rifiuto).
- L'omissione delle opzioni utilizza valori predefiniti best-effort, non un fallimento.

### Appunti

- La copia del testo è best-effort al livello TS: i fallimenti operativi vengono soppressi.
- La lettura dell'immagine distingue tra "nessuna immagine" (`null`) e fallimento operativo (rifiuto).
- Termux/Linux headless sono trattati come contesti non supportati per la lettura delle immagini (`null`).

### Profilazione del lavoro

- Il recupero è rigido per la chiamata alla funzione stessa, ma la generazione degli artefatti è parzialmente best-effort (`svg` nullable).
- Il troncamento del buffer è un comportamento previsto (buffer circolare), non un bug di perdita dati.

## Avvertenze specifiche per piattaforma

- **Testo negli appunti**: OSC 52 dipende dal supporto del terminale; l'accesso nativo agli appunti dipende dall'ambiente desktop/sessione.
- **Lettura immagine dagli appunti**: bloccata in TS per Termux e Linux senza display server.
