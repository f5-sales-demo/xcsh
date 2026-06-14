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

Il indique également où le comportement diverge entre le mode TUI interactif, le mode impression, le mode RPC et l'exécution shell bang (`!`) initiée par l'utilisateur.

## Périmètre et surfaces d'exécution

Il existe deux surfaces d'exécution bash distinctes dans l'agent de codage :

1. **Surface d'appel d'outil** (`toolName: "bash"`) : utilisée lorsque le modèle appelle l'outil bash.
   - Point d'entrée : `BashTool.execute()`.
2. **Surface de commande bang utilisateur** (`!cmd` depuis une entrée interactive ou la commande RPC `bash`) : chemin d'assistance au niveau de la session.
   - Point d'entrée : `AgentSession.executeBash()`.

Les deux utilisent finalement `executeBash()` dans `src/exec/bash-executor.ts` pour l'exécution sans PTY, mais seul le chemin d'appel d'outil exécute la logique de normalisation/interception et de rendu de l'outil.

## Pipeline d'appel d'outil de bout en bout

## 1) Normalisation des entrées et fusion des paramètres

`BashTool.execute()` normalise d'abord la commande brute via `normalizeBashCommand()` :

- extrait les `| head -n N`, `| head -N`, `| tail -n N`, `| tail -N` en fin de chaîne sous forme de limites structurées,
- supprime les espaces blancs en début et en fin de chaîne,
- conserve intacts les espaces blancs internes.

Ensuite, il fusionne les limites extraites avec les arguments explicites de l'outil :

- les arguments `head`/`tail` explicites remplacent les valeurs extraites,
- les valeurs extraites ne servent que de valeurs de repli.

### Mise en garde

Les commentaires de `bash-normalize.ts` mentionnent la suppression de `2>&1`, mais l'implémentation actuelle ne le retire pas. Le comportement à l'exécution reste correct (stdout/stderr sont déjà fusionnés), mais le comportement de normalisation est plus restreint que ce que les commentaires suggèrent.

## 2) Interception optionnelle (chemin de commande bloquée)

Si `bashInterceptor.enabled` est vrai, `BashTool` charge les règles depuis les paramètres et exécute `checkBashInterception()` sur la commande normalisée.

Comportement de l'interception :

- la commande est bloquée **uniquement** lorsque :
  - une règle regex correspond, et
  - l'outil suggéré est présent dans `ctx.toolNames`.
- les règles regex invalides sont silencieusement ignorées.
- lors d'un blocage, `BashTool` lève une `ToolError` avec le message :
  - `Blocked: ...`
  - commande originale incluse.

Les motifs de règles par défaut (définis dans le code) ciblent les utilisations abusives courantes :

- lecteurs de fichiers (`cat`, `head`, `tail`, ...),
- outils de recherche (`grep`, `rg`, ...),
- outils de recherche de fichiers (`find`, `fd`, ...),
- éditeurs sur place (`sed -i`, `perl -i`, `awk -i inplace`),
- redirections d'écriture shell (`echo ... > file`, redirection heredoc).

### Mise en garde

`InterceptionResult` inclut `suggestedTool`, mais `BashTool` ne fait actuellement apparaître que le texte du message (aucun champ d'outil suggéré structuré dans `details`).

## 3) Validation du répertoire de travail et limitation du délai d'expiration

`cwd` est résolu relativement au répertoire de travail de la session (`resolveToCwd`), puis validé via `stat` :

- chemin manquant -> `ToolError("Working directory does not exist: ...")`
- non-répertoire -> `ToolError("Working directory is not a directory: ...")`

Le délai d'expiration est limité à `[1, 3600]` secondes et converti en millisecondes.

## 4) Allocation des artefacts

Avant l'exécution, l'outil alloue un chemin/identifiant d'artefact (au mieux) pour le stockage de la sortie tronquée.

- l'échec d'allocation d'artefact n'est pas fatal (l'exécution continue sans fichier de déversement d'artefact),
- l'identifiant/chemin de l'artefact est transmis au chemin d'exécution pour la persistance complète de la sortie lors d'une troncature.

## 5) Sélection de l'exécution PTY ou non-PTY

`BashTool` choisit l'exécution PTY uniquement lorsque toutes les conditions suivantes sont vraies :

- `bash.virtualTerminal === "on"`
- `PI_NO_PTY !== "1"`
- le contexte de l'outil dispose d'une interface utilisateur (`ctx.hasUI === true` et `ctx.ui` défini)

Sinon, il utilise `executeBash()` non interactif.

Cela signifie que le mode impression et les contextes RPC/outils sans interface utilisateur utilisent toujours le mode non-PTY.

## Moteur d'exécution non interactif (`executeBash`)

## Modèle de réutilisation des sessions shell

`executeBash()` met en cache les instances `Shell` natives dans une table de correspondance globale au processus, indexée par :

- chemin du shell,
- préfixe de commande configuré,
- chemin du snapshot,
- environnement shell sérialisé,
- clé de session d'agent optionnelle.

Pour les exécutions au niveau de la session, `AgentSession.executeBash()` transmet `sessionKey: this.sessionId`, isolant la réutilisation par session.

Le chemin d'appel d'outil ne transmet **pas** `sessionKey`, de sorte que la portée de réutilisation est basée sur la configuration du shell/snapshot/env.

## Configuration du shell et comportement des snapshots

À chaque appel, l'exécuteur charge la configuration du shell depuis les paramètres (`shell`, `env`, `prefix` optionnel).

Si le shell sélectionné inclut `bash`, il tente `getOrCreateSnapshot()` :

- le snapshot capture les alias/fonctions/options du rc utilisateur,
- la création du snapshot est au mieux,
- en cas d'échec, le repli se fait sans snapshot.

Si un `prefix` est configuré, la commande devient :

```text
<prefix> <command>
```

## Diffusion et annulation

`Shell.run()` diffuse des fragments vers un rappel. L'exécuteur achemine chaque fragment vers `OutputSink` et le rappel optionnel `onChunk`.

Annulation :

- un signal d'abandon déclenche `shellSession.abort(...)`,
- le délai d'expiration issu du résultat natif est mappé vers `cancelled: true` + texte d'annotation,
- une annulation explicite retourne de même `cancelled: true` + annotation.

Aucune exception n'est levée à l'intérieur de l'exécuteur pour les délais d'expiration/annulations ; il retourne un `BashResult` structuré et laisse l'appelant gérer la sémantique des erreurs.

## Chemin PTY interactif (`runInteractiveBashPty`)

Lorsque PTY est activé, l'outil exécute `runInteractiveBashPty()` qui ouvre un composant de console en superposition et pilote une `PtySession` native.

Points saillants du comportement :

- le terminal virtuel xterm-headless restitue le viewport dans la superposition,
- l'entrée clavier est normalisée (y compris les séquences Kitty et la gestion du mode curseur applicatif),
- `esc` lors de l'exécution tue la session PTY,
- le redimensionnement du terminal se propage au PTY (`session.resize(cols, rows)`).

Des valeurs par défaut de renforcement de l'environnement sont injectées pour les exécutions non surveillées :

- paginateurs désactivés (`PAGER=cat`, `GIT_PAGER=cat`, etc.),
- invites d'éditeur désactivées (`GIT_EDITOR=true`, `EDITOR=true`, ...),
- invites de terminal/authentification réduites (`GIT_TERMINAL_PROMPT=0`, `SSH_ASKPASS=/usr/bin/false`, `CI=1`),
- indicateurs d'Automatisation des gestionnaires de paquets/outils pour un comportement non interactif.

La sortie PTY est normalisée (`CRLF`/`CR` vers `LF`, `sanitizeText`) et écrite dans `OutputSink`, avec prise en charge du déversement d'artefact.

En cas d'erreur de démarrage/exécution PTY, le collecteur reçoit une ligne `PTY error: ...` et la commande se finalise avec un code de sortie indéfini.

## Gestion de la sortie : diffusion, troncature, déversement d'artefact

Les chemins PTY et non-PTY utilisent tous deux `OutputSink`.

## Sémantique d'OutputSink

- conserve un tampon de fin en mémoire encodé en UTF-8 (`DEFAULT_MAX_BYTES`, actuellement 50 Ko),
- suit le nombre total d'octets/lignes observés,
- si un chemin d'artefact existe et que la sortie déborde (ou si le fichier est déjà actif), écrit le flux complet dans le fichier d'artefact,
- lorsque le seuil mémoire est dépassé, réduit le tampon en mémoire à la fin (avec respect des limites UTF-8),
- marque `truncated` lorsqu'un débordement/déversement de fichier se produit.

`dump()` retourne :

- `output` (avec éventuel préfixe annoté),
- `truncated`,
- `totalLines/totalBytes`,
- `outputLines/outputBytes`,
- `artifactId` si un fichier d'artefact était actif.

### Mise en garde sur les longues sorties

La troncature à l'exécution est basée sur un seuil en octets dans `OutputSink` (50 Ko par défaut). Elle n'impose pas de limite stricte de 2 000 lignes dans ce chemin de code.

## Mises à jour en direct de l'outil

Pour l'exécution non-PTY, `BashTool` utilise un `TailBuffer` séparé pour les mises à jour partielles et émet des snapshots `onUpdate` pendant l'exécution de la commande.

Pour l'exécution PTY, le rendu en direct est géré par l'interface utilisateur de superposition personnalisée, et non par des fragments textuels `onUpdate`.

## Mise en forme des résultats, métadonnées et mappage des erreurs

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
- `details.meta.truncation` lorsque tronqué, incluant :
  - `direction`, `truncatedBy`, nombre total/de sortie de lignes et d'octets,
  - `shownRange`,
  - `artifactId` lorsque disponible.

Étant donné que les outils intégrés sont encapsulés avec `wrapToolWithMetaNotice()`, le texte de notification de troncature est automatiquement ajouté au contenu textuel final (par exemple : `Full: artifact://<id>`).

## Chemins de rendu

## Rendu d'appel d'outil (`bashToolRenderer`)

`bashToolRenderer` est utilisé pour les messages d'appel d'outil (`toolCall` / `toolResult`) :

- le mode réduit affiche un aperçu tronqué à la ligne visuelle,
- le mode développé affiche tout le texte de sortie actuellement disponible,
- la ligne d'avertissement inclut la raison de la troncature et `artifact://<id>` lorsque tronqué,
- la valeur de délai d'expiration (issue des arguments) est affichée dans la ligne de métadonnées du pied de page.

### Mise en garde : expansion complète de l'artefact

`BashRenderContext` possède `isFullOutput`, mais le constructeur de contexte de rendu actuel ne le définit pas pour les résultats de l'outil bash. La vue développée utilise toujours le texte déjà présent dans le contenu du résultat (sortie de fin/tronquée), sauf si un autre appelant fournit le contenu complet de l'artefact.

## Composant de commande bang utilisateur (`BashExecutionComponent`)

`BashExecutionComponent` est destiné aux commandes `!` utilisateur en mode interactif (pas aux appels d'outils du modèle) :

- diffuse les fragments en direct,
- l'aperçu réduit conserve les 20 dernières lignes logiques,
- limitation à 4 000 caractères par ligne,
- affiche les avertissements de troncature et d'artefact lorsque les métadonnées sont présentes,
- marque séparément l'état annulé/erreur/sortie.

Ce composant est connecté par `CommandController.handleBashCommand()` et alimenté par `AgentSession.executeBash()`.

## Différences de comportement selon le mode

| Surface                             | Chemin d'entrée                                       | PTY éligible                                                                       | Interface utilisateur de sortie en direct                                                        | Remontée des erreurs                                         |
| ----------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| Appel d'outil interactif            | `BashTool.execute`                                    | Oui, si `bash.virtualTerminal=on`, interface utilisateur existante et `PI_NO_PTY!=1` | Superposition PTY (interactif) ou mises à jour de fin diffusées                                 | Les erreurs d'outil deviennent `toolResult.isError`          |
| Appel d'outil en mode impression    | `BashTool.execute`                                    | Non (pas de contexte d'interface utilisateur)                                      | Pas de superposition TUI ; la sortie apparaît dans le flux d'événements/flux de texte assistant final | Même mappage d'erreur d'outil                               |
| Appel d'outil RPC (outillage agent) | `BashTool.execute`                                    | Généralement pas d'interface utilisateur -> non-PTY                                | Événements/résultats d'outil structurés                                                          | Même mappage d'erreur d'outil                               |
| Commande bang interactive (`!`)     | `AgentSession.executeBash` + `BashExecutionComponent` | Non (utilise directement l'exécuteur)                                              | Composant d'exécution bash dédié                                                                  | Le contrôleur intercepte les exceptions et affiche une erreur d'interface utilisateur |
| Commande RPC `bash`                 | `rpc-mode` -> `session.executeBash`                   | Non                                                                                | Retourne directement `BashResult`                                                                | Le consommateur gère les champs retournés                    |

## Mises en garde opérationnelles

- L'intercepteur ne bloque les commandes que lorsque l'outil suggéré est actuellement disponible dans le contexte.
- Si l'allocation d'artefact échoue, la troncature se produit quand même mais aucune référence arrière `artifact://` n'est disponible.
- Le cache de sessions shell ne dispose d'aucune éviction explicite dans ce module ; la durée de vie est limitée au processus.
- Les surfaces de délai d'expiration PTY et non-PTY diffèrent :
  - PTY expose un champ de résultat `timedOut` explicite,
  - non-PTY mappe le délai d'expiration vers un résumé `cancelled + annotation`.

## Fichiers d'implémentation

- [`src/tools/bash.ts`](../../packages/coding-agent/src/tools/bash.ts) — point d'entrée de l'outil, normalisation/interception, sélection PTY/non-PTY, mappage des résultats/erreurs, rendu de l'outil bash.
- [`src/tools/bash-normalize.ts`](../../packages/coding-agent/src/tools/bash-normalize.ts) — normalisation des commandes et filtrage head/tail post-exécution.
- [`src/tools/bash-interceptor.ts`](../../packages/coding-agent/src/tools/bash-interceptor.ts) — correspondance des règles d'interception et messages de commande bloquée.
- [`src/exec/bash-executor.ts`](../../packages/coding-agent/src/exec/bash-executor.ts) — exécuteur non-PTY, réutilisation des sessions shell, câblage de l'annulation, intégration du collecteur de sortie.
- [`src/tools/bash-interactive.ts`](../../packages/coding-agent/src/tools/bash-interactive.ts) — environnement d'exécution PTY, interface utilisateur de superposition, normalisation des entrées, valeurs par défaut d'environnement non interactif.
- [`src/session/streaming-output.ts`](../../packages/coding-agent/src/session/streaming-output.ts) — troncature/déversement d'artefact `OutputSink` et métadonnées de résumé.
- [`src/tools/output-utils.ts`](../../packages/coding-agent/src/tools/output-utils.ts) — assistants d'allocation d'artefacts et tampon de fin en diffusion.
- [`src/tools/output-meta.ts`](../../packages/coding-agent/src/tools/output-meta.ts) — forme des métadonnées de troncature + encapsuleur d'injection de notification.
- [`src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — `executeBash` au niveau de la session, enregistrement des messages, cycle de vie de l'abandon.
- [`src/modes/components/bash-execution.ts`](../../packages/coding-agent/src/modes/components/bash-execution.ts) — composant d'exécution de commande `!` interactive.
- [`src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts) — câblage pour la complétion du flux/mise à jour de l'interface utilisateur de commande `!` interactive.
- [`src/modes/rpc/rpc-mode.ts`](../../packages/coding-agent/src/modes/rpc/rpc-mode.ts) — surface de commande RPC `bash` et `abort_bash`.
- [`src/internal-urls/artifact-protocol.ts`](../../packages/coding-agent/src/internal-urls/artifact-protocol.ts) — résolution de `artifact://<id>`.
