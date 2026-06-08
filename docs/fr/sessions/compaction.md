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

La compaction et les résumés de branches sont les deux mécanismes qui maintiennent les sessions longues utilisables sans perdre le contexte de travail antérieur.

- **Compaction** réécrit l'historique ancien en un résumé sur la branche courante.
- **Résumé de branche** capture le contexte des branches abandonnées lors de la navigation `/tree`.

Les deux sont persistés en tant qu'entrées de session et reconvertis en messages de contexte utilisateur lors de la reconstruction de l'entrée LLM.

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

La compaction et les résumés de branches sont des entrées de session de première classe, pas de simples messages assistant/utilisateur.

- `CompactionEntry`
  - `type: "compaction"`
  - `summary`, optionnel `shortSummary`
  - `firstKeptEntryId` (frontière de compaction)
  - `tokensBefore`
  - optionnel `details`, `preserveData`, `fromExtension`
- `BranchSummaryEntry`
  - `type: "branch_summary"`
  - `fromId`, `summary`
  - optionnel `details`, `fromExtension`

Lors de la reconstruction du contexte (`buildSessionContext`) :

1. La dernière compaction sur le chemin actif est convertie en un message `compactionSummary`.
2. Les entrées conservées de `firstKeptEntryId` jusqu'au point de compaction sont réincluses.
3. Les entrées suivantes sur le chemin sont ajoutées.
4. Les entrées `branch_summary` sont converties en messages `branchSummary`.
5. Les entrées `custom_message` sont converties en messages `custom`.

Ces rôles personnalisés sont ensuite transformés en messages utilisateur destinés au LLM dans `convertToLlm()` en utilisant les templates statiques :

- `prompts/compaction/compaction-summary-context.md`
- `prompts/compaction/branch-summary-context.md`

## Pipeline de compaction

### Déclencheurs

La compaction peut s'exécuter de trois manières :

1. **Manuelle** : `/compact [instructions]` appelle `AgentSession.compact(...)`.
2. **Récupération automatique de dépassement** : après une erreur assistant correspondant à un dépassement de contexte.
3. **Compaction automatique par seuil** : après un tour réussi lorsque le contexte dépasse le seuil.

### Forme de la compaction (visuelle)

```text
Avant la compaction :

  entry:  0     1     2     3      4     5     6      7      8     9
        ┌─────┬─────┬─────┬──────┬─────┬─────┬──────┬──────┬─────┬──────┐
        │ hdr │ usr │ ass │ tool │ usr │ ass │ tool │ tool │ ass │ tool │
        └─────┴─────┴─────┴──────┴─────┴─────┴──────┴──────┴─────┴──────┘
                └────────┬───────┘ └──────────────┬──────────────┘
               messagesToSummarize            kept messages
                                   ↑
                          firstKeptEntryId (entry 4)

Après la compaction (nouvelle entrée ajoutée) :

  entry:  0     1     2     3      4     5     6      7      8     9      10
        ┌─────┬─────┬─────┬──────┬─────┬─────┬──────┬──────┬─────┬──────┬─────┐
        │ hdr │ usr │ ass │ tool │ usr │ ass │ tool │ tool │ ass │ tool │ cmp │
        └─────┴─────┴─────┴──────┴─────┴─────┴──────┴──────┴─────┴──────┴─────┘
               └──────────┬──────┘ └──────────────────────┬───────────────────┘
                 not sent to LLM                    sent to LLM
                                                         ↑
                                              starts from firstKeptEntryId

Ce que le LLM voit :

  ┌────────┬─────────┬─────┬─────┬──────┬──────┬─────┬──────┐
  │ system │ summary │ usr │ ass │ tool │ tool │ ass │ tool │
  └────────┴─────────┴─────┴─────┴──────┴──────┴─────┴──────┘
       ↑         ↑      └─────────────────┬────────────────┘
    prompt   from cmp          messages from firstKeptEntryId
```

### Compaction de récupération de dépassement vs compaction par seuil

Les deux chemins automatiques sont intentionnellement différents :

- **Compaction de récupération de dépassement**
  - Déclencheur : une erreur assistant du modèle courant est détectée comme dépassement de contexte.
  - Le message d'erreur assistant échoué est retiré de l'état actif de l'agent avant la nouvelle tentative.
  - La compaction automatique s'exécute avec `reason: "overflow"` et `willRetry: true`.
  - En cas de succès, l'agent continue automatiquement (`agent.continue()`) après la compaction.

- **Compaction par seuil**
  - Déclencheur : `contextTokens > contextWindow - compaction.reserveTokens`.
  - S'exécute avec `reason: "threshold"` et `willRetry: false`.
  - En cas de succès, si `compaction.autoContinue !== false`, injecte un prompt synthétique :
    - `"Continue if you have next steps."`

### Élagage pré-compaction

Avant les vérifications de compaction, l'élagage des résultats d'outils peut s'exécuter (`pruneToolOutputs`).

Politique d'élagage par défaut :

- Protéger les `40_000` tokens de résultats d'outils les plus récents.
- Exiger au moins `20_000` tokens d'économies estimées totales.
- Ne jamais élaguer les résultats d'outils provenant de `skill` ou `read`.

Les résultats d'outils élagués sont remplacés par :

- `[Output truncated - N tokens]`

Si l'élagage modifie des entrées, le stockage de session est réécrit et l'état des messages de l'agent est actualisé avant les décisions de compaction.

### Logique de frontière et de point de coupure

`prepareCompaction()` ne considère que les entrées depuis la dernière entrée de compaction (le cas échéant).

1. Trouver l'index de la compaction précédente.
2. Calculer `boundaryStart = prevCompactionIndex + 1`.
3. Adapter `keepRecentTokens` en utilisant le ratio d'utilisation mesuré lorsqu'il est disponible.
4. Exécuter `findCutPoint()` sur la fenêtre de frontière.

Les points de coupure valides incluent :

- les entrées de message avec les rôles : `user`, `assistant`, `bashExecution`, `hookMessage`, `branchSummary`, `compactionSummary`
- les entrées `custom_message`
- les entrées `branch_summary`

Règle stricte : ne jamais couper sur `toolResult`.

S'il y a des entrées de métadonnées non-message juste avant le point de coupure (`model_change`, `thinking_level_change`, labels, etc.), elles sont intégrées dans la région conservée en déplaçant l'index de coupure vers l'arrière jusqu'à atteindre un message ou une frontière de compaction.

### Gestion des tours fractionnés

Si le point de coupure n'est pas au début d'un tour utilisateur, la compaction le traite comme un tour fractionné.

La détection de début de tour considère ces éléments comme des frontières de tour utilisateur :

- `message.role === "user"`
- `message.role === "bashExecution"`
- entrée `custom_message`
- entrée `branch_summary`

La compaction de tour fractionné génère deux résumés :

1. Résumé de l'historique (`messagesToSummarize`)
2. Résumé du préfixe de tour (`turnPrefixMessages`)

Le résumé final stocké est fusionné ainsi :

```markdown
<history summary>

---

**Turn Context (split turn):**

<turn prefix summary>
```

### Génération du résumé

`compact(...)` construit les résumés à partir de texte de conversation sérialisé :

1. Convertir les messages via `convertToLlm()`.
2. Sérialiser avec `serializeConversation()`.
3. Encapsuler dans `<conversation>...</conversation>`.
4. Optionnellement inclure `<previous-summary>...</previous-summary>`.
5. Optionnellement injecter le contexte du hook en tant que liste `<additional-context>`.
6. Exécuter le prompt de résumé avec `SUMMARIZATION_SYSTEM_PROMPT`.

Sélection du prompt :

- première compaction : `compaction-summary.md`
- compaction itérative avec résumé antérieur : `compaction-update-summary.md`
- seconde passe de tour fractionné : `compaction-turn-prefix.md`
- résumé court pour l'interface : `compaction-short-summary.md`

Mode de résumé distant :

- Si `compaction.remoteEndpoint` est défini, la compaction envoie un POST :
  - `{ systemPrompt, prompt }`
- Attend un JSON contenant au moins `{ summary }`.

### Contexte des opérations de fichiers dans les résumés

La compaction suit l'activité cumulative des fichiers via les appels d'outils de l'assistant :

- `read(path)` → ensemble de lecture
- `write(path)` → ensemble de modification
- `edit(path)` → ensemble de modification

Comportement cumulatif :

- Inclut les détails de compaction antérieure uniquement lorsque l'entrée précédente est générée par pi (`fromExtension !== true`).
- Dans les tours fractionnés, inclut également les opérations de fichiers du préfixe de tour.
- `readFiles` exclut les fichiers également modifiés.

Le texte du résumé reçoit des balises de fichiers ajoutées via le template de prompt :

```xml
<read-files>
...
</read-files>
<modified-files>
...
</modified-files>
```

### Persistance et rechargement

Après la génération du résumé (ou le résumé fourni par le hook), la session de l'agent :

1. Ajoute une `CompactionEntry` avec `appendCompaction(...)`.
2. Reconstruit le contexte via `buildSessionContext()`.
3. Remplace les messages actifs de l'agent par le contexte reconstruit.
4. Émet l'événement de hook `session_compact`.

## Pipeline de résumé de branche

Le résumé de branche est lié à la navigation dans l'arbre, pas au dépassement de tokens.

### Déclencheur

Pendant `navigateTree(...)` :

1. Calculer les entrées abandonnées de l'ancienne feuille jusqu'à l'ancêtre commun en utilisant `collectEntriesForBranchSummary(...)`.
2. Si l'appelant a demandé un résumé (`options.summarize`), générer le résumé avant de changer de feuille.
3. Si un résumé existe, l'attacher à la cible de navigation en utilisant `branchWithSummary(...)`.

Opérationnellement, ceci est généralement piloté par le flux `/tree` lorsque `branchSummary.enabled` est activé.

### Forme du changement de branche (visuelle)

```text
Arbre avant la navigation :

         ┌─ B ─ C ─ D (old leaf, being abandoned)
    A ───┤
         └─ E ─ F (target)

Common ancestor: A
Entries to summarize: B, C, D

Après la navigation avec résumé :

         ┌─ B ─ C ─ D ─ [summary of B,C,D]
    A ───┤
         └─ E ─ F (new leaf)
```

### Préparation et budget de tokens

`generateBranchSummary(...)` calcule le budget ainsi :

- `tokenBudget = model.contextWindow - branchSummary.reserveTokens`

`prepareBranchEntries(...)` ensuite :

1. Première passe : collecter les opérations de fichiers cumulatives de toutes les entrées résumées, y compris les détails de `branch_summary` générés par pi antérieurs.
2. Seconde passe : parcourir du plus récent au plus ancien, en ajoutant des messages jusqu'à ce que le budget de tokens soit atteint.
3. Privilégier la préservation du contexte récent.
4. Peut encore inclure de grandes entrées de résumé proches de la limite du budget pour la continuité.

Les entrées de compaction sont incluses comme messages (`compactionSummary`) lors de l'entrée de résumé de branche.

### Génération du résumé et persistance

Le résumé de branche :

1. Convertit et sérialise les messages sélectionnés.
2. Encapsule dans `<conversation>`.
3. Utilise des instructions personnalisées si fournies, sinon `branch-summary.md`.
4. Appelle le modèle de résumé avec `SUMMARIZATION_SYSTEM_PROMPT`.
5. Préfixe avec `branch-summary-preamble.md`.
6. Ajoute les balises d'opérations de fichiers.

Le résultat est stocké en tant que `BranchSummaryEntry` avec des détails optionnels (`readFiles`, `modifiedFiles`).

## Points d'extension et hooks

### `session_before_compact`

Hook de pré-compaction.

Peut :

- annuler la compaction (`{ cancel: true }`)
- fournir une charge utile de compaction personnalisée complète (`{ compaction: CompactionResult }`)

### `session.compacting`

Hook de personnalisation du prompt/contexte pour la compaction par défaut.

Peut retourner :

- `prompt` (remplacer le prompt de résumé de base)
- `context` (lignes de contexte supplémentaires injectées dans `<additional-context>`)
- `preserveData` (stocké sur l'entrée de compaction)

### `session_compact`

Notification post-compaction avec la `compactionEntry` sauvegardée et le drapeau `fromExtension`.

### `session_before_tree`

S'exécute lors de la navigation dans l'arbre avant la génération du résumé de branche par défaut.

Peut :

- annuler la navigation
- fournir un `{ summary: { summary, details } }` personnalisé utilisé lorsque l'utilisateur a demandé un résumé

### `session_tree`

Événement post-navigation exposant la nouvelle/ancienne feuille et l'entrée de résumé optionnelle.

## Comportement à l'exécution et sémantique des erreurs

- La compaction manuelle interrompt d'abord l'opération d'agent en cours.
- `abortCompaction()` annule les contrôleurs de compaction manuelle et automatique.
- La compaction automatique émet des événements de session de début/fin pour les mises à jour de l'interface/état.
- La compaction automatique peut essayer plusieurs modèles candidats et réessayer les erreurs transitoires.
- Les erreurs de dépassement sont exclues du chemin de réessai générique car elles sont gérées par la compaction.
- Si la compaction automatique échoue :
  - le chemin de dépassement émet `Context overflow recovery failed: ...`
  - le chemin de seuil émet `Auto-compaction failed: ...`
- Le résumé de branche peut être annulé via un signal d'abandon (par exemple, Échap), retournant un résultat de navigation annulé/abandonné.

## Paramètres et valeurs par défaut

Depuis `settings-schema.ts` :

- `compaction.enabled` = `true`
- `compaction.reserveTokens` = `16384`
- `compaction.keepRecentTokens` = `20000`
- `compaction.autoContinue` = `true`
- `compaction.remoteEndpoint` = `undefined`
- `branchSummary.enabled` = `false`
- `branchSummary.reserveTokens` = `16384`

Ces valeurs sont consommées à l'exécution par `AgentSession` et les modules de compaction/résumé de branche.
