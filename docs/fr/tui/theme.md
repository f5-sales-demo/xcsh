---
title: Référence du système de thèmes
description: >-
  Référence du système de thèmes TUI avec les jetons de couleur, les paramètres
  de police et la personnalisation des thèmes.
sidebar:
  order: 3
  label: Thèmes
i18n:
  sourceHash: 1f5d0f83a7f4
  translator: machine
---

# Référence du système de thèmes

Ce document décrit le fonctionnement du système de thèmes dans le coding-agent aujourd'hui : schéma, chargement, comportement à l'exécution et modes de défaillance.

## Ce que contrôle le système de thèmes

Le système de thèmes gère :

- les jetons de couleur d'avant-plan/arrière-plan utilisés dans l'ensemble du TUI
- les adaptateurs de style markdown (`getMarkdownTheme()`)
- les adaptateurs de sélecteur/éditeur/liste de paramètres (`getSelectListTheme()`, `getEditorTheme()`, `getSettingsListTheme()`)
- le préréglage de symboles + les substitutions de symboles (`unicode`, `nerd`, `ascii`)
- les couleurs de coloration syntaxique utilisées par le surlignement natif (`@f5xc-salesdemos/pi-natives`)
- les couleurs des segments de la ligne de statut

Implémentation principale : `src/modes/theme/theme.ts`.

## Structure JSON du thème

Les fichiers de thème sont des objets JSON validés par rapport au schéma d'exécution dans `theme.ts` (`ThemeJsonSchema`) et reflétés par `src/modes/theme/theme-schema.json`.

Champs de premier niveau :

- `name` (requis)
- `colors` (requis ; tous les jetons de couleur requis)
- `vars` (optionnel ; variables de couleur réutilisables)
- `export` (optionnel ; couleurs d'export HTML)
- `symbols` (optionnel)
  - `preset` (optionnel : `unicode | nerd | ascii`)
  - `overrides` (optionnel : substitutions clé/valeur pour `SymbolKey`)

Les valeurs de couleur acceptent :

- chaîne hexadécimale (`"#RRGGBB"`)
- index de couleur 256 (`0..255`)
- chaîne de référence de variable (résolue via `vars`)
- chaîne vide (`""`) signifiant la valeur par défaut du terminal (`\x1b[39m` avant-plan, `\x1b[49m` arrière-plan)

## Jetons de couleur requis (actuels)

Tous les jetons ci-dessous sont requis dans `colors`.

### Texte principal et bordures (11)

`accent`, `border`, `borderAccent`, `borderMuted`, `success`, `error`, `warning`, `muted`, `dim`, `text`, `thinkingText`

### Blocs d'arrière-plan (7)

`selectedBg`, `userMessageBg`, `customMessageBg`, `toolPendingBg`, `toolSuccessBg`, `toolErrorBg`, `statusLineBg`

### Texte des messages/outils (5)

`userMessageText`, `customMessageText`, `customMessageLabel`, `toolTitle`, `toolOutput`

### Markdown (10)

`mdHeading`, `mdLink`, `mdLinkUrl`, `mdCode`, `mdCodeBlock`, `mdCodeBlockBorder`, `mdQuote`, `mdQuoteBorder`, `mdHr`, `mdListBullet`

### Diff d'outils + coloration syntaxique (12)

`toolDiffAdded`, `toolDiffRemoved`, `toolDiffContext`,
`syntaxComment`, `syntaxKeyword`, `syntaxFunction`, `syntaxVariable`, `syntaxString`, `syntaxNumber`, `syntaxType`, `syntaxOperator`, `syntaxPunctuation`

### Bordures de mode/réflexion (8)

`thinkingOff`, `thinkingMinimal`, `thinkingLow`, `thinkingMedium`, `thinkingHigh`, `thinkingXhigh`, `bashMode`, `pythonMode`

### Couleurs des segments de la ligne de statut (14)

`statusLineSep`, `statusLineModel`, `statusLinePath`, `statusLineGitClean`, `statusLineGitDirty`, `statusLineContext`, `statusLineSpend`, `statusLineStaged`, `statusLineDirty`, `statusLineUntracked`, `statusLineOutput`, `statusLineCost`, `statusLineSubagents`

## Jetons optionnels

### Section `export` (optionnelle)

Utilisée pour les aides au thème d'export HTML :

- `export.pageBg`
- `export.cardBg`
- `export.infoBg`

Si omise, le code d'export dérive les valeurs par défaut à partir des couleurs résolues du thème.

### Section `symbols` (optionnelle)

- `symbols.preset` définit un jeu de symboles par défaut au niveau du thème.
- `symbols.overrides` peut remplacer des valeurs individuelles de `SymbolKey`.

Ordre de priorité à l'exécution :

1. Substitution `symbolPreset` des paramètres (si défini)
2. `symbols.preset` du JSON du thème
3. Valeur de repli `"unicode"`

Les clés de substitution invalides sont ignorées et journalisées (`logger.debug`).

## Sources de thèmes intégrés vs personnalisés

Ordre de recherche des thèmes (`loadThemeJson`) :

1. Thèmes intégrés embarqués (`defaults/xcsh-dark.json` et `defaults/xcsh-light.json` compilés dans `defaultThemes`)
2. Fichier de thème personnalisé : `<customThemesDir>/<name>.json`

Le répertoire des thèmes personnalisés provient de `getCustomThemesDir()` :

- par défaut : `~/.xcsh/agent/themes`
- remplacé par `PI_CODING_AGENT_DIR` (`$PI_CODING_AGENT_DIR/themes`)

`getAvailableThemes()` retourne les noms fusionnés intégrés + personnalisés, triés, les thèmes intégrés ayant la priorité en cas de collision de noms.

## Chargement, validation et résolution

Pour les fichiers de thème personnalisés :

1. lire le JSON
2. analyser le JSON
3. valider par rapport au `ThemeJsonSchema`
4. résoudre récursivement les références `vars`
5. convertir les valeurs résolues en ANSI selon le mode de capacité du terminal

Comportement de validation :

- jetons de couleur requis manquants : message d'erreur explicite et groupé
- types/valeurs de jetons incorrects : erreurs de validation avec le chemin JSON
- fichier de thème inconnu : `Theme not found: <name>`

Comportement des références de variables :

- prend en charge les références imbriquées
- lève une exception en cas de référence de variable manquante
- lève une exception en cas de références circulaires

## Comportement du mode de couleur du terminal

Détection du mode de couleur (`detectColorMode`) :

- `COLORTERM=truecolor|24bit` => truecolor
- `WT_SESSION` => truecolor
- `TERM` dans `dumb`, `linux`, ou vide => 256color
- sinon => truecolor

Comportement de conversion :

- hex -> `Bun.color(..., "ansi-16m" | "ansi-256")`
- numérique -> ANSI `38;5` / `48;5`
- `""` -> réinitialisation avant-plan/arrière-plan par défaut

## Comportement de changement à l'exécution

### Thème initial (`initTheme`)

`main.ts` initialise le thème avec les paramètres :

- `symbolPreset`
- `colorBlindMode`
- `theme.dark`
- `theme.light`

La sélection automatique de l'emplacement de thème utilise la détection d'arrière-plan `COLORFGBG` :

- analyse l'index d'arrière-plan depuis `COLORFGBG`
- `< 8` => emplacement sombre (`theme.dark`)
- `>= 8` => emplacement clair (`theme.light`)
- échec d'analyse => emplacement sombre

Valeurs par défaut actuelles du schéma de paramètres :

- `theme.dark = "xcsh-dark"`
- `theme.light = "xcsh-light"`
- `symbolPreset = "unicode"`
- `colorBlindMode = false`

### Changement explicite (`setTheme`)

- charge le thème sélectionné
- met à jour le singleton global `theme`
- démarre éventuellement le surveillant
- déclenche le callback `onThemeChange`

En cas d'échec :

- se rabat sur le thème intégré `dark`
- retourne `{ success: false, error }`

### Changement de prévisualisation (`previewTheme`)

- applique un thème de prévisualisation temporaire au `theme` global
- ne modifie **pas** les paramètres persistés par lui-même
- retourne succès/erreur sans remplacement de repli

L'interface des paramètres utilise ceci pour la prévisualisation en direct et restaure le thème précédent en cas d'annulation.

## Surveillants et rechargement en direct

Lorsque le surveillant est activé (`setTheme(..., true)` / initialisation interactive) :

- ne surveille que le chemin de fichier personnalisé `<customThemesDir>/<currentTheme>.json`
- les thèmes intégrés ne sont effectivement pas surveillés
- `change` de fichier : tente le rechargement (avec anti-rebond)
- `rename`/suppression de fichier : se rabat sur `dark`, ferme le surveillant

Le mode automatique installe également un écouteur `SIGWINCH` et peut réévaluer le mappage d'emplacement sombre/clair lorsque l'état du terminal change.

## Comportement du mode daltonien

`colorBlindMode` ne modifie qu'un seul jeton à l'exécution :

- `toolDiffAdded` est ajusté en HSV (le vert est décalé vers le bleu)
- l'ajustement n'est appliqué que lorsque la valeur résolue est une chaîne hexadécimale

Les autres jetons ne sont pas modifiés.

## Où les paramètres de thème sont persistés

Les paramètres liés au thème sont persistés par `Settings` dans le fichier de configuration YAML global :

- chemin : `<agentDir>/config.yml`
- répertoire agent par défaut : `~/.xcsh/agent`
- fichier par défaut effectif : `~/.xcsh/agent/config.yml`

Clés persistées :

- `theme.dark`
- `theme.light`
- `symbolPreset`
- `colorBlindMode`

Une migration héritée existe : l'ancien format plat `theme: "name"` est migré vers le format imbriqué `theme.dark` ou `theme.light` basé sur la détection de luminance.

## Créer un thème personnalisé (pratique)

1. Créez un fichier dans le répertoire des thèmes personnalisés, par ex. `~/.xcsh/agent/themes/my-theme.json`.
2. Incluez `name`, éventuellement `vars`, et **tous les** jetons `colors` requis.
3. Incluez éventuellement `symbols` et `export`.
4. Sélectionnez le thème dans les Paramètres (`Affichage -> Thème sombre` ou `Affichage -> Thème clair`) selon l'emplacement automatique souhaité.

Squelette minimal. Chaque clé dans `colors` est requise — le validateur à l'exécution
(`additionalProperties: false`) rejette à la fois les clés manquantes et les clés inconnues.
Pour les implémentations de référence livrées, consultez
[`packages/coding-agent/src/modes/theme/defaults/xcsh-dark.json`](../../packages/coding-agent/src/modes/theme/defaults/xcsh-dark.json)
et [`xcsh-light.json`](../../packages/coding-agent/src/modes/theme/defaults/xcsh-light.json).

La ligne de statut possède deux systèmes de couleur parallèles documentés dans l'issue #242 :

- Les couleurs de texte hexadécimales (`statusLinePath`, `statusLineGitClean`, `statusLineGitDirty`,
  `statusLineStaged`, `statusLineDirty`, `statusLineUntracked`) pilotent le
  rendu non-powerline.
- Les indices de palette 256 couleurs (`statusLine<Segment>Bg` / `statusLine<Segment>Fg`)
  pilotent le remplissage des segments powerline. Ils sont indépendants des clés hexadécimales ci-dessus —
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

Utilisez ce processus :

1. Démarrez le mode interactif (surveillant activé dès le démarrage).
2. Ouvrez les paramètres et prévisualisez les valeurs du thème (`previewTheme` en direct).
3. Pour les fichiers de thème personnalisés, modifiez le JSON pendant l'exécution et confirmez le rechargement automatique à l'enregistrement.
4. Exercez les surfaces critiques :
   - rendu markdown
   - blocs d'outils (en attente/succès/erreur)
   - rendu des différences (ajouté/supprimé/contexte)
   - lisibilité de la ligne de statut
   - changements de bordure selon le niveau de réflexion
   - couleurs de bordure des modes bash/python
5. Validez les deux préréglages de symboles si votre thème dépend de la largeur/apparence des glyphes.

## Contraintes réelles et mises en garde

- Tous les jetons `colors` sont requis pour les thèmes personnalisés.
- `export` et `symbols` sont optionnels.
- `$schema` dans le JSON du thème est informatif ; la validation à l'exécution est appliquée par le schéma TypeBox compilé dans le code.
- L'échec de `setTheme` se rabat sur `dark` ; l'échec de `previewTheme` ne remplace pas le thème actuel.
- Les erreurs de rechargement du surveillant de fichiers conservent le thème actuellement chargé jusqu'à ce qu'un rechargement réussi ou un chemin de repli soit déclenché.
