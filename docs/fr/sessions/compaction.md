---
title: Compaction et résumés de branches
description: >-
  Compaction de la fenêtre de contexte et génération de résumés de branches pour
  les sessions de longue durée.
sidebar:
  order: 5
  label: Compaction
i18n:
  sourceHash: dae425a900d8
  translator: machine
---

# Compaction et résumés de branches

La compaction et les résumés de branches sont les deux mécanismes qui permettent de maintenir l'utilisabilité des sessions longues sans perdre le contexte des travaux antérieurs.

- **La compaction** réécrit l'historique ancien en un résumé sur la branche courante.
- **Le résumé de branche** capture le contexte d'une branche abandonnée lors de la navigation avec `/tree`.

Les deux sont persistés en tant qu'entrées de session et reconvertis en messages de contexte utilisateur lors de la reconstruction des entrées LLM.

## Fichiers d'implémentation clés

- `src/session/compaction/compaction.ts`
- `src/session/compaction/branch-summarization.ts`
- `src/session/compaction/pruning.ts`
- `src/session/compaction/utils.ts`
- `src/session/session-manager.ts`
- `src/session/agent-session.ts`
- `src/session/messages.ts`
- `src/extensibility/hooks/types.ts`
- `src/config/settings-schema.ts`

## Modèle d'entrée de session

La compaction et les résumés de branches sont des entrées de session de premier ordre, et non de simples messages assistant/utilisateur.

- `CompactionEntry`
  - `type: "compaction"`
  - `summary`, `shortSummary` optionnel
  - `firstKeptEntryId` (limite de compaction)
  - `tokensBefore`
  - `details`, `preserveData`, `fromExtension` optionnels
- `BranchSummaryEntry`
  - `type: "branch_summary"`
  - `fromId`, `summary`
  - `details`, `fromExtension` optionnels

Lors de la reconstruction du contexte (`buildSessionContext`) :

1. La dernière compaction sur le chemin actif est convertie en un seul message `compactionSummary`.
2. Les entrées conservées depuis `firstKeptEntryId` jusqu'au point de compaction sont réincorporées.
3. Les entrées ultérieures sur le chemin sont ajoutées à la suite.
4. Les entrées `branch_summary` sont converties en messages `branchSummary`.
5. Les entrées `custom_message` sont converties en messages `custom`.

Ces rôles personnalisés sont ensuite transformés en messages utilisateur destinés au LLM dans `convertToLlm()` à l'aide des gabarits statiques :

- `prompts/compaction/compaction-summary-context.md`
- `prompts/compaction/branch-summary-context.md`

## Pipeline de compaction

### Déclencheurs

La compaction peut s'exécuter de trois manières :

1. **Manuelle** : `/compact [instructions]` appelle `AgentSession.compact(...)`.
2. **Récupération automatique en cas de dépassement** : après une erreur assistant correspondant à un dépassement de contexte.
3. **Compaction automatique par seuil** : après un tour réussi lorsque le contexte dépasse le seuil.

### Schéma de compaction (visuel)

```text
Avant compaction :

  entrée: 0     1     2     3      4     5     6      7      8     9
        ┌─────┬─────┬─────┬──────┬─────┬─────┬──────┬──────┬─────┬──────┐
        │ hdr │ usr │ ass │ tool │ usr │ ass │ tool │ tool │ ass │ tool │
        └─────┴─────┴─────┴──────┴─────┴─────┴──────┴──────┴─────┴──────┘
                └────────┬───────┘ └──────────────┬──────────────┘
               messagesToSummarize            messages conservés
                                   ↑
                          firstKeptEntryId (entrée 4)

Après compaction (nouvelle entrée ajoutée) :

  entrée: 0     1     2     3      4     5     6      7      8     9      10
        ┌─────┬─────┬─────┬──────┬─────┬─────┬──────┬──────┬─────┬──────┬─────┐
        │ hdr │ usr │ ass │ tool │ usr │ ass │ tool │ tool │ ass │ tool │ cmp │
        └─────┴─────┴─────┴──────┴─────┴─────┴──────┴──────┴─────┴──────┴─────┘
               └──────────┬──────┘ └──────────────────────┬───────────────────┘
               non envoyé au LLM                    envoyé au LLM
                                                         ↑
                                              commence depuis firstKeptEntryId

Ce que le LLM reçoit :

  ┌────────┬─────────┬─────┬─────┬──────┬──────┬─────┬──────┐
  │ system │ summary │ usr │ ass │ tool │ tool │ ass │ tool │
  └────────┴─────────┴─────┴─────┴──────┴──────┴─────┴──────┘
       ↑         ↑      └─────────────────┬────────────────┘
    prompt   depuis cmp       messages depuis firstKeptEntryId
```

### Compaction par dépassement-relance vs compaction par seuil

Les deux chemins automatiques sont intentionnellement différents :

- **Compaction par dépassement-relance**
  - Déclencheur : l'erreur assistant du modèle courant est détectée comme un dépassement de contexte.
  - Le message d'erreur assistant en échec est supprimé de l'état actif de l'agent avant la relance.
  - La compaction automatique s'exécute avec `reason: "overflow"` et `willRetry: true`.
  - En cas de succès, l'agent continue automatiquement (`agent.continue()`) après la compaction.

- **Compaction par seuil**
  - Déclencheur : `contextTokens > contextWindow - compaction.reserveTokens`.
  - S'exécute avec `reason: "threshold"` et `willRetry: false`.
  - En cas de succès, si `compaction.autoContinue !== false`, injecte une invite synthétique :
    - `"Continue if you have next steps."`

### Élagage avant compaction

Avant les vérifications de compaction, un élagage des résultats d'outils peut s'exécuter (`pruneToolOutputs`).

Politique d'élagage par défaut :

- Protéger les `40 000` tokens de sorties d'outils les plus récents.
- Exiger au moins `20 000` tokens d'économies totales estimées.
- Ne jamais élaguer les résultats d'outils de `skill` ou `read`.

Les résultats d'outils élagués sont remplacés par :

- `[Output truncated - N tokens]`

Si l'élagage modifie des entrées, le stockage de session est réécrit et l'état des messages de l'agent est actualisé avant les décisions de compaction.

### Logique de limite et de point de coupe

`prepareCompaction()` ne considère que les entrées depuis la dernière entrée de compaction (le cas échéant).

1. Trouver l'index de compaction précédent.
2. Calculer `boundaryStart = prevCompactionIndex + 1`.
3. Adapter `keepRecentTokens` en utilisant le ratio d'utilisation mesuré lorsqu'il est disponible.
4. Exécuter `findCutPoint()` sur la fenêtre de limite.

Les points de coupe valides comprennent :

- les entrées de messages avec les rôles : `user`, `assistant`, `bashExecution`, `hookMessage`, `branchSummary`, `compactionSummary`
- les entrées `custom_message`
- les entrées `branch_summary`

Règle absolue : ne jamais couper à `toolResult`.

Si des entrées de métadonnées non-message se trouvent immédiatement avant le point de coupe (`model_change`, `thinking_level_change`, labels, etc.), elles sont intégrées à la région conservée en déplaçant l'index de coupe vers l'arrière jusqu'à atteindre un message ou une limite de compaction.

### Gestion des tours partiels

Si le point de coupe ne se trouve pas au début d'un tour utilisateur, la compaction le traite comme un tour partiel.

La détection du début de tour considère les éléments suivants comme des limites de tour utilisateur :

- `message.role === "user"`
- `message.role === "bashExecution"`
- entrée `custom_message`
- entrée `branch_summary`

La compaction d'un tour partiel génère deux résumés :

1. Résumé de l'historique (`messagesToSummarize`)
2. Résumé du préfixe de tour (`turnPrefixMessages`)

Le résumé final stocké est fusionné comme suit :

```markdown
<history summary>

---

**Turn Context (split turn):**

<turn prefix summary>
```

### Génération du résumé

`compact(...)` construit les résumés à partir du texte de conversation sérialisé :

1. Convertir les messages via `convertToLlm()`.
2. Sérialiser avec `serializeConversation()`.
3. Encapsuler dans `<conversation>...</conversation>`.
4. Inclure optionnellement `<previous-summary>...</previous-summary>`.
5. Injecter optionnellement le contexte de hook comme liste `<additional-context>`.
6. Exécuter l'invite de résumé avec `SUMMARIZATION_SYSTEM_PROMPT`.

Sélection de l'invite :

- première compaction : `compaction-summary.md`
- compaction itérative avec résumé antérieur : `compaction-update-summary.md`
- deuxième passe pour tour partiel : `compaction-turn-prefix.md`
- résumé court pour l'interface : `compaction-short-summary.md`

Mode de résumé distant :

- Si `compaction.remoteEndpoint` est défini, la compaction effectue un POST avec :
  - `{ systemPrompt, prompt }`
- Attend un JSON contenant au moins `{ summary }`.

### Contexte des opérations sur les fichiers dans les résumés

La compaction suit l'activité cumulée sur les fichiers à l'aide des appels d'outils de l'assistant :

- `read(path)` → ensemble de lectures
- `write(path)` → ensemble de modifications
- `edit(path)` → ensemble de modifications

Comportement cumulatif :

- Inclut les détails de la compaction précédente uniquement si l'entrée précédente est générée par pi (`fromExtension !== true`).
- Dans les tours partiels, inclut également les opérations sur les fichiers du préfixe de tour.
- `readFiles` exclut les fichiers également modifiés.

Des balises de fichiers sont ajoutées au texte du résumé via le gabarit d'invite :

```xml
<read-files>
...
</read-files>
<modified-files>
...
</modified-files>
```

### Persistance et rechargement

Après la génération du résumé (ou un résumé fourni par un hook), la session agent :

1. Ajoute `CompactionEntry` avec `appendCompaction(...)`.
2. Reconstruit le contexte via `buildSessionContext()`.
3. Remplace les messages agent actifs par le contexte reconstruit.
4. Émet l'événement de hook `session_compact`.

## Pipeline de résumé de branches

Le résumé de branches est lié à la navigation dans l'arbre, et non au dépassement de tokens.

### Déclencheur

Lors de `navigateTree(...)` :

1. Calculer les entrées abandonnées depuis l'ancienne feuille jusqu'à l'ancêtre commun en utilisant `collectEntriesForBranchSummary(...)`.
2. Si l'appelant a demandé un résumé (`options.summarize`), générer le résumé avant de changer de feuille.
3. Si un résumé existe, l'attacher à la cible de navigation en utilisant `branchWithSummary(...)`.

En pratique, ce mécanisme est généralement déclenché par le flux `/tree` lorsque `branchSummary.enabled` est activé.

### Schéma de changement de branche (visuel)

```text
Arbre avant navigation :

         ┌─ B ─ C ─ D (ancienne feuille, abandonnée)
    A ───┤
         └─ E ─ F (cible)

Ancêtre commun : A
Entrées à résumer : B, C, D

Après navigation avec résumé :

         ┌─ B ─ C ─ D ─ [résumé de B,C,D]
    A ───┤
         └─ E ─ F (nouvelle feuille)
```

### Préparation et budget de tokens

`generateBranchSummary(...)` calcule le budget comme suit :

- `tokenBudget = model.contextWindow - branchSummary.reserveTokens`

`prepareBranchEntries(...)` procède ensuite ainsi :

1. Premier passage : collecter les opérations cumulées sur les fichiers depuis toutes les entrées résumées, y compris les détails `branch_summary` précédents générés par pi.
2. Second passage : parcourir du plus récent au plus ancien, en ajoutant des messages jusqu'à atteindre le budget de tokens.
3. Privilégier la préservation du contexte récent.
4. Peut tout de même inclure de grandes entrées de résumé proches de la limite du budget pour assurer la continuité.

Les entrées de compaction sont incluses en tant que messages (`compactionSummary`) lors de l'entrée du résumé de branche.

### Génération et persistance du résumé

Le résumé de branche :

1. Convertit et sérialise les messages sélectionnés.
2. Encapsule dans `<conversation>`.
3. Utilise des instructions personnalisées si fournies, sinon `branch-summary.md`.
4. Appelle le modèle de résumé avec `SUMMARIZATION_SYSTEM_PROMPT`.
5. Préfixe avec `branch-summary-preamble.md`.
6. Ajoute les balises d'opérations sur les fichiers.

Le résultat est stocké en tant que `BranchSummaryEntry` avec des détails optionnels (`readFiles`, `modifiedFiles`).

## Points d'extension et de hook

### `session_before_compact`

Hook avant compaction.

Peut :

- annuler la compaction (`{ cancel: true }`)
- fournir une charge utile de compaction personnalisée complète (`{ compaction: CompactionResult }`)

### `session.compacting`

Hook de personnalisation de l'invite/contexte pour la compaction par défaut.

Peut retourner :

- `prompt` (remplace l'invite de résumé de base)
- `context` (lignes de contexte supplémentaires injectées dans `<additional-context>`)
- `preserveData` (stocké sur l'entrée de compaction)

### `session_compact`

Notification post-compaction avec `compactionEntry` sauvegardée et indicateur `fromExtension`.

### `session_before_tree`

S'exécute lors de la navigation dans l'arbre avant la génération du résumé de branche par défaut.

Peut :

- annuler la navigation
- fournir un `{ summary: { summary, details } }` personnalisé utilisé lorsque l'utilisateur a demandé un résumé

### `session_tree`

Événement post-navigation exposant la nouvelle/ancienne feuille et l'entrée de résumé optionnelle.

## Comportement d'exécution et sémantique des échecs

- La compaction manuelle abandonne d'abord l'opération agent en cours.
- `abortCompaction()` annule les contrôleurs de compaction manuelle et automatique.
- La compaction automatique émet des événements de session de début/fin pour les mises à jour de l'interface/état.
- La compaction automatique peut essayer plusieurs candidats de modèle et relancer en cas d'échecs transitoires.
- Les erreurs de dépassement sont exclues du chemin de relance générique car elles sont gérées par la compaction.
- En cas d'échec de la compaction automatique :
  - le chemin de dépassement émet `Context overflow recovery failed: ...`
  - le chemin de seuil émet `Auto-compaction failed: ...`
- Le résumé de branche peut être annulé via un signal d'abandon (p. ex. Échap), retournant un résultat de navigation annulé/abandonné.

## Paramètres et valeurs par défaut

Depuis `settings-schema.ts` :

- `compaction.enabled` = `true`
- `compaction.reserveTokens` = `16384`
- `compaction.keepRecentTokens` = `20000`
- `compaction.autoContinue` = `true`
- `compaction.remoteEndpoint` = `undefined`
- `branchSummary.enabled` = `false`
- `branchSummary.reserveTokens` = `16384`

Ces valeurs sont consommées à l'exécution par `AgentSession` et les modules de compaction/résumé de branches.
