---
title: Environnement d'exécution de l'outil Bash
description: >-
  Environnement d'exécution de l'outil Bash avec gestion des processus shell,
  sandboxing, délai d'expiration et diffusion de la sortie.
sidebar:
  order: 1
  label: Outil Bash
i18n:
  sourceHash: 18b12aa5dbd5
  translator: machine
---

# Environnement d'exécution de l'outil Bash

Ce document décrit le chemin d'exécution de l'**outil `bash`** utilisé par les appels d'outils de l'agent, depuis la normalisation des commandes jusqu'à l'exécution, la troncature/les artefacts et le rendu.

Il indique également les points où le comportement diverge en mode TUI interactif, mode impression, mode RPC et exécution shell bang (`!`) initiée par l'utilisateur.

## Périmètre et surfaces d'exécution

Il existe deux surfaces d'exécution bash différentes dans l'agent de codage :

1. **Surface d'appel d'outil** (`toolName: "bash"`) : utilisée lorsque le modèle appelle l'outil bash.
   - Point d'entrée : `BashTool.execute()`.
2. **Surface de commande bang utilisateur** (`!cmd` depuis l'entrée interactive ou la commande RPC `bash`) : chemin auxiliaire au niveau de la session.
   - Point d'entrée : `AgentSession.executeBash()`.

Les deux utilisent finalement `executeBash()` dans `src/exec/bash-executor.ts` pour l'exécution non-PTY, mais seul le chemin d'appel d'outil exécute la logique de normalisation/interception et de rendu de l'outil.

## Pipeline d'appel d'outil de bout en bout

## 1) Normalisation des entrées et fusion des paramètres

`BashTool.execute()` normalise d'abord la commande brute via `normalizeBashCommand()` :

- extrait les suffixes `| head -n N`, `| head -N`, `| tail -n N`, `| tail -N` en limites structurées,
- supprime les espaces blancs en fin et en début de chaîne,
- conserve les espaces blancs internes intacts.

Puis il fusionne les limites extraites avec les arguments explicites de l'outil :

- les arguments `head`/`tail` explicites remplacent les valeurs extraites,
- les valeurs extraites ne servent que de repli.

### Mise en garde

Les commentaires de `bash-normalize.ts` mentionnent la suppression de `2>&1`, mais l'implémentation actuelle ne le supprime pas. Le comportement à l'exécution reste correct (stdout/stderr sont déjà fusionnés), mais le comportement de normalisation est plus restreint que ce que suggèrent les commentaires.

## 2) Interception optionnelle (chemin de commande bloquée)

Si `bashInterceptor.enabled` est vrai, `BashTool` charge les règles depuis les paramètres et exécute `checkBashInterception()` sur la commande normalisée.

Comportement d'interception :

- la commande est bloquée **uniquement** lorsque :
  - une règle regex correspond, et
  - l'outil suggéré est présent dans `ctx.toolNames`.
- les règles regex invalides sont silencieusement ignorées.
- en cas de blocage, `BashTool` lève une `ToolError` avec le message :
  - `Blocked: ...`
  - la commande originale est incluse.

Les patterns de règles par défaut (définis dans le code) ciblent les utilisations abusives courantes :

- lecteurs de fichiers (`cat`, `head`, `tail`, ...)
- outils de recherche (`grep`, `rg`, ...)
- chercheurs de fichiers (`find`, `fd`, ...)
- éditeurs en place (`sed -i`, `perl -i`, `awk -i inplace`)
- écritures par redirection shell (`echo ... > file`, redirection heredoc)

### Mise en garde

`InterceptionResult` inclut `suggestedTool`, mais `BashTool` ne présente actuellement que le texte du message (aucun champ d'outil suggéré structuré dans `details`).

## 3) Validation du CWD et limitation du délai d'expiration

`cwd` est résolu relativement au cwd de la session (`resolveToCwd`), puis validé via `stat` :

- chemin manquant -> `ToolError("Working directory does not exist: ...")`
- non-répertoire -> `ToolError("Working directory is not a directory: ...")`

Le délai d'expiration est limité à `[1, 3600]` secondes et converti en millisecondes.

## 4) Allocation des artefacts

Avant l'exécution, l'outil alloue un chemin/identifiant d'artefact (au mieux) pour le stockage des sorties tronquées.

- l'échec d'allocation d'artefact n'est pas fatal (l'exécution continue sans fichier de débordement d'artefact),
- l'identifiant/chemin d'artefact est transmis au chemin d'exécution pour la persistance de la sortie complète en cas de troncature.

## 5) Sélection de l'exécution PTY ou non-PTY

`BashTool` choisit l'exécution PTY uniquement lorsque toutes les conditions suivantes sont vraies :

- `bash.virtualTerminal === "on"`
- `PI_NO_PTY !== "1"`
- le contexte de l'outil dispose d'une interface utilisateur (`ctx.hasUI === true` et `ctx.ui` défini)

Sinon, il utilise `executeBash()` non interactif.

Cela signifie que le mode impression et les contextes RPC/outil sans interface utilisateur utilisent toujours le mode non-PTY.

## Moteur d'exécution non interactif (`executeBash`)

## Modèle de réutilisation de session shell

`executeBash()` met en cache les instances `Shell` natives dans une table de correspondance globale au processus, indexée par :

- chemin du shell,
- préfixe de commande configuré,
- chemin d'instantané,
- environnement shell sérialisé,
- clé de session d'agent optionnelle.

Pour les exécutions au niveau de la session, `AgentSession.executeBash()` transmet `sessionKey: this.sessionId`, isolant la réutilisation par session.

Le chemin d'appel d'outil ne transmet **pas** `sessionKey`, donc la portée de réutilisation est basée sur la configuration du shell/l'instantané/l'environnement.

## Configuration du shell et comportement des instantanés

À chaque appel, l'exécuteur charge la configuration du shell depuis les paramètres (`shell`, `env`, `prefix` optionnel).

Si le shell sélectionné inclut `bash`, il tente `getOrCreateSnapshot()` :

- l'instantané capture les alias/fonctions/options depuis le rc utilisateur,
- la création de l'instantané est au mieux,
- un échec revient à l'absence d'instantané.

Si `prefix` est configuré, la commande devient :

```text
<prefix> <command>
```

## Diffusion en continu et annulation

`Shell.run()` diffuse les fragments vers un callback. L'exécuteur achemine chaque fragment vers `OutputSink` et le callback `onChunk` optionnel.

Annulation :

- le signal d'abandon déclenche `shellSession.abort(...)`,
- le délai d'expiration issu du résultat natif est mappé vers `cancelled: true` + texte d'annotation,
- l'annulation explicite renvoie de même `cancelled: true` + annotation.

Aucune exception n'est levée dans l'exécuteur en cas de délai d'expiration/annulation ; il renvoie un `BashResult` structuré et laisse l'appelant gérer la sémantique des erreurs.

## Chemin PTY interactif (`runInteractiveBashPty`)

Lorsque le PTY est activé, l'outil exécute `runInteractiveBashPty()` qui ouvre un composant de console en superposition et pilote une `PtySession` native.

Points notables du comportement :

- le terminal virtuel xterm-headless affiche la fenêtre dans la superposition,
- la saisie clavier est normalisée (y compris les séquences Kitty et la gestion du mode curseur applicatif),
- `esc` pendant l'exécution tue la session PTY,
- le redimensionnement du terminal se propage au PTY (`session.resize(cols, rows)`).

Les paramètres par défaut de durcissement de l'environnement sont injectés pour les exécutions sans surveillance :

- paginateurs désactivés (`PAGER=cat`, `GIT_PAGER=cat`, etc.),
- invites d'éditeur désactivées (`GIT_EDITOR=true`, `EDITOR=true`, ...),
- invites de terminal/authentification réduites (`GIT_TERMINAL_PROMPT=0`, `SSH_ASKPASS=/usr/bin/false`, `CI=1`),
- indicateurs d'automatisation des gestionnaires de paquets/outils pour le comportement non interactif.

La sortie PTY est normalisée (`CRLF`/`CR` vers `LF`, `sanitizeText`) et écrite dans `OutputSink`, avec prise en charge du débordement vers artefact.

En cas d'erreur au démarrage/exécution du PTY, le sink reçoit une ligne `PTY error: ...` et la commande se termine avec un code de sortie indéfini.

## Gestion de la sortie : diffusion en continu, troncature, débordement vers artefact

Les chemins PTY et non-PTY utilisent tous les deux `OutputSink`.

## Sémantique d'OutputSink

- conserve un tampon de queue en mémoire encodé en UTF-8 (`DEFAULT_MAX_BYTES`, actuellement 50 Ko),
- suit le nombre total d'octets/lignes observés,
- si un chemin d'artefact existe et que la sortie déborde (ou que le fichier est déjà actif), écrit le flux complet dans le fichier d'artefact,
- lorsque le seuil mémoire est dépassé, réduit le tampon en mémoire à la queue (avec respect des frontières UTF-8),
- marque `truncated` en cas de débordement/débordement vers fichier.

`dump()` renvoie :

- `output` (avec éventuel préfixe annoté),
- `truncated`,
- `totalLines/totalBytes`,
- `outputLines/outputBytes`,
- `artifactId` si le fichier d'artefact était actif.

### Mise en garde sur les sorties longues

La troncature à l'exécution est basée sur un seuil en octets dans `OutputSink` (50 Ko par défaut). Elle n'impose pas de limite stricte de 2000 lignes dans ce chemin de code.

## Mises à jour d'outil en direct

Pour l'exécution non-PTY, `BashTool` utilise un `TailBuffer` séparé pour les mises à jour partielles et émet des instantanés `onUpdate` pendant l'exécution de la commande.

Pour l'exécution PTY, le rendu en direct est géré par la superposition d'interface utilisateur personnalisée, et non par les fragments de texte `onUpdate`.

## Mise en forme du résultat, métadonnées et mappage des erreurs

Après l'exécution :

1. Gestion de `cancelled` :
   - si le signal d'abandon est déclenché -> lève `ToolAbortError` (sémantique d'abandon),
   - sinon -> lève `ToolError` (traité comme un échec de l'outil).
2. PTY `timedOut` -> lève `ToolError`.
3. applique les filtres head/tail au texte de sortie final (`applyHeadTail`, head puis tail).
4. une sortie vide devient `(no output)`.
5. attache les métadonnées de troncature via `toolResult(...).truncationFromSummary(result, { direction: "tail" })`.
6. mappage du code de sortie :
   - code de sortie manquant -> `ToolError("... missing exit status")`
   - sortie non nulle -> `ToolError("... Command exited with code N")`
   - sortie nulle -> résultat de succès.

Structure de la charge utile de succès :

- `content` : texte de sortie,
- `details.meta.truncation` en cas de troncature, incluant :
  - `direction`, `truncatedBy`, nombre total/sorti de lignes+octets,
  - `shownRange`,
  - `artifactId` lorsque disponible.

Étant donné que les outils intégrés sont enveloppés avec `wrapToolWithMetaNotice()`, le texte de notification de troncature est automatiquement ajouté au contenu texte final (par exemple : `Full: artifact://<id>`).

## Chemins de rendu

## Rendu des appels d'outil (`bashToolRenderer`)

`bashToolRenderer` est utilisé pour les messages d'appel d'outil (`toolCall` / `toolResult`) :

- le mode réduit affiche un aperçu tronqué au nombre de lignes visuelles,
- le mode développé affiche tout le texte de sortie actuellement disponible,
- la ligne d'avertissement indique la raison de la troncature et `artifact://<id>` en cas de troncature,
- la valeur du délai d'expiration (issue des arguments) est affichée dans la ligne de métadonnées du pied de page.

### Mise en garde : expansion complète des artefacts

`BashRenderContext` dispose de `isFullOutput`, mais le constructeur de contexte de rendu actuel ne le définit pas pour les résultats de l'outil bash. La vue développée utilise toujours le texte déjà présent dans le contenu du résultat (sortie de queue/tronquée), sauf si un autre appelant fournit le contenu complet de l'artefact.

## Composant de commande bang utilisateur (`BashExecutionComponent`)

`BashExecutionComponent` est destiné aux commandes `!` utilisateur en mode interactif (pas aux appels d'outils du modèle) :

- diffuse les fragments en direct,
- l'aperçu réduit conserve les 20 dernières lignes logiques,
- limite à 4000 caractères par ligne,
- affiche les avertissements de troncature et d'artefact lorsque les métadonnées sont présentes,
- marque séparément l'état annulé/erreur/sortie.

Ce composant est câblé par `CommandController.handleBashCommand()` et alimenté par `AgentSession.executeBash()`.

## Différences de comportement selon le mode

| Surface                              | Chemin d'entrée                                       | Éligible PTY                                                              | Interface de sortie en direct                                                    | Remontée des erreurs                                        |
| ------------------------------------ | ----------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Appel d'outil interactif             | `BashTool.execute`                                    | Oui, lorsque `bash.virtualTerminal=on` et interface utilisateur présente et `PI_NO_PTY!=1` | Superposition PTY (interactif) ou mises à jour de queue en flux continu          | Les erreurs d'outil deviennent `toolResult.isError`         |
| Appel d'outil en mode impression     | `BashTool.execute`                                    | Non (pas de contexte d'interface utilisateur)                             | Pas de superposition TUI ; la sortie apparaît dans le flux d'événements/texte final de l'assistant | Même mappage d'erreur d'outil                               |
| Appel d'outil RPC (outillage agent)  | `BashTool.execute`                                    | Généralement pas d'interface utilisateur -> non-PTY                       | Événements/résultats d'outil structurés                                          | Même mappage d'erreur d'outil                               |
| Commande bang interactive (`!`)      | `AgentSession.executeBash` + `BashExecutionComponent` | Non (utilise l'exécuteur directement)                                     | Composant d'exécution bash dédié                                                 | Le contrôleur intercepte les exceptions et affiche l'erreur dans l'interface |
| Commande RPC `bash`                  | `rpc-mode` -> `session.executeBash`                   | Non                                                                       | Renvoie `BashResult` directement                                                 | Le consommateur gère les champs renvoyés                    |

## Mises en garde opérationnelles

- L'intercepteur bloque uniquement les commandes lorsque l'outil suggéré est actuellement disponible dans le contexte.
- Si l'allocation d'artefact échoue, la troncature se produit quand même, mais aucune référence arrière `artifact://` n'est disponible.
- Le cache de sessions shell n'a pas d'éviction explicite dans ce module ; la durée de vie est limitée au processus.
- Les surfaces de délai d'expiration PTY et non-PTY diffèrent :
  - le PTY expose un champ de résultat explicite `timedOut`,
  - le non-PTY mappe le délai d'expiration vers un résumé `cancelled + annotation`.

## Fichiers d'implémentation

- [`src/tools/bash.ts`](../../packages/coding-agent/src/tools/bash.ts) — point d'entrée de l'outil, normalisation/interception, sélection PTY/non-PTY, mappage résultat/erreur, rendu de l'outil bash.
- [`src/tools/bash-normalize.ts`](../../packages/coding-agent/src/tools/bash-normalize.ts) — normalisation des commandes et filtrage head/tail post-exécution.
- [`src/tools/bash-interceptor.ts`](../../packages/coding-agent/src/tools/bash-interceptor.ts) — correspondance des règles d'intercepteur et messages de commande bloquée.
- [`src/exec/bash-executor.ts`](../../packages/coding-agent/src/exec/bash-executor.ts) — exécuteur non-PTY, réutilisation de session shell, câblage de l'annulation, intégration du sink de sortie.
- [`src/tools/bash-interactive.ts`](../../packages/coding-agent/src/tools/bash-interactive.ts) — exécution PTY, interface utilisateur en superposition, normalisation des entrées, paramètres d'environnement non interactifs par défaut.
- [`src/session/streaming-output.ts`](../../packages/coding-agent/src/session/streaming-output.ts) — troncature/débordement vers artefact de `OutputSink` et métadonnées de résumé.
- [`src/tools/output-utils.ts`](../../packages/coding-agent/src/tools/output-utils.ts) — auxiliaires d'allocation d'artefacts et tampon de queue en flux continu.
- [`src/tools/output-meta.ts`](../../packages/coding-agent/src/tools/output-meta.ts) — forme des métadonnées de troncature + enveloppe d'injection de notification.
- [`src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — `executeBash` au niveau de la session, enregistrement des messages, cycle de vie des abandons.
- [`src/modes/components/bash-execution.ts`](../../packages/coding-agent/src/modes/components/bash-execution.ts) — composant d'exécution de commande `!` interactif.
- [`src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts) — câblage pour le flux/la complétion des mises à jour de l'interface utilisateur des commandes `!` interactives.
- [`src/modes/rpc/rpc-mode.ts`](../../packages/coding-agent/src/modes/rpc/rpc-mode.ts) — surface de commandes RPC `bash` et `abort_bash`.
- [`src/internal-urls/artifact-protocol.ts`](../../packages/coding-agent/src/internal-urls/artifact-protocol.ts) — résolution de `artifact://<id>`.
