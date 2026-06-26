---
title: Referencia de Temas
description: >-
  Referencia de temas de TUI con tokens de color, configuración de fuentes y
  personalización de temas.
sidebar:
  order: 3
  label: Temas
i18n:
  sourceHash: 7132374bd51e
  translator: machine
---

# Referencia de Temas

Este documento describe cómo funciona el sistema de temas en el coding-agent actualmente: esquema, carga, comportamiento en tiempo de ejecución y modos de fallo.

## Qué controla el sistema de temas

El sistema de temas gestiona:

- tokens de color de primer plano/fondo utilizados en toda la TUI
- adaptadores de estilos de markdown (`getMarkdownTheme()`)
- adaptadores de selector/editor/lista de configuración (`getSelectListTheme()`, `getEditorTheme()`, `getSettingsListTheme()`)
- preset de símbolos + sobrecargas de símbolos (`unicode`, `nerd`, `ascii`)
- colores de resaltado de sintaxis utilizados por el resaltador nativo (`@f5-sales-demo/pi-natives`)
- colores de los segmentos de la línea de estado

Implementación principal: `src/modes/theme/theme.ts`.

## Estructura JSON del tema

Los archivos de tema son objetos JSON validados contra el esquema en tiempo de ejecución en `theme.ts` (`ThemeJsonSchema`) y reflejados en `src/modes/theme/theme-schema.json`.

Campos de nivel superior:

- `name` (requerido)
- `colors` (requerido; todos los tokens de color son requeridos)
- `vars` (opcional; variables de color reutilizables)
- `export` (opcional; colores para exportación HTML)
- `symbols` (opcional)
  - `preset` (opcional: `unicode | nerd | ascii`)
  - `overrides` (opcional: sobrecargas clave/valor para `SymbolKey`)

Los valores de color aceptan:

- cadena hexadecimal (`"#RRGGBB"`)
- índice de color de 256 colores (`0..255`)
- cadena de referencia a variable (resuelta a través de `vars`)
- cadena vacía (`""`) que significa valor predeterminado del terminal (`\x1b[39m` fg, `\x1b[49m` bg)

## Tokens de color requeridos (actuales)

Todos los tokens a continuación son requeridos en `colors`.

### Texto y bordes principales (11)

`accent`, `border`, `borderAccent`, `borderMuted`, `success`, `error`, `warning`, `muted`, `dim`, `text`, `thinkingText`

### Bloques de fondo (7)

`selectedBg`, `userMessageBg`, `customMessageBg`, `toolPendingBg`, `toolSuccessBg`, `toolErrorBg`, `statusLineBg`

### Texto de mensajes/herramientas (5)

`userMessageText`, `customMessageText`, `customMessageLabel`, `toolTitle`, `toolOutput`

### Markdown (10)

`mdHeading`, `mdLink`, `mdLinkUrl`, `mdCode`, `mdCodeBlock`, `mdCodeBlockBorder`, `mdQuote`, `mdQuoteBorder`, `mdHr`, `mdListBullet`

### Diff de herramientas + resaltado de sintaxis (12)

`toolDiffAdded`, `toolDiffRemoved`, `toolDiffContext`,
`syntaxComment`, `syntaxKeyword`, `syntaxFunction`, `syntaxVariable`, `syntaxString`, `syntaxNumber`, `syntaxType`, `syntaxOperator`, `syntaxPunctuation`

### Bordes de modo/pensamiento (8)

`thinkingOff`, `thinkingMinimal`, `thinkingLow`, `thinkingMedium`, `thinkingHigh`, `thinkingXhigh`, `bashMode`, `pythonMode`

### Colores de segmentos de la línea de estado (14)

`statusLineSep`, `statusLineModel`, `statusLinePath`, `statusLineGitClean`, `statusLineGitDirty`, `statusLineContext`, `statusLineSpend`, `statusLineStaged`, `statusLineDirty`, `statusLineUntracked`, `statusLineOutput`, `statusLineCost`, `statusLineSubagents`

## Tokens opcionales

### Sección `export` (opcional)

Utilizada para los helpers de temas en exportación HTML:

- `export.pageBg`
- `export.cardBg`
- `export.infoBg`

Si se omite, el código de exportación deriva valores predeterminados de los colores del tema resueltos.

### Sección `symbols` (opcional)

- `symbols.preset` establece un conjunto de símbolos predeterminado a nivel de tema.
- `symbols.overrides` puede sobrecargar valores individuales de `SymbolKey`.

Precedencia en tiempo de ejecución:

1. sobrecarga de `symbolPreset` en configuración (si está establecida)
2. `symbols.preset` del JSON del tema
3. respaldo `"unicode"`

Las claves de sobrecarga inválidas se ignoran y se registran (`logger.debug`).

## Fuentes de temas integrados vs personalizados

Orden de búsqueda de temas (`loadThemeJson`):

1. temas integrados embebidos (`defaults/xcsh-dark.json` y `defaults/xcsh-light.json` compilados en `defaultThemes`)
2. archivo de tema personalizado: `<customThemesDir>/<name>.json`

El directorio de temas personalizados proviene de `getCustomThemesDir()`:

- predeterminado: `~/.xcsh/agent/themes`
- sobreescrito por `PI_CODING_AGENT_DIR` (`$PI_CODING_AGENT_DIR/themes`)

`getAvailableThemes()` devuelve los nombres integrados + personalizados fusionados, ordenados, con los integrados teniendo precedencia en caso de colisión de nombres.

## Carga, validación y resolución

Para archivos de temas personalizados:

1. leer JSON
2. parsear JSON
3. validar contra `ThemeJsonSchema`
4. resolver referencias de `vars` recursivamente
5. convertir valores resueltos a ANSI según el modo de capacidad del terminal

Comportamiento de validación:

- tokens de color requeridos faltantes: mensaje de error agrupado explícito
- tipos/valores de tokens incorrectos: errores de validación con ruta JSON
- archivo de tema desconocido: `Theme not found: <name>`

Comportamiento de referencia a variables:

- soporta referencias anidadas
- lanza error en referencia a variable faltante
- lanza error en referencias circulares

## Comportamiento del modo de color del terminal

Detección del modo de color (`detectColorMode`):

- `COLORTERM=truecolor|24bit` => truecolor
- `WT_SESSION` => truecolor
- `TERM` en `dumb`, `linux`, o vacío => 256color
- de lo contrario => truecolor

Comportamiento de conversión:

- hex -> `Bun.color(..., "ansi-16m" | "ansi-256")`
- numérico -> ANSI `38;5` / `48;5`
- `""` -> reset de fg/bg predeterminado

## Comportamiento de cambio en tiempo de ejecución

### Tema inicial (`initTheme`)

`main.ts` inicializa el tema con la configuración:

- `symbolPreset`
- `colorBlindMode`
- `theme.dark`
- `theme.light`

La selección automática de ranura de tema utiliza la detección de fondo de `COLORFGBG`:

- parsear el índice de fondo de `COLORFGBG`
- `< 8` => ranura oscura (`theme.dark`)
- `>= 8` => ranura clara (`theme.light`)
- fallo en el parseo => ranura oscura

Valores predeterminados actuales del esquema de configuración:

- `theme.dark = "xcsh-dark"`
- `theme.light = "xcsh-light"`
- `symbolPreset = "unicode"`
- `colorBlindMode = false`

### Cambio explícito (`setTheme`)

- carga el tema seleccionado
- actualiza el singleton global `theme`
- opcionalmente inicia el watcher
- dispara el callback `onThemeChange`

En caso de fallo:

- recurre al tema integrado `dark`
- devuelve `{ success: false, error }`

### Cambio de vista previa (`previewTheme`)

- aplica un tema de vista previa temporal al `theme` global
- **no** cambia la configuración persistida por sí mismo
- devuelve éxito/error sin reemplazo de respaldo

La UI de configuración utiliza esto para vista previa en vivo y restaura el tema anterior al cancelar.

## Watchers y recarga en vivo

Cuando el watcher está habilitado (`setTheme(..., true)` / inicialización interactiva):

- solo vigila la ruta del archivo personalizado `<customThemesDir>/<currentTheme>.json`
- los integrados efectivamente no se vigilan
- archivo `change`: intenta recargar (con debounce)
- archivo `rename`/eliminado: recurre a `dark`, cierra el watcher

El modo automático también instala un listener `SIGWINCH` y puede reevaluar el mapeo de ranura oscura/clara cuando el estado del terminal cambia.

## Comportamiento del modo para daltonismo

`colorBlindMode` cambia solo un token en tiempo de ejecución:

- `toolDiffAdded` se ajusta en HSV (verde desplazado hacia azul)
- el ajuste se aplica solo cuando el valor resuelto es una cadena hexadecimal

Los demás tokens no se modifican.

## Dónde se persiste la configuración de temas

La configuración relacionada con temas se persiste mediante `Settings` en el archivo YAML de configuración global:

- ruta: `<agentDir>/config.yml`
- directorio de agente predeterminado: `~/.xcsh/agent`
- archivo predeterminado efectivo: `~/.xcsh/agent/config.yml`

Claves persistidas:

- `theme.dark`
- `theme.light`
- `symbolPreset`
- `colorBlindMode`

Existe migración de legado: el antiguo `theme: "name"` plano se migra a `theme.dark` o `theme.light` anidado basándose en la detección de luminancia.

## Creación de un tema personalizado (práctico)

1. Crear un archivo en el directorio de temas personalizados, p. ej. `~/.xcsh/agent/themes/my-theme.json`.
2. Incluir `name`, `vars` opcional, y **todos los** tokens de `colors` requeridos.
3. Opcionalmente incluir `symbols` y `export`.
4. Seleccionar el tema en Configuración (`Display -> Dark theme` o `Display -> Light theme`) dependiendo de la ranura automática que desee.

Esqueleto mínimo. Cada clave en `colors` es requerida — el validador en tiempo de ejecución
(`additionalProperties: false`) rechaza tanto claves faltantes como claves desconocidas.
Para las implementaciones de referencia incluidas, consulte
[`packages/coding-agent/src/modes/theme/defaults/xcsh-dark.json`](../../packages/coding-agent/src/modes/theme/defaults/xcsh-dark.json)
y [`xcsh-light.json`](../../packages/coding-agent/src/modes/theme/defaults/xcsh-light.json).

La línea de estado tiene dos sistemas de color paralelos documentados en el issue #242:

- Colores de texto hexadecimales (`statusLinePath`, `statusLineGitClean`, `statusLineGitDirty`,
  `statusLineStaged`, `statusLineDirty`, `statusLineUntracked`) controlan el
  renderizado sin powerline.
- Índices de paleta de 256 colores (`statusLine<Segment>Bg` / `statusLine<Segment>Fg`)
  controlan el relleno de segmentos powerline. Son independientes de las claves hexadecimales anteriores —
  ambos deben configurarse.

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
    "statusLineProfileXcshBg": "accent",
    "statusLineProfileXcshFg": 231
  }
}
```

## Pruebas de temas personalizados

Utilice este flujo de trabajo:

1. Iniciar el modo interactivo (watcher habilitado desde el arranque).
2. Abrir configuración y previsualizar los valores del tema (`previewTheme` en vivo).
3. Para archivos de temas personalizados, editar el JSON mientras se ejecuta y confirmar la recarga automática al guardar.
4. Ejercitar las superficies críticas:
   - renderizado de markdown
   - bloques de herramientas (pendiente/éxito/error)
   - renderizado de diff (añadido/eliminado/contexto)
   - legibilidad de la línea de estado
   - cambios de borde por nivel de pensamiento
   - colores de borde del modo bash/python
5. Validar ambos presets de símbolos si su tema depende del ancho/apariencia de los glifos.

## Restricciones reales y advertencias

- Todos los tokens de `colors` son requeridos para temas personalizados.
- `export` y `symbols` son opcionales.
- `$schema` en el JSON del tema es informativo; la validación en tiempo de ejecución es aplicada por el esquema TypeBox compilado en el código.
- El fallo de `setTheme` recurre a `dark`; el fallo de `previewTheme` no reemplaza el tema actual.
- Los errores de recarga del watcher de archivos mantienen el tema cargado actualmente hasta que una recarga exitosa o una ruta de respaldo sea activada.
