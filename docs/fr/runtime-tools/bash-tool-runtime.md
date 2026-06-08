---
title: Bash Tool Runtime
description: >-
  Bash tool runtime with shell process management, sandboxing, timeout, and
  output streaming.
sidebar:
  order: 1
  label: Bash tool
i18n:
  sourceHash: 18b12aa5dbd5
  translator: machine
---

# Environnement d'exécution de l'outil Bash

Ce document décrit le chemin d'exécution de l'**outil `bash`** utilisé par les appels d'outils de l'agent, depuis la normalisation des commandes jusqu'à l'exécution, la troncature/artefacts et le rendu.

Il signale également les divergences de comportement en mode TUI interactif, mode print, mode RPC et exécution shell initiée par l'utilisateur via bang (`!`).

## Portée et surfaces d'exécution

Il existe deux surfaces d'exécution bash différentes dans coding-agent :

1. **Surface d'appel d'outil** (`toolName: "bash"`) : utilisée lorsque le modèle appelle l'outil bash.
   - Point d'entrée : `BashTool.execute()`.
2. **Surface de commande bang utilisateur** (`!cmd` depuis l'entrée interactive ou commande RPC `bash`) : chemin auxiliaire au niveau de la session.
   - Point d'entrée : `AgentSession.executeBash()`.

Les deux utilisent finalement `executeBash()` dans `src/exec/bash-executor.ts` pour l'exécution non-PTY, mais seul le chemin d'appel d'outil exécute la normalisation/interception et la logique de rendu d'outil.

## Pipeline d'appel d'outil de bout en bout

## 1) Normalisation de l'entrée et fusion des paramètres

`BashTool.execute()` normalise d'abord la commande brute via `normalizeBashCommand()` :

- extrait les `| head -n N`, `| head -N`, `| tail -n N`, `| tail -N` en fin de commande sous forme de limites structurées,
- supprime les espaces en début et fin de chaîne,
- conserve les espaces internes intacts.

Ensuite, il fusionne les limites extraites avec les arguments d'outil explicites :

- les arguments `head`/`tail` explicites remplacent les valeurs extraites,
- les valeurs extraites ne sont utilisées qu'en dernier recours.

### Mise en garde

Les commentaires de `bash-normalize.ts` mentionnent la suppression de `2>&1`, mais l'implémentation actuelle ne le supprime pas. Le comportement à l'exécution reste correct (stdout/stderr sont déjà fusionnés), mais le comportement de normalisation est plus restreint que ce que les commentaires suggèrent.

## 2) Interception optionnelle (chemin de commande bloquée)

Si `bashInterceptor.enabled` est vrai, `BashTool` charge les règles depuis les paramètres et exécute `checkBashInterception()` sur la commande normalisée.

Comportement de l'interception :

- la commande est bloquée **uniquement** lorsque :
  - une règle regex correspond, et
  - l'outil suggéré est présent dans `ctx.toolNames`.
- les règles regex invalides sont silencieusement ignorées.
- en cas de blocage, `BashTool` lance une `ToolError` avec le message :
  - `Blocked: ...`
  - commande originale incluse.

Les motifs de règles par défaut (définis dans le code) ciblent les utilisations abusives courantes :

- lecteurs de fichiers (`cat`, `head`, `tail`, ...)
- outils de recherche (`grep`, `rg`, ...)
- outils de recherche de fichiers (`find`, `fd`, ...)
- éditeurs en place (`sed -i`, `perl -i`, `awk -i inplace`)
- écritures par redirection shell (`echo ... > file`, redirection heredoc)

### Mise en garde

`InterceptionResult` inclut `suggestedTool`, mais `BashTool` ne présente actuellement que le texte du message (pas de champ structuré suggested-tool dans `details`).

## 3) Validation du CWD et limitation du timeout

`cwd` est résolu relativement au cwd de la session (`resolveToCwd`), puis validé via `stat` :

- chemin manquant -> `ToolError("Working directory does not exist: ...")`
- non-répertoire -> `ToolError("Working directory is not a directory: ...")`

Le timeout est limité à `[1, 3600]` secondes et converti en millisecondes.

## 4) Allocation d'artefact

Avant l'exécution, l'outil alloue un chemin/identifiant d'artefact (au mieux) pour le stockage de la sortie tronquée.

- l'échec de l'allocation d'artefact n'est pas fatal (l'exécution continue sans fichier de débordement d'artefact),
- l'identifiant/chemin d'artefact sont transmis au chemin d'exécution pour la persistance de la sortie complète en cas de troncature.

## 5) Sélection de l'exécution PTY vs non-PTY

`BashTool` choisit l'exécution PTY uniquement lorsque toutes les conditions suivantes sont vraies :

- `bash.virtualTerminal === "on"`
- `PI_NO_PTY !== "1"`
- le contexte de l'outil dispose d'une interface utilisateur (`ctx.hasUI === true` et `ctx.ui` défini)

Sinon, il utilise `executeBash()` non-interactif.

Cela signifie que le mode print et les contextes RPC/outil sans interface utilisateur utilisent toujours le mode non-PTY.

## Moteur d'exécution non-interactif (`executeBash`)

## Modèle de réutilisation des sessions shell

`executeBash()` met en cache les instances natives `Shell` dans un dictionnaire global au processus, indexé par :

- chemin du shell,
- préfixe de commande configuré,
- chemin du snapshot,
- environnement shell sérialisé,
- clé de session agent optionnelle.

Pour les exécutions au niveau de la session, `AgentSession.executeBash()` passe `sessionKey: this.sessionId`, isolant la réutilisation par session.

Le chemin d'appel d'outil ne passe **pas** de `sessionKey`, donc la portée de réutilisation est basée sur la configuration shell/snapshot/env.

## Configuration shell et comportement des snapshots

À chaque appel, l'exécuteur charge la configuration shell depuis les paramètres (`shell`, `env`, `prefix` optionnel).

Si le shell sélectionné inclut `bash`, il tente `getOrCreateSnapshot()` :

- le snapshot capture les alias/fonctions/options depuis le rc utilisateur,
- la création du snapshot est au mieux,
- l'échec se rabat sur l'absence de snapshot.

Si `prefix` est configuré, la commande devient :

```text
<prefix> <command>
```

## Streaming et annulation

`Shell.run()` diffuse des morceaux vers un callback. L'exécuteur transmet chaque morceau dans `OutputSink` et un callback optionnel `onChunk`.

Annulation :

- le signal d'abandon déclenche `shellSession.abort(...)`,
- le timeout du résultat natif est mappé vers `cancelled: true` + texte d'annotation,
- l'annulation explicite retourne également `cancelled: true` + annotation.

Aucune exception n'est levée à l'intérieur de l'exécuteur pour timeout/annulation ; il retourne un `BashResult` structuré et laisse l'appelant gérer la sémantique d'erreur.

## Chemin PTY interactif (`runInteractiveBashPty`)

Lorsque le PTY est activé, l'outil exécute `runInteractiveBashPty()` qui ouvre un composant de console en superposition et pilote une `PtySession` native.

Points clés du comportement :

- un terminal virtuel xterm-headless rend la vue dans la superposition,
- l'entrée clavier est normalisée (incluant les séquences Kitty et la gestion du mode curseur application),
- `esc` pendant l'exécution tue la session PTY,
- le redimensionnement du terminal est propagé au PTY (`session.resize(cols, rows)`).

Des valeurs par défaut de durcissement d'environnement sont injectées pour les exécutions sans surveillance :

- pagers désactivés (`PAGER=cat`, `GIT_PAGER=cat`, etc.),
- invites d'éditeur désactivées (`GIT_EDITOR=true`, `EDITOR=true`, ...),
- invites terminal/authentification réduites (`GIT_TERMINAL_PROMPT=0`, `SSH_ASKPASS=/usr/bin/false`, `CI=1`),
- drapeaux d'automatisation des gestionnaires de paquets/outils pour un comportement non-interactif.

La sortie PTY est normalisée (`CRLF`/`CR` vers `LF`, `sanitizeText`) et écrite dans `OutputSink`, incluant le support de débordement d'artefact.

En cas d'erreur au démarrage/exécution du PTY, le sink reçoit une ligne `PTY error: ...` et la commande se finalise avec un code de sortie indéfini.

## Gestion de la sortie : streaming, troncature, débordement d'artefact

Les chemins PTY et non-PTY utilisent `OutputSink`.

## Sémantique de l'OutputSink

- conserve un tampon de fin en mémoire, sûr en UTF-8 (`DEFAULT_MAX_BYTES`, actuellement 50 Ko),
- suit le total d'octets/lignes vus,
- si un chemin d'artefact existe et que la sortie déborde (ou que le fichier est déjà actif), écrit le flux complet dans le fichier d'artefact,
- lorsque le seuil mémoire est dépassé, réduit le tampon en mémoire à la fin (sûr aux frontières UTF-8),
- marque `truncated` lorsqu'un débordement/écriture dans un fichier se produit.

`dump()` retourne :

- `output` (préfixe éventuellement annoté),
- `truncated`,
- `totalLines/totalBytes`,
- `outputLines/outputBytes`,
- `artifactId` si un fichier d'artefact était actif.

### Mise en garde sur les sorties longues

La troncature à l'exécution est basée sur un seuil en octets dans `OutputSink` (50 Ko par défaut). Elle n'impose pas une limite stricte de 2000 lignes dans ce chemin de code.

## Mises à jour d'outil en direct

Pour l'exécution non-PTY, `BashTool` utilise un `TailBuffer` séparé pour les mises à jour partielles et émet des snapshots `onUpdate` pendant l'exécution de la commande.

Pour l'exécution PTY, le rendu en direct est géré par une superposition d'interface personnalisée, pas par des morceaux de texte `onUpdate`.

## Mise en forme du résultat, métadonnées et mappage d'erreurs

Après l'exécution :

1. Gestion de `cancelled` :
   - si le signal d'abandon est déclenché -> lance `ToolAbortError` (sémantique d'abandon),
   - sinon -> lance `ToolError` (traité comme un échec d'outil).
2. PTY `timedOut` -> lance `ToolError`.
3. applique les filtres head/tail à la sortie finale (`applyHeadTail`, head puis tail).
4. une sortie vide devient `(no output)`.
5. attache les métadonnées de troncature via `toolResult(...).truncationFromSummary(result, { direction: "tail" })`.
6. mappage du code de sortie :
   - code de sortie manquant -> `ToolError("... missing exit status")`
   - sortie non-zéro -> `ToolError("... Command exited with code N")`
   - sortie zéro -> résultat de succès.

Structure du payload de succès :

- `content` : sortie texte,
- `details.meta.truncation` en cas de troncature, incluant :
  - `direction`, `truncatedBy`, compteurs total/sortie de lignes+octets,
  - `shownRange`,
  - `artifactId` lorsque disponible.

Étant donné que les outils intégrés sont encapsulés avec `wrapToolWithMetaNotice()`, le texte de notification de troncature est automatiquement ajouté au contenu texte final (par exemple : `Full: artifact://<id>`).

## Chemins de rendu

## Rendu d'appel d'outil (`bashToolRenderer`)

`bashToolRenderer` est utilisé pour les messages d'appel d'outil (`toolCall` / `toolResult`) :

- le mode réduit affiche un aperçu tronqué en lignes visuelles,
- le mode étendu affiche tout le texte de sortie actuellement disponible,
- la ligne d'avertissement inclut la raison de la troncature et `artifact://<id>` en cas de troncature,
- la valeur de timeout (depuis les arguments) est affichée dans la ligne de métadonnées du pied de page.

### Mise en garde : expansion complète de l'artefact

`BashRenderContext` possède `isFullOutput`, mais le constructeur actuel du contexte de rendu ne le définit pas pour les résultats de l'outil bash. La vue étendue utilise toujours le texte déjà présent dans le contenu du résultat (sortie tronquée/fin) sauf si un autre appelant fournit le contenu complet de l'artefact.

## Composant de commande bang utilisateur (`BashExecutionComponent`)

`BashExecutionComponent` est destiné aux commandes `!` de l'utilisateur en mode interactif (pas les appels d'outil du modèle) :

- diffuse les morceaux en direct,
- l'aperçu réduit conserve les 20 dernières lignes logiques,
- limite de ligne à 4000 caractères par ligne,
- affiche les avertissements de troncature + artefact lorsque les métadonnées sont présentes,
- marque séparément les états annulé/erreur/sortie.

Ce composant est connecté par `CommandController.handleBashCommand()` et alimenté par `AgentSession.executeBash()`.

## Différences de comportement spécifiques aux modes

| Surface                              | Chemin d'entrée                                       | Éligible PTY                                                         | UX de sortie en direct                                                   | Présentation des erreurs                                     |
| ------------------------------------ | ----------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------ |
| Appel d'outil interactif             | `BashTool.execute`                                    | Oui, quand `bash.virtualTerminal=on` et UI existe et `PI_NO_PTY!=1` | Superposition PTY (interactive) ou mises à jour de fin diffusées         | Les erreurs d'outil deviennent `toolResult.isError`          |
| Appel d'outil en mode print          | `BashTool.execute`                                    | Non (pas de contexte UI)                                             | Pas de superposition TUI ; la sortie apparaît dans le flux d'événements/texte final de l'assistant | Même mappage d'erreurs d'outil                               |
| Appel d'outil RPC (outillage agent)  | `BashTool.execute`                                    | Généralement pas d'UI -> non-PTY                                     | Événements/résultats d'outil structurés                                  | Même mappage d'erreurs d'outil                               |
| Commande bang interactive (`!`)      | `AgentSession.executeBash` + `BashExecutionComponent` | Non (utilise l'exécuteur directement)                                | Composant d'exécution bash dédié                                         | Le contrôleur intercepte les exceptions et affiche l'erreur UI |
| Commande RPC `bash`                  | `rpc-mode` -> `session.executeBash`                   | Non                                                                  | Retourne `BashResult` directement                                        | Le consommateur gère les champs retournés                    |

## Mises en garde opérationnelles

- L'intercepteur ne bloque les commandes que lorsque l'outil suggéré est actuellement disponible dans le contexte.
- Si l'allocation d'artefact échoue, la troncature se produit quand même mais aucune rétro-référence `artifact://` n'est disponible.
- Le cache de sessions shell n'a pas d'éviction explicite dans ce module ; la durée de vie est limitée au processus.
- Les surfaces de timeout PTY et non-PTY diffèrent :
  - le PTY expose un champ de résultat explicite `timedOut`,
  - le non-PTY mappe le timeout en un résumé `cancelled + annotation`.

## Fichiers d'implémentation

- [`src/tools/bash.ts`](../../packages/coding-agent/src/tools/bash.ts) — point d'entrée de l'outil, normalisation/interception, sélection PTY/non-PTY, mappage résultat/erreur, rendu de l'outil bash.
- [`src/tools/bash-normalize.ts`](../../packages/coding-agent/src/tools/bash-normalize.ts) — normalisation des commandes et filtrage head/tail post-exécution.
- [`src/tools/bash-interceptor.ts`](../../packages/coding-agent/src/tools/bash-interceptor.ts) — correspondance des règles d'interception et messages de commandes bloquées.
- [`src/exec/bash-executor.ts`](../../packages/coding-agent/src/exec/bash-executor.ts) — exécuteur non-PTY, réutilisation de sessions shell, câblage d'annulation, intégration du sink de sortie.
- [`src/tools/bash-interactive.ts`](../../packages/coding-agent/src/tools/bash-interactive.ts) — environnement d'exécution PTY, superposition UI, normalisation d'entrée, valeurs par défaut d'environnement non-interactif.
- [`src/session/streaming-output.ts`](../../packages/coding-agent/src/session/streaming-output.ts) — troncature/débordement d'artefact de `OutputSink` et métadonnées de résumé.
- [`src/tools/output-utils.ts`](../../packages/coding-agent/src/tools/output-utils.ts) — utilitaires d'allocation d'artefacts et tampon de fin en streaming.
- [`src/tools/output-meta.ts`](../../packages/coding-agent/src/tools/output-meta.ts) — forme des métadonnées de troncature + wrapper d'injection de notification.
- [`src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — `executeBash` au niveau session, enregistrement des messages, cycle de vie d'abandon.
- [`src/modes/components/bash-execution.ts`](../../packages/coding-agent/src/modes/components/bash-execution.ts) — composant d'exécution de commande `!` interactive.
- [`src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts) — câblage pour le flux/achèvement de mise à jour de l'interface de commande `!` interactive.
- [`src/modes/rpc/rpc-mode.ts`](../../packages/coding-agent/src/modes/rpc/rpc-mode.ts) — surface de commande RPC `bash` et `abort_bash`.
- [`src/internal-urls/artifact-protocol.ts`](../../packages/coding-agent/src/internal-urls/artifact-protocol.ts) — résolution de `artifact://<id>`.
