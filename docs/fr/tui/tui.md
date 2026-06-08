---
title: Intégration TUI pour les extensions et les outils personnalisés
description: >-
  Contrat d'intégration TUI pour les extensions, les outils personnalisés et les
  rendus personnalisés.
sidebar:
  order: 1
  label: Intégration des extensions
i18n:
  sourceHash: 966be66eee07
  translator: machine
---

# Intégration TUI pour les extensions et les outils personnalisés

Ce document couvre le contrat TUI **actuel** utilisé par `packages/coding-agent` et `packages/tui` pour l'interface utilisateur des extensions, l'interface utilisateur des outils personnalisés et les rendus personnalisés.

## Ce qu'est ce sous-système

Le runtime comporte deux couches :

- **Moteur de rendu (`packages/tui`)** : rendu terminal différentiel, dispatch des entrées, focus, overlays, positionnement du curseur.
- **Couche d'intégration (`packages/coding-agent`)** : monte les composants d'extension/outil personnalisé, connecte les raccourcis clavier/thème et restaure l'état de l'éditeur.

## Comportement du runtime par mode

| Mode | Disponibilité de `ctx.ui.custom(...)` | Notes |
| --- | --- | --- |
| TUI interactif | Supporté | Le composant est monté dans la zone de l'éditeur, reçoit le focus, et doit appeler `done(result)` pour résoudre. |
| Arrière-plan/headless | Non interactif | Le contexte UI est un no-op (`hasUI === false`). |
| Mode RPC | Non supporté | `custom()` retourne `Promise<never>` et ne monte pas de composants TUI. |

Si votre extension/outil peut fonctionner en mode non interactif, protégez-vous avec `ctx.hasUI` / `pi.hasUI`.

## Contrat de composant principal (`@f5xc-salesdemos/pi-tui`)

`packages/tui/src/tui.ts` définit :

```ts
export interface Component {
  render(width: number): string[];
  handleInput?(data: string): void;
  wantsKeyRelease?: boolean;
  invalidate(): void;
}
```

`Focusable` est séparé :

```ts
export interface Focusable {
  focused: boolean;
}
```

Le comportement du curseur utilise `CURSOR_MARKER` (pas `getCursorPosition`). Les composants ayant le focus émettent le marqueur dans le texte rendu ; `TUI` l'extrait et positionne le curseur matériel.

## Contraintes de rendu (sécurité terminale)

La sortie de votre `render(width)` doit être compatible avec le terminal :

1. **Ne jamais dépasser `width` sur aucune ligne**. Le moteur de rendu lève une erreur si une ligne non-image déborde.
2. **Mesurez la largeur visuelle**, pas la longueur de la chaîne : utilisez `visibleWidth()`.
3. **Tronquez/encapsulez le texte compatible ANSI** avec `truncateToWidth()` / `wrapTextWithAnsi()`.
4. **Assainissez les tabulations/contenus** provenant de sources externes en utilisant `replaceTabs()` (et les assainisseurs de plus haut niveau dans les chemins de rendu de coding-agent).

Patron minimal :

```ts
import { replaceTabs, truncateToWidth } from "@f5xc-salesdemos/pi-tui";

render(width: number): string[] {
  return this.lines.map(line => truncateToWidth(replaceTabs(line), width));
}
```

## Gestion des entrées et raccourcis clavier

### Correspondance brute des touches

Utilisez `matchesKey(data, "...")` pour les touches de navigation et les combinaisons.

### Respectez les raccourcis clavier configurés par l'utilisateur

Les factories d'interface utilisateur des extensions reçoivent un `KeybindingsManager` (mode interactif) afin que vous puissiez honorer les actions mappées au lieu de coder en dur les touches :

```ts
if (keybindings.matches(data, "interrupt")) {
  done(undefined);
  return;
}
```

### Événements de relâchement/répétition de touches

Les événements de relâchement de touches sont filtrés sauf si votre composant définit :

```ts
wantsKeyRelease = true;
```

Utilisez ensuite `isKeyRelease()` / `isKeyRepeat()` si nécessaire.

## Focus, overlays et curseur

- `TUI.setFocus(component)` route les entrées vers ce composant.
- Les API d'overlay existent dans `TUI` (`showOverlay`, `OverlayHandle`), mais le montage `ctx.ui.custom` des extensions en mode interactif remplace actuellement directement la zone du composant éditeur.
- L'option `custom(..., options?: { overlay?: boolean })` existe dans les types d'extension ; le montage interactif des extensions ignore actuellement cette option.

## Points de montage et contrats de retour

## 1) Interface utilisateur d'extension (`ExtensionUIContext`)

Signature actuelle (`extensibility/extensions/types.ts`) :

```ts
custom<T>(
  factory: (
    tui: TUI,
    theme: Theme,
    keybindings: KeybindingsManager,
    done: (result: T) => void,
  ) => (Component & { dispose?(): void }) | Promise<Component & { dispose?(): void }>,
  options?: { overlay?: boolean },
): Promise<T>
```

Comportement en mode interactif (`extension-ui-controller.ts`) :

- Sauvegarde le texte de l'éditeur.
- Remplace le composant éditeur par votre composant.
- Donne le focus à votre composant.
- À l'appel de `done(result)` : appelle `component.dispose?.()`, restaure l'éditeur + le texte, donne le focus à l'éditeur, résout la promesse.

Donc `done(...)` est obligatoire pour la complétion.

## 2) Contexte UI hook/outil personnalisé (typage legacy)

`HookUIContext.custom` est typé comme `(tui, theme, done)` dans les types de hook/outil personnalisé.
L'implémentation interactive sous-jacente appelle les factories avec `(tui, theme, keybindings, done)`. Les consommateurs JS peuvent utiliser l'argument supplémentaire ; la compatibilité au niveau des types reflète encore la signature legacy à 3 arguments.

Les outils personnalisés utilisent typiquement le même point d'entrée UI via l'objet `pi.ui` avec portée factory, puis retournent la valeur sélectionnée dans le contenu normal de l'outil :

```ts
async execute(toolCallId, params, onUpdate, ctx, signal) {
  if (!pi.hasUI) {
    return { content: [{ type: "text", text: "UI unavailable" }] };
  }

  const picked = await pi.ui.custom<string | undefined>((tui, theme, done) => {
    const component = new MyPickerComponent(done, signal);
    return component;
  });

  return { content: [{ type: "text", text: picked ? `Picked: ${picked}` : "Cancelled" }] };
}
```

## 3) Rendus personnalisés d'appel/résultat d'outil

Les outils personnalisés et les outils d'extension peuvent retourner des composants depuis :

- `renderCall(args, theme)`
- `renderResult(result, options, theme, args?)`

`options` inclut actuellement :

- `expanded: boolean`
- `isPartial: boolean`
- `spinnerFrame?: number`

Ces rendus sont montés par `ToolExecutionComponent`.

## Cycle de vie et annulation

- `dispose()` est optionnel au niveau des types mais devrait être implémenté lorsque vous possédez des timers, sous-processus, watchers, sockets ou overlays.
- `done(...)` devrait être appelé exactement une fois depuis le flux de votre composant.
- Pour une interface utilisateur longue durée annulable, associez `CancellableLoader` avec `AbortSignal` et appelez `done(...)` depuis `onAbort`.

Exemple de patron d'annulation :

```ts
const loader = new CancellableLoader(tui, theme.fg("accent"), theme.fg("muted"), "Working...");
loader.onAbort = () => done(undefined);
void doWork(loader.signal).then(result => done(result));
return loader;
```

## Exemple réaliste de composant personnalisé (commande d'extension)

```ts
import type { Component } from "@f5xc-salesdemos/pi-tui";
import { SelectList, matchesKey, replaceTabs, truncateToWidth } from "@f5xc-salesdemos/pi-tui";
import { getSelectListTheme, type ExtensionAPI } from "@f5xc-salesdemos/xcsh";

class Picker implements Component {
  list: SelectList;
  keybindings: any;
  done: (value: string | undefined) => void;

  constructor(
    items: Array<{ value: string; label: string }>,
    keybindings: any,
    done: (value: string | undefined) => void,
  ) {
    this.list = new SelectList(items, 8, getSelectListTheme());
    this.keybindings = keybindings;
    this.done = done;
    this.list.onSelect = item => this.done(item.value);
    this.list.onCancel = () => this.done(undefined);
  }

  handleInput(data: string): void {
    if (this.keybindings.matches(data, "interrupt")) {
      this.done(undefined);
      return;
    }
    this.list.handleInput(data);
  }

  render(width: number): string[] {
    return this.list.render(width).map(line => truncateToWidth(replaceTabs(line), width));
  }

  invalidate(): void {
    this.list.invalidate();
  }
}

export default function extension(pi: ExtensionAPI): void {
  pi.registerCommand("pick-model", {
    description: "Pick a model profile",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) return;

      const selected = await ctx.ui.custom<string | undefined>((tui, theme, keybindings, done) => {
        const items = [
          { value: "fast", label: theme.fg("accent", "Fast") },
          { value: "balanced", label: "Balanced" },
          { value: "quality", label: "Quality" },
        ];
        return new Picker(items, keybindings, done);
      });

      if (selected) ctx.ui.notify(`Selected profile: ${selected}`, "info");
    },
  });
}
```

## Fichiers d'implémentation clés

- `packages/tui/src/tui.ts` — `Component`, `Focusable`, marqueur de curseur, focus, overlay, dispatch des entrées.
- `packages/tui/src/utils.ts` — primitives de largeur/troncature/assainissement.
- `packages/tui/src/keys.ts` / `keybindings.ts` — analyse des touches et mappage configurable des actions.
- `packages/coding-agent/src/modes/controllers/extension-ui-controller.ts` — montage/démontage interactif pour l'interface utilisateur des extensions/hooks/outils personnalisés.
- `packages/coding-agent/src/extensibility/extensions/types.ts` — contrats d'interface utilisateur et de rendu des extensions.
- `packages/coding-agent/src/extensibility/hooks/types.ts` — contrat d'interface utilisateur des hooks (signature custom legacy).
- `packages/coding-agent/src/extensibility/custom-tools/types.ts` — contrats d'exécution/rendu des outils personnalisés.
- `packages/coding-agent/src/modes/components/tool-execution.ts` — montage des composants `renderCall`/`renderResult` et options d'état partiel.
- `packages/coding-agent/src/tools/context.ts` — propagation du contexte UI des outils (`hasUI`, `ui`).
