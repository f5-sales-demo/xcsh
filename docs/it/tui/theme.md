---
title: Riferimento al tema
description: >-
  Riferimento al tema TUI con token colore, impostazioni dei font e
  personalizzazione del tema.
sidebar:
  order: 3
  label: Tema
i18n:
  sourceHash: 1f5d0f83a7f4
  translator: machine
---

# Riferimento al tema

Questo documento descrive il funzionamento del sistema di temi nell'agente di codifica: schema, caricamento, comportamento a runtime e modalità di errore.

## Cosa controlla il sistema di temi

Il sistema di temi gestisce:

- token colore per primo piano/sfondo utilizzati nell'intera TUI
- adattatori di stile markdown (`getMarkdownTheme()`)
- adattatori per selettore/editor/elenco impostazioni (`getSelectListTheme()`, `getEditorTheme()`, `getSettingsListTheme()`)
- preset di simboli + override dei simboli (`unicode`, `nerd`, `ascii`)
- colori di evidenziazione della sintassi utilizzati dall'evidenziatore nativo (`@f5xc-salesdemos/pi-natives`)
- colori dei segmenti della barra di stato

Implementazione principale: `src/modes/theme/theme.ts`.

## Struttura JSON del tema

I file di tema sono oggetti JSON validati rispetto allo schema runtime in `theme.ts` (`ThemeJsonSchema`) e rispecchiati da `src/modes/theme/theme-schema.json`.

Campi di primo livello:

- `name` (obbligatorio)
- `colors` (obbligatorio; tutti i token colore sono obbligatori)
- `vars` (facoltativo; variabili colore riutilizzabili)
- `export` (facoltativo; colori per l'esportazione HTML)
- `symbols` (facoltativo)
  - `preset` (facoltativo: `unicode | nerd | ascii`)
  - `overrides` (facoltativo: override chiave/valore per `SymbolKey`)

I valori colore accettano:

- stringa esadecimale (`"#RRGGBB"`)
- indice a 256 colori (`0..255`)
- stringa di riferimento a variabile (risolta tramite `vars`)
- stringa vuota (`""`) che indica il valore predefinito del terminale (`\x1b[39m` fg, `\x1b[49m` bg)

## Token colore obbligatori (correnti)

Tutti i token riportati di seguito sono obbligatori in `colors`.

### Testo e bordi principali (11)

`accent`, `border`, `borderAccent`, `borderMuted`, `success`, `error`, `warning`, `muted`, `dim`, `text`, `thinkingText`

### Blocchi di sfondo (7)

`selectedBg`, `userMessageBg`, `customMessageBg`, `toolPendingBg`, `toolSuccessBg`, `toolErrorBg`, `statusLineBg`

### Testo messaggi/strumenti (5)

`userMessageText`, `customMessageText`, `customMessageLabel`, `toolTitle`, `toolOutput`

### Markdown (10)

`mdHeading`, `mdLink`, `mdLinkUrl`, `mdCode`, `mdCodeBlock`, `mdCodeBlockBorder`, `mdQuote`, `mdQuoteBorder`, `mdHr`, `mdListBullet`

### Diff strumenti + evidenziazione sintassi (12)

`toolDiffAdded`, `toolDiffRemoved`, `toolDiffContext`,
`syntaxComment`, `syntaxKeyword`, `syntaxFunction`, `syntaxVariable`, `syntaxString`, `syntaxNumber`, `syntaxType`, `syntaxOperator`, `syntaxPunctuation`

### Bordi modalità/pensiero (8)

`thinkingOff`, `thinkingMinimal`, `thinkingLow`, `thinkingMedium`, `thinkingHigh`, `thinkingXhigh`, `bashMode`, `pythonMode`

### Colori dei segmenti della barra di stato (14)

`statusLineSep`, `statusLineModel`, `statusLinePath`, `statusLineGitClean`, `statusLineGitDirty`, `statusLineContext`, `statusLineSpend`, `statusLineStaged`, `statusLineDirty`, `statusLineUntracked`, `statusLineOutput`, `statusLineCost`, `statusLineSubagents`

## Token facoltativi

### Sezione `export` (facoltativa)

Utilizzata per gli helper di tema dell'esportazione HTML:

- `export.pageBg`
- `export.cardBg`
- `export.infoBg`

Se omessa, il codice di esportazione ricava i valori predefiniti dai colori del tema risolti.

### Sezione `symbols` (facoltativa)

- `symbols.preset` imposta un set di simboli predefinito a livello di tema.
- `symbols.overrides` può sovrascrivere singoli valori `SymbolKey`.

Precedenza a runtime:

1. override `symbolPreset` nelle impostazioni (se impostato)
2. `symbols.preset` nel JSON del tema
3. fallback `"unicode"`

Le chiavi di override non valide vengono ignorate e registrate (`logger.debug`).

## Sorgenti di temi predefiniti e personalizzati

Ordine di ricerca del tema (`loadThemeJson`):

1. temi predefiniti incorporati (`defaults/xcsh-dark.json` e `defaults/xcsh-light.json` compilati in `defaultThemes`)
2. file di tema personalizzato: `<customThemesDir>/<name>.json`

La directory dei temi personalizzati proviene da `getCustomThemesDir()`:

- predefinita: `~/.xcsh/agent/themes`
- sovrascritta da `PI_CODING_AGENT_DIR` (`$PI_CODING_AGENT_DIR/themes`)

`getAvailableThemes()` restituisce i nomi predefiniti + personalizzati uniti, ordinati, con i predefiniti che hanno la precedenza in caso di collisione di nomi.

## Caricamento, validazione e risoluzione

Per i file di tema personalizzati:

1. lettura JSON
2. analisi JSON
3. validazione rispetto a `ThemeJsonSchema`
4. risoluzione ricorsiva dei riferimenti `vars`
5. conversione dei valori risolti in ANSI in base alla modalità di capacità del terminale

Comportamento di validazione:

- token colore obbligatori mancanti: messaggio di errore raggruppato esplicito
- tipi/valori di token errati: errori di validazione con percorso JSON
- file di tema sconosciuto: `Theme not found: <name>`

Comportamento dei riferimenti a variabili:

- supporta riferimenti annidati
- genera un'eccezione per riferimenti a variabili mancanti
- genera un'eccezione per riferimenti circolari

## Comportamento della modalità colore del terminale

Rilevamento della modalità colore (`detectColorMode`):

- `COLORTERM=truecolor|24bit` => truecolor
- `WT_SESSION` => truecolor
- `TERM` in `dumb`, `linux`, o vuoto => 256color
- altrimenti => truecolor

Comportamento di conversione:

- hex -> `Bun.color(..., "ansi-16m" | "ansi-256")`
- numerico -> ANSI `38;5` / `48;5`
- `""` -> reset predefinito fg/bg

## Comportamento del cambio tema a runtime

### Tema iniziale (`initTheme`)

`main.ts` inizializza il tema con le impostazioni:

- `symbolPreset`
- `colorBlindMode`
- `theme.dark`
- `theme.light`

La selezione automatica dello slot del tema utilizza il rilevamento dello sfondo `COLORFGBG`:

- analisi dell'indice di sfondo da `COLORFGBG`
- `< 8` => slot scuro (`theme.dark`)
- `>= 8` => slot chiaro (`theme.light`)
- errore di analisi => slot scuro

Valori predefiniti correnti dallo schema delle impostazioni:

- `theme.dark = "xcsh-dark"`
- `theme.light = "xcsh-light"`
- `symbolPreset = "unicode"`
- `colorBlindMode = false`

### Cambio esplicito (`setTheme`)

- carica il tema selezionato
- aggiorna il singleton globale `theme`
- avvia facoltativamente il watcher
- attiva il callback `onThemeChange`

In caso di errore:

- effettua il fallback al tema predefinito `dark`
- restituisce `{ success: false, error }`

### Cambio in anteprima (`previewTheme`)

- applica un tema di anteprima temporaneo al `theme` globale
- **non** modifica di per sé le impostazioni persistenti
- restituisce successo/errore senza sostituzione di fallback

L'interfaccia delle impostazioni utilizza questa funzione per l'anteprima in tempo reale e ripristina il tema precedente in caso di annullamento.

## Watcher e ricaricamento live

Quando il watcher è abilitato (`setTheme(..., true)` / inizializzazione interattiva):

- monitora solo il percorso del file personalizzato `<customThemesDir>/<currentTheme>.json`
- i temi predefiniti non vengono monitorati
- evento `change` del file: tenta il ricaricamento (con debounce)
- evento `rename`/eliminazione del file: effettua il fallback a `dark`, chiude il watcher

La modalità automatica installa anche un listener `SIGWINCH` e può rivalutare la mappatura degli slot scuro/chiaro quando lo stato del terminale cambia.

## Comportamento della modalità daltonismo

`colorBlindMode` modifica a runtime solo un token:

- `toolDiffAdded` viene regolato in HSV (il verde viene spostato verso il blu)
- la regolazione viene applicata solo quando il valore risolto è una stringa esadecimale

Gli altri token rimangono invariati.

## Dove vengono persistite le impostazioni del tema

Le impostazioni relative al tema vengono persistite da `Settings` nel file YAML di configurazione globale:

- percorso: `<agentDir>/config.yml`
- directory agente predefinita: `~/.xcsh/agent`
- file predefinito effettivo: `~/.xcsh/agent/config.yml`

Chiavi persistite:

- `theme.dark`
- `theme.light`
- `symbolPreset`
- `colorBlindMode`

Esiste una migrazione legacy: il vecchio `theme: "name"` flat viene migrato a `theme.dark` o `theme.light` annidati in base al rilevamento della luminanza.

## Creazione di un tema personalizzato (pratica)

1. Creare il file nella directory dei temi personalizzati, ad esempio `~/.xcsh/agent/themes/my-theme.json`.
2. Includere `name`, `vars` facoltativo e **tutti i** token `colors` obbligatori.
3. Includere facoltativamente `symbols` ed `export`.
4. Selezionare il tema nelle Impostazioni (`Display -> Dark theme` o `Display -> Light theme`) a seconda dello slot automatico desiderato.

Struttura minimale. Ogni chiave in `colors` è obbligatoria — il validatore runtime
(`additionalProperties: false`) rifiuta sia le chiavi mancanti che quelle sconosciute.
Per le implementazioni di riferimento fornite consultare
[`packages/coding-agent/src/modes/theme/defaults/xcsh-dark.json`](../../packages/coding-agent/src/modes/theme/defaults/xcsh-dark.json)
e [`xcsh-light.json`](../../packages/coding-agent/src/modes/theme/defaults/xcsh-light.json).

La barra di stato dispone di due sistemi di colori paralleli documentati nella issue #242:

- Colori testo esadecimali (`statusLinePath`, `statusLineGitClean`, `statusLineGitDirty`,
  `statusLineStaged`, `statusLineDirty`, `statusLineUntracked`) gestiscono il rendering non-powerline.
- Indici della palette a 256 colori (`statusLine<Segment>Bg` / `statusLine<Segment>Fg`)
  gestiscono i riempimenti dei segmenti powerline. Sono indipendenti dalle chiavi esadecimali di cui sopra —
  entrambi devono essere impostati.

```json
{
  "name": "my-theme",
  "vars": {
    "accent": "#7aa2f7",
    "muted": 244
  },
  "colors": {
    "accent": "accent",
    "chromeAccent": "accent",
    "spinnerAccent": "accent",
    "contentAccent": "muted",
    "border": "#4c566a",
    "borderAccent": "accent",
    "borderMuted": "muted",
    "success": "#9ece6a",
    "error": "#f7768e",
    "warning": "#e0af68",
    "muted": "muted",
    "dim": 240,
    "gutterSuccess": "#7dcfff",
    "gutterWarning": "#e0af68",
    "text": "",
    "thinkingText": "muted",

    "selectedBg": "#2a2f45",
    "userMessageBg": "#1f2335",
    "userMessageText": "",
    "customMessageBg": "#24283b",
    "customMessageText": "",
    "customMessageLabel": "accent",
    "toolPendingBg": "#1f2335",
    "toolSuccessBg": "#1f2d2a",
    "toolErrorBg": "#2d1f2a",
    "toolTitle": "",
    "toolOutput": "muted",

    "mdHeading": "accent",
    "mdLink": "accent",
    "mdLinkUrl": "muted",
    "mdCode": "#c0caf5",
    "mdCodeBlock": "#c0caf5",
    "mdCodeBlockBorder": "muted",
    "mdQuote": "muted",
    "mdQuoteBorder": "muted",
    "mdHr": "muted",
    "mdListBullet": "accent",

    "toolDiffAdded": "#9ece6a",
    "toolDiffRemoved": "#f7768e",
    "toolDiffContext": "muted",

    "syntaxComment": "#565f89",
    "syntaxKeyword": "#bb9af7",
    "syntaxFunction": "#7aa2f7",
    "syntaxVariable": "#c0caf5",
    "syntaxString": "#9ece6a",
    "syntaxNumber": "#ff9e64",
    "syntaxType": "#2ac3de",
    "syntaxOperator": "#89ddff",
    "syntaxPunctuation": "#9aa5ce",
    "syntaxControl": "#bb9af7",

    "thinkingOff": 240,
    "thinkingMinimal": 244,
    "thinkingLow": "#7aa2f7",
    "thinkingMedium": "#2ac3de",
    "thinkingHigh": "#bb9af7",
    "thinkingXhigh": "#f7768e",

    "bashMode": "#2ac3de",
    "pythonMode": "#bb9af7",

    "statusLineBg": "#16161e",
    "statusLineSep": 240,
    "statusLineModel": "#bb9af7",
    "statusLinePath": "#7aa2f7",
    "statusLineGitClean": "#9ece6a",
    "statusLineGitDirty": "#e0af68",
    "statusLineContext": "#2ac3de",
    "statusLineSpend": "#7dcfff",
    "statusLineStaged": "#9ece6a",
    "statusLineDirty": "#e0af68",
    "statusLineUntracked": "#f7768e",
    "statusLineOutput": "#c0caf5",
    "statusLineCost": "#ff9e64",
    "statusLineSubagents": "#bb9af7",

    "statusLineOsIconBg": 7,
    "statusLineOsIconFg": 232,
    "statusLinePathBg": 4,
    "statusLinePathFg": 254,
    "statusLineGitCleanBg": 2,
    "statusLineGitCleanFg": 0,
    "statusLineGitDirtyBg": 3,
    "statusLineGitDirtyFg": 0,
    "statusLineGitStagedBg": 64,
    "statusLineGitStagedFg": 0,
    "statusLineGitUntrackedBg": 39,
    "statusLineGitUntrackedFg": 0,
    "statusLineGitConflictBg": 1,
    "statusLineGitConflictFg": 7,
    "statusLinePlanModeBg": 236,
    "statusLinePlanModeFg": 117,
    "statusLineProfileF5xcBg": "accent",
    "statusLineProfileF5xcFg": 231
  }
}
```

## Test dei temi personalizzati

Utilizzare questo flusso di lavoro:

1. Avviare la modalità interattiva (watcher abilitato all'avvio).
2. Aprire le impostazioni e visualizzare in anteprima i valori del tema (live `previewTheme`).
3. Per i file di tema personalizzati, modificare il JSON durante l'esecuzione e verificare il ricaricamento automatico al salvataggio.
4. Verificare le superfici critiche:
   - rendering markdown
   - blocchi strumenti (pending/success/error)
   - rendering diff (added/removed/context)
   - leggibilità della barra di stato
   - cambiamenti dei bordi al livello di pensiero
   - colori dei bordi in modalità bash/python
5. Validare entrambi i preset di simboli se il tema dipende dalla larghezza/aspetto dei glifi.

## Vincoli reali e avvertenze

- Tutti i token `colors` sono obbligatori per i temi personalizzati.
- `export` e `symbols` sono facoltativi.
- `$schema` nel JSON del tema è informativo; la validazione runtime è applicata dallo schema TypeBox compilato nel codice.
- Il fallback di `setTheme` in caso di errore è `dark`; il fallback di `previewTheme` in caso di errore non sostituisce il tema corrente.
- Gli errori di ricaricamento del watcher mantengono il tema attualmente caricato fino a quando non viene eseguito con successo un ricaricamento o viene attivato un percorso di fallback.
