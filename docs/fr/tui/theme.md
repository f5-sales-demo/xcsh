---
title: Référence de la thématisation
description: >-
  Référence de la thématisation TUI avec jetons de couleur, paramètres de police
  et personnalisation des thèmes.
sidebar:
  order: 3
  label: Thématisation
i18n:
  sourceHash: 1f5d0f83a7f4
  translator: machine
---

# Référence de la thématisation

Ce document décrit comment la thématisation fonctionne dans le coding-agent aujourd'hui : schéma, chargement, comportement à l'exécution et modes de défaillance.

## Ce que le système de thèmes contrôle

Le système de thèmes pilote :

- les jetons de couleur de premier plan/arrière-plan utilisés dans le TUI
- les adaptateurs de style markdown (`getMarkdownTheme()`)
- les adaptateurs de sélecteur/éditeur/liste de paramètres (`getSelectListTheme()`, `getEditorTheme()`, `getSettingsListTheme()`)
- le preset de symboles + les remplacements de symboles (`unicode`, `nerd`, `ascii`)
- les couleurs de coloration syntaxique utilisées par le surligneur natif (`@f5xc-salesdemos/pi-natives`)
- les couleurs des segments de la barre d'état

Implémentation principale : `src/modes/theme/theme.ts`.

## Structure JSON du thème

Les fichiers de thème sont des objets JSON validés par rapport au schéma d'exécution dans `theme.ts` (`ThemeJsonSchema`) et reflétés par `src/modes/theme/theme-schema.json`.

Champs de niveau supérieur :

- `name` (requis)
- `colors` (requis ; tous les jetons de couleur sont requis)
- `vars` (optionnel ; variables de couleur réutilisables)
- `export` (optionnel ; couleurs d'export HTML)
- `symbols` (optionnel)
  - `preset` (optionnel : `unicode | nerd | ascii`)
  - `overrides` (optionnel : remplacements clé/valeur pour `SymbolKey`)

Les valeurs de couleur acceptent :

- chaîne hexadécimale (`"#RRGGBB"`)
- index de couleur 256 (`0..255`)
- chaîne de référence de variable (résolue via `vars`)
- chaîne vide (`""`) signifiant la valeur par défaut du terminal (`\x1b[39m` premier plan, `\x1b[49m` arrière-plan)

## Jetons de couleur requis (actuels)

Tous les jetons ci-dessous sont requis dans `colors`.

### Texte principal et bordures (11)

`accent`, `border`, `borderAccent`, `borderMuted`, `success`, `error`, `warning`, `muted`, `dim`, `text`, `thinkingText`

### Blocs d'arrière-plan (7)

`selectedBg`, `userMessageBg`, `customMessageBg`, `toolPendingBg`, `toolSuccessBg`, `toolErrorBg`, `statusLineBg`

### Texte de message/outil (5)

`userMessageText`, `customMessageText`, `customMessageLabel`, `toolTitle`, `toolOutput`

### Markdown (10)

`mdHeading`, `mdLink`, `mdLinkUrl`, `mdCode`, `mdCodeBlock`, `mdCodeBlockBorder`, `mdQuote`, `mdQuoteBorder`, `mdHr`, `mdListBullet`

### Diff d'outil + coloration syntaxique (12)

`toolDiffAdded`, `toolDiffRemoved`, `toolDiffContext`,
`syntaxComment`, `syntaxKeyword`, `syntaxFunction`, `syntaxVariable`, `syntaxString`, `syntaxNumber`, `syntaxType`, `syntaxOperator`, `syntaxPunctuation`

### Bordures de mode/réflexion (8)

`thinkingOff`, `thinkingMinimal`, `thinkingLow`, `thinkingMedium`, `thinkingHigh`, `thinkingXhigh`, `bashMode`, `pythonMode`

### Couleurs des segments de la barre d'état (14)

`statusLineSep`, `statusLineModel`, `statusLinePath`, `statusLineGitClean`, `statusLineGitDirty`, `statusLineContext`, `statusLineSpend`, `statusLineStaged`, `statusLineDirty`, `statusLineUntracked`, `statusLineOutput`, `statusLineCost`, `statusLineSubagents`

## Jetons optionnels

### Section `export` (optionnelle)

Utilisée pour les assistants de thématisation d'export HTML :

- `export.pageBg`
- `export.cardBg`
- `export.infoBg`

Si omis, le code d'export dérive les valeurs par défaut des couleurs du thème résolu.

### Section `symbols` (optionnelle)

- `symbols.preset` définit un jeu de symboles par défaut au niveau du thème.
- `symbols.overrides` peut remplacer des valeurs individuelles de `SymbolKey`.

Ordre de priorité à l'exécution :

1. remplacement `symbolPreset` des paramètres (si défini)
2. `symbols.preset` du JSON du thème
3. valeur de repli `"unicode"`

Les clés de remplacement invalides sont ignorées et journalisées (`logger.debug`).

## Sources de thèmes intégrés vs personnalisés

Ordre de recherche des thèmes (`loadThemeJson`) :

1. thèmes intégrés embarqués (`defaults/xcsh-dark.json` et `defaults/xcsh-light.json` compilés dans `defaultThemes`)
2. fichier de thème personnalisé : `<customThemesDir>/<name>.json`

Le répertoire des thèmes personnalisés provient de `getCustomThemesDir()` :

- par défaut : `~/.xcsh/agent/themes`
- remplacé par `PI_CODING_AGENT_DIR` (`$PI_CODING_AGENT_DIR/themes`)

`getAvailableThemes()` retourne les noms fusionnés intégrés + personnalisés, triés, avec les intégrés ayant la priorité en cas de collision de noms.

## Chargement, validation et résolution

Pour les fichiers de thèmes personnalisés :

1. lecture du JSON
2. analyse du JSON
3. validation par rapport au `ThemeJsonSchema`
4. résolution récursive des références `vars`
5. conversion des valeurs résolues en ANSI selon le mode de capacité du terminal

Comportement de validation :

- jetons de couleur requis manquants : message d'erreur groupé explicite
- types/valeurs de jetons incorrects : erreurs de validation avec chemin JSON
- fichier de thème inconnu : `Theme not found: <name>`

Comportement des références de variables :

- supporte les références imbriquées
- lève une erreur en cas de référence de variable manquante
- lève une erreur en cas de références circulaires

## Comportement du mode de couleur du terminal

Détection du mode de couleur (`detectColorMode`) :

- `COLORTERM=truecolor|24bit` => truecolor
- `WT_SESSION` => truecolor
- `TERM` dans `dumb`, `linux`, ou vide => 256color
- sinon => truecolor

Comportement de conversion :

- hex -> `Bun.color(..., "ansi-16m" | "ansi-256")`
- numérique -> ANSI `38;5` / `48;5`
- `""` -> réinitialisation premier plan/arrière-plan par défaut

## Comportement de changement à l'exécution

### Thème initial (`initTheme`)

`main.ts` initialise le thème avec les paramètres :

- `symbolPreset`
- `colorBlindMode`
- `theme.dark`
- `theme.light`

La sélection automatique de slot de thème utilise la détection d'arrière-plan `COLORFGBG` :

- analyse de l'index d'arrière-plan depuis `COLORFGBG`
- `< 8` => slot sombre (`theme.dark`)
- `>= 8` => slot clair (`theme.light`)
- échec d'analyse => slot sombre

Valeurs par défaut actuelles du schéma de paramètres :

- `theme.dark = "xcsh-dark"`
- `theme.light = "xcsh-light"`
- `symbolPreset = "unicode"`
- `colorBlindMode = false`

### Changement explicite (`setTheme`)

- charge le thème sélectionné
- met à jour le singleton global `theme`
- démarre optionnellement le surveillant
- déclenche le callback `onThemeChange`

En cas d'échec :

- repli vers le thème intégré `dark`
- retourne `{ success: false, error }`

### Changement de prévisualisation (`previewTheme`)

- applique un thème de prévisualisation temporaire au `theme` global
- ne modifie **pas** les paramètres persistés en soi
- retourne succès/erreur sans remplacement de repli

L'interface des paramètres utilise ceci pour la prévisualisation en direct et restaure le thème précédent en cas d'annulation.

## Surveillants et rechargement en direct

Lorsque le surveillant est activé (`setTheme(..., true)` / initialisation interactive) :

- surveille uniquement le chemin de fichier personnalisé `<customThemesDir>/<currentTheme>.json`
- les thèmes intégrés ne sont effectivement pas surveillés
- fichier `change` : tente le rechargement (avec anti-rebond)
- fichier `rename`/suppression : repli vers `dark`, fermeture du surveillant

Le mode automatique installe également un écouteur `SIGWINCH` et peut réévaluer le mapping de slot sombre/clair lorsque l'état du terminal change.

## Comportement du mode daltonien

`colorBlindMode` ne modifie qu'un seul jeton à l'exécution :

- `toolDiffAdded` est ajusté en HSV (le vert est décalé vers le bleu)
- l'ajustement n'est appliqué que lorsque la valeur résolue est une chaîne hexadécimale

Les autres jetons restent inchangés.

## Où les paramètres de thème sont persistés

Les paramètres liés au thème sont persistés par `Settings` dans le fichier YAML de configuration globale :

- chemin : `<agentDir>/config.yml`
- répertoire agent par défaut : `~/.xcsh/agent`
- fichier effectif par défaut : `~/.xcsh/agent/config.yml`

Clés persistées :

- `theme.dark`
- `theme.light`
- `symbolPreset`
- `colorBlindMode`

Une migration héritée existe : l'ancien format plat `theme: "name"` est migré vers le format imbriqué `theme.dark` ou `theme.light` basé sur la détection de luminance.

## Créer un thème personnalisé (pratique)

1. Créez un fichier dans le répertoire des thèmes personnalisés, par ex. `~/.xcsh/agent/themes/my-theme.json`.
2. Incluez `name`, optionnellement `vars`, et **tous les** jetons `colors` requis.
3. Incluez optionnellement `symbols` et `export`.
4. Sélectionnez le thème dans les Paramètres (`Affichage -> Thème sombre` ou `Affichage -> Thème clair`) selon le slot automatique souhaité.

Squelette minimal. Chaque clé dans `colors` est requise — le validateur d'exécution
(`additionalProperties: false`) rejette à la fois les clés manquantes et les clés inconnues.
Pour les implémentations de référence livrées, consultez
[`packages/coding-agent/src/modes/theme/defaults/xcsh-dark.json`](../../packages/coding-agent/src/modes/theme/defaults/xcsh-dark.json)
et [`xcsh-light.json`](../../packages/coding-agent/src/modes/theme/defaults/xcsh-light.json).

La barre d'état dispose de deux systèmes de couleur parallèles documentés dans l'issue #242 :

- Les couleurs de texte hexadécimales (`statusLinePath`, `statusLineGitClean`, `statusLineGitDirty`,
  `statusLineStaged`, `statusLineDirty`, `statusLineUntracked`) pilotent le
  rendu non-powerline.
- Les indices de palette 256 couleurs (`statusLine<Segment>Bg` / `statusLine<Segment>Fg`)
  pilotent les remplissages de segments powerline. Ils sont indépendants des clés hexadécimales ci-dessus —
  les deux doivent être définis.

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

## Tester les thèmes personnalisés

Utilisez ce flux de travail :

1. Démarrez le mode interactif (surveillant activé dès le démarrage).
2. Ouvrez les paramètres et prévisualisez les valeurs du thème (`previewTheme` en direct).
3. Pour les fichiers de thème personnalisés, modifiez le JSON pendant l'exécution et confirmez le rechargement automatique à la sauvegarde.
4. Testez les surfaces critiques :
   - rendu markdown
   - blocs d'outils (en attente/succès/erreur)
   - rendu des diffs (ajouté/supprimé/contexte)
   - lisibilité de la barre d'état
   - changements de bordure selon le niveau de réflexion
   - couleurs de bordure du mode bash/python
5. Validez les deux presets de symboles si votre thème dépend de la largeur/apparence des glyphes.

## Contraintes réelles et mises en garde

- Tous les jetons `colors` sont requis pour les thèmes personnalisés.
- `export` et `symbols` sont optionnels.
- `$schema` dans le JSON du thème est informatif ; la validation à l'exécution est appliquée par le schéma TypeBox compilé dans le code.
- L'échec de `setTheme` effectue un repli vers `dark` ; l'échec de `previewTheme` ne remplace pas le thème actuel.
- Les erreurs de rechargement du surveillant de fichier conservent le thème actuellement chargé jusqu'à un rechargement réussi ou le déclenchement du chemin de repli.
