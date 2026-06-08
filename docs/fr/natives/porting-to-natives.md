---
title: Portage vers pi-natives (N-API) — Notes de terrain
description: >-
  Notes de terrain pour la migration du code Node.js child_process et shell vers
  la couche native Rust N-API.
sidebar:
  order: 9
  label: Portage vers pi-natives
i18n:
  sourceHash: 4f5150286535
  translator: machine
---

# Portage vers pi-natives (N-API) — Notes de terrain

Ceci est un guide pratique pour déplacer les chemins critiques dans `crates/pi-natives` et les connecter via les bindings JS. Il existe pour éviter que les mêmes erreurs se reproduisent.

## Quand effectuer un portage

Portez lorsque l'une de ces conditions est vraie :

- Le chemin critique s'exécute dans des boucles de rendu, des mises à jour UI fréquentes ou des traitements par lots volumineux.
- Les allocations JS dominent (rotation de chaînes, retour en arrière de regex, grands tableaux).
- Vous disposez déjà d'une référence JS et pouvez comparer les deux versions côte à côte.
- Le travail est limité par le CPU ou du I/O bloquant qui peut s'exécuter sur le pool de threads libuv.
- Le travail est du I/O asynchrone qui peut s'exécuter sur le runtime Tokio (par ex., exécution shell).

Évitez les portages qui dépendent d'un état uniquement JS ou d'imports dynamiques. Les exports N-API doivent être purs, données en entrée/données en sortie. Le travail de longue durée doit passer par `task::blocking` (limité par le CPU/I/O bloquant) ou `task::future` (I/O asynchrone) avec annulation.

## Anatomie d'un export natif

**Côté Rust :**

- L'implémentation se trouve dans `crates/pi-natives/src/<module>.rs`. Si vous ajoutez un nouveau module, enregistrez-le dans `crates/pi-natives/src/lib.rs`.
- Exportez avec `#[napi]` ; les exports en snake_case sont convertis automatiquement en camelCase. Utilisez `js_name` explicite uniquement pour les vrais alias/noms non par défaut. Utilisez `#[napi(object)]` pour les structs.
- Utilisez `task::blocking(tag, cancel_token, work)` (voir `crates/pi-natives/src/task.rs`) pour le travail limité par le CPU ou bloquant. Utilisez `task::future(env, tag, work)` pour le travail asynchrone nécessitant Tokio (par ex., sessions shell). Passez un `CancelToken` lorsque vous exposez `timeoutMs` ou `AbortSignal`.

**Côté JS :**

- `packages/natives/src/bindings.ts` contient l'interface de base `NativeBindings`.
- `packages/natives/src/<module>/types.ts` définit les types TS et augmente `NativeBindings` via la fusion de déclarations.
- `packages/natives/src/native.ts` importe chaque fichier `<module>/types.ts` pour activer les déclarations.
- `packages/natives/src/<module>/index.ts` encapsule le binding `native` depuis `packages/natives/src/native.ts`.
- `packages/natives/src/native.ts` charge l'addon et `validateNative` vérifie les exports requis.
- `packages/natives/src/index.ts` réexporte le wrapper pour les appelants dans `packages/*`.

## Liste de contrôle du portage

1. **Ajouter l'implémentation Rust**

- Placez la logique principale dans une fonction Rust simple.
- S'il s'agit d'un nouveau module, ajoutez-le à `crates/pi-natives/src/lib.rs`.
- Exposez-le avec `#[napi]` pour que le mapping par défaut snake_case -> camelCase reste cohérent.
- Gardez les signatures possédées et simples : `String`, `Vec<String>`, `Uint8Array`, ou `Either<JsString, Uint8Array>` pour les entrées volumineuses de chaînes/octets.
- Pour le travail limité par le CPU ou bloquant, utilisez `task::blocking` ; pour le travail asynchrone, utilisez `task::future`. Passez un `CancelToken` et appelez `heartbeat()` à l'intérieur des boucles longues.

2. **Connecter les bindings JS**

- Ajoutez les types et l'augmentation `NativeBindings` dans `packages/natives/src/<module>/types.ts`.
- Importez `./<module>/types` dans `packages/natives/src/native.ts` pour déclencher la fusion de déclarations.
- Ajoutez un wrapper dans `packages/natives/src/<module>/index.ts` qui appelle `native`.
- Réexportez depuis `packages/natives/src/index.ts`.

3. **Mettre à jour la validation native**

- Ajoutez `checkFn("newExport")` dans `validateNative` (`packages/natives/src/native.ts`).

4. **Ajouter des benchmarks**

- Placez les benchmarks à côté du package propriétaire (`packages/tui/bench`, `packages/natives/bench`, ou `packages/coding-agent/bench`).
- Incluez une référence JS et une version native dans la même exécution.
- Utilisez `Bun.nanoseconds()` et un nombre d'itérations fixe.
- Gardez les entrées du benchmark petites et réalistes (données réelles observées dans le chemin critique).

5. **Compiler le binaire natif**

- `bun --cwd=packages/natives run build`
- Utilisez `bun --cwd=packages/natives run build` et définissez `PI_DEV=1` si vous souhaitez des diagnostics du loader pendant les tests.

6. **Exécuter le benchmark**

- `bun run packages/<pkg>/bench/<bench>.ts` (ou `bun --cwd=packages/natives run bench`)

7. **Décider de l'utilisation**

- Si le natif est plus lent, **gardez JS** et laissez l'export natif inutilisé.
- Si le natif est plus rapide, basculez les sites d'appel vers le wrapper natif.

## Points de friction et comment les éviter

### 1) Un `pi_natives.node` obsolète empêche les nouveaux exports

Le loader préfère le binaire taggé par plateforme dans `packages/natives/native` (`pi_natives.<platform>-<arch>.node`). `PI_DEV=1` n'active désormais que les diagnostics du loader ; il ne bascule plus vers un nom de fichier d'addon dev séparé. Il existe également un fallback `pi_natives.node`. Les binaires compilés s'extraient vers `~/.xcsh/natives/<version>/pi_natives.<platform>-<arch>.node`. Si l'un d'entre eux est obsolète, les exports ne se mettront pas à jour.

**Correctif :** supprimez le fichier obsolète avant de reconstruire.

```bash
rm packages/natives/native/pi_natives.linux-x64.node
rm packages/natives/native/pi_natives.node
bun --cwd=packages/natives run build
```

Si vous exécutez un binaire compilé, supprimez le répertoire d'addon en cache :

```bash
rm -rf ~/.xcsh/natives/<version>
```

Puis vérifiez que l'export existe dans le binaire :

```bash
bun -e 'const tag = `${process.platform}-${process.arch}`; const mod = require(`./packages/natives/native/pi_natives.${tag}.node`); console.log(Object.keys(mod).includes("newExport"));'
```

### 2) Erreurs "Missing exports" de `validateNative`

C'est **positif** — cela empêche les incohérences silencieuses. Lorsque vous voyez ceci :

```
Native addon missing exports ... Missing: visibleWidth
```

cela signifie que votre binaire est obsolète, que le nom de l'export Rust (ou l'alias explicite lorsqu'il est utilisé) ne correspond pas au nom JS, ou que l'export n'a jamais été compilé. Corrigez le build et l'incohérence de nommage, n'affaiblissez pas la validation.

### 3) Incompatibilité de signature Rust

Gardez-la simple et possédée. `String`, `Vec<String>`, et `Uint8Array` fonctionnent. Évitez les références comme `&str` dans les exports publics. Si vous avez besoin de données structurées, encapsulez-les dans des structs `#[napi(object)]`.

### 4) Erreurs de benchmarking

- Ne comparez pas des entrées ou allocations différentes.
- Gardez JS et natif utilisant des tableaux d'entrée identiques.
- Exécutez les deux dans le même fichier de benchmark pour éviter le biais.

## Modèle de benchmark

```ts
const ITERATIONS = 2000;

function bench(name: string, fn: () => void): number {
 const start = Bun.nanoseconds();
 for (let i = 0; i < ITERATIONS; i++) fn();
 const elapsed = (Bun.nanoseconds() - start) / 1e6;
 console.log(`${name}: ${elapsed.toFixed(2)}ms total (${(elapsed / ITERATIONS).toFixed(6)}ms/op)`);
 return elapsed;
}

bench("feature/js", () => {
 jsImpl(sample);
});

bench("feature/native", () => {
 nativeImpl(sample);
});
```

## Liste de contrôle de vérification

- `validateNative` passe (aucun export manquant).
- `NativeBindings` est augmenté dans `packages/natives/src/<module>/types.ts` et le wrapper est réexporté dans `packages/natives/src/index.ts`.
- `Object.keys(require(...))` inclut votre nouvel export.
- Les chiffres de benchmark sont enregistrés dans la PR/notes.
- Le site d'appel est mis à jour **uniquement si** le natif est plus rapide ou équivalent.

## Règle générale

- Si le natif est plus lent, **ne basculez pas**. Gardez l'export pour un travail futur, mais le TUI doit rester sur le chemin le plus rapide.
- Si le natif est plus rapide, basculez le site d'appel et gardez le benchmark en place pour détecter les régressions.
