---
title: Utilità native per media e sistema
description: >-
  Utilità native per l'elaborazione dei media, incluse catture di schermo,
  gestione delle immagini e informazioni di sistema.
sidebar:
  order: 7
  label: Media & system utils
i18n:
  sourceHash: 430898c177bc
  translator: machine
---

# Utilità native per media + sistema

Questo documento è un approfondimento del sottosistema per il livello delle **primitive di sistema/media/conversione** descritto in [`docs/natives-architecture.md`](./natives-architecture.md): `image`, `html`, `clipboard` e profilazione `work`.

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

> Nota: non esiste un file `crates/pi-natives/src/work.rs`; la profilazione del lavoro è implementata in `prof.rs` e alimentata dall'instrumentazione in `task.rs`.

## Mappatura API TS ↔ export/modulo Rust

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

### Immagine (`image`)

- **Confine di input JS**: `Uint8Array` con byte dell'immagine codificata.
- **Confine di decodifica Rust**: i byte vengono copiati in `Vec<u8>`, il formato viene dedotto con `ImageReader::with_guessed_format()`, quindi decodificato in `DynamicImage`.
- **Stato in memoria**: `PhotonImage` memorizza `Arc<DynamicImage>`.
- **Confine di output**: `encode(format, quality)` restituisce `Promise<Uint8Array>` (`Vec<u8>` in Rust).

Gli ID dei formati sono numerici:

- `0`: PNG
- `1`: JPEG
- `2`: WebP (encoder lossless)
- `3`: GIF

Vincoli:

- `quality` è utilizzato solo per JPEG.
- PNG/WebP/GIF ignorano `quality`.
- ID di formato non supportati generano un errore (`Invalid image format: <id>`).

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
  - TS emette prima OSC 52 (`\x1b]52;c;<base64>\x07`) quando stdout è un TTY.
  - Lo stesso testo viene poi tentato tramite l'API nativa degli appunti (`native.copyToClipboard`) come operazione best-effort.
  - Su Termux, TS tenta prima `termux-clipboard-set`.
- **Percorso lettura immagine**:
  - Rust legge l'immagine grezza da `arboard`.
  - Rust la ricodifica in byte PNG (crate `image`), restituisce `{ data: Uint8Array, mimeType: "image/png" }`.
  - TS restituisce `null` anticipatamente su Termux o sessioni Linux senza display server (`DISPLAY`/`WAYLAND_DISPLAY` mancanti).

### Profilazione del lavoro (`work`)

- **Confine di raccolta**: i campioni di profilazione sono prodotti dalle guardie `profile_region(tag)` in `task::blocking` e `task::future`.
- **Formato di archiviazione**: buffer circolare a dimensione fissa (`MAX_SAMPLES = 10_000`) che memorizza percorso dello stack + durata (`μs`) + timestamp (`μs dall'avvio del processo`).
- **Confine di output**: `getWorkProfile(lastSeconds)` restituisce un oggetto:
  - `folded`: testo folded-stack (input per flamegraph)
  - `summary`: tabella riepilogativa in markdown
  - `svg`: SVG flamegraph opzionale
  - `totalMs`, `sampleCount`

## Ciclo di vita e transizioni di stato

### Ciclo di vita dell'immagine

1. `PhotonImage.parse(bytes)` pianifica un task di decodifica bloccante (`image.decode`).
2. In caso di successo, un handle nativo `PhotonImage` esiste in JS.
3. `resize(...)` crea un nuovo handle nativo (`image.resize`), il vecchio e il nuovo handle possono coesistere.
4. `encode(...)` materializza i byte (`image.encode`) senza mutare le dimensioni dell'immagine.

Transizioni di errore:

- Il fallimento nella rilevazione del formato/decodifica rifiuta la promise di parse.
- Il fallimento nella codifica rifiuta la promise di encode.
- Un ID di formato non valido rifiuta la promise di encode.

### Ciclo di vita della conversione HTML

1. `htmlToMarkdown(html, options)` pianifica un task di conversione bloccante.
2. La conversione viene eseguita con le opzioni predefinite (`cleanContent=false`, `skipImages=false`) salvo diversa specifica.
3. Restituisce una stringa markdown o rifiuta.

Transizioni di errore:

- Il fallimento del convertitore restituisce una promise rifiutata (`Conversion error: ...`).

### Ciclo di vita degli appunti

`copyToClipboard(text)` è intenzionalmente best-effort e multi-percorso:

1. Se TTY: tenta la scrittura OSC 52 (payload base64).
2. Tenta il comando Termux quando `TERMUX_VERSION` è impostato.
3. Tenta la copia testo nativa tramite `arboard`.
4. Sopprime gli errori a livello TS.

`readImageFromClipboard()` ha diversi livelli di rigidità per fase:

1. TS blocca preventivamente i contesti runtime non supportati (Termux/Linux headless) restituendo `null`.
2. La lettura Rust tramite `arboard` viene eseguita solo quando TS lo consente.
3. `ContentNotAvailable` viene mappato a `null`.
4. Altri errori Rust causano il rifiuto.

### Ciclo di vita della profilazione del lavoro

1. Nessun avvio esplicito: la profilazione è sempre attiva quando vengono eseguiti gli helper dei task.
2. Ogni scope di task instrumentato registra un campione al drop della guardia.
3. I campioni sovrascrivono le voci più vecchie una volta raggiunta la capacità del buffer.
4. `getWorkProfile(lastSeconds)` legge una finestra temporale e genera gli artefatti folded/summary/svg.

Transizioni di errore:

- Il fallimento della generazione SVG è un errore soft (`svg: null`), mentre folded e summary vengono comunque restituiti.
- Una finestra di campioni vuota restituisce dati folded vuoti e `svg: null`, non un errore.

## Operazioni non supportate e propagazione degli errori

### Immagine

- Input di decodifica non supportato o byte corrotti: errore rigoroso (rifiuto della promise).
- ID di formato di codifica non supportato: errore rigoroso.
- Nessun percorso di fallback best-effort nel wrapper TS.

### HTML

- Gli errori di conversione sono errori rigorosi (rifiuto).
- L'omissione delle opzioni è gestita con valori predefiniti best-effort, non con un errore.

### Appunti

- La copia del testo è best-effort a livello TS: gli errori operativi vengono soppressi.
- La lettura dell'immagine distingue tra "nessuna immagine" (`null`) e errore operativo (rifiuto).
- Termux/Linux headless sono trattati come contesti non supportati per la lettura dell'immagine (`null`).

### Profilazione del lavoro

- Il recupero è rigoroso per la chiamata alla funzione stessa, ma la generazione degli artefatti è parzialmente best-effort (`svg` nullable).
- Il troncamento del buffer è un comportamento atteso (buffer circolare), non un bug di perdita dati.

## Avvertenze specifiche per piattaforma

- **Testo negli appunti**: OSC 52 dipende dal supporto del terminale; l'accesso nativo agli appunti dipende dall'ambiente desktop/sessione.
- **Lettura immagine dagli appunti**: bloccata in TS per Termux e Linux senza display server.
