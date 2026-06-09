---
title: Environnement d'exécution de l'outil Bash
description: >-
  Environnement d'exécution de l'outil Bash avec gestion des processus shell,
  sandboxing, délais d'expiration et diffusion de la sortie en continu.
sidebar:
  order: 1
  label: Outil Bash
i18n:
  sourceHash: 18b12aa5dbd5
  translator: machine
---

# Environnement d'exécution de l'outil Bash

Ce document décrit le chemin d'exécution de l'**outil `bash`** utilisé par les appels d'outils de l'agent, de la normalisation des commandes à l'exécution, la troncature/les artefacts et le rendu.

Il signale également les divergences de comportement en mode TUI interactif, mode impression, mode RPC et l'exécution shell initiée par l'utilisateur avec bang (`!`).

## Portée et surfaces d'exécution

Il existe deux surfaces d'exécution bash différentes dans coding-agent :

1. **Surface d'appel d'outil** (`toolName: "bash"`) : utilisée lorsque le modèle appelle l'outil bash.
   - Point d'entrée : `BashTool.execute()`.
2. **Surface de commande bang utilisateur** (`!cmd` depuis l'entrée interactive ou la commande RPC `bash`) : chemin auxiliaire au niveau de la session.
   - Point d'entrée : `AgentSession.executeBash()`.

Les deux utilisent finalement `executeBash()` dans `src/exec/bash-executor.ts` pour l'exécution sans PTY, mais seul le chemin d'appel d'outil exécute la normalisation/l'interception et la logique du rendu d'outil.

## Pipeline de bout en bout de l'appel d'outil

## 1) Normalisation de l'entrée et fusion des paramètres

`BashTool.execute()` normalise d'abord la commande brute via `normalizeBashCommand()` :

- extrait les `| head -n N`, `| head -N`, `| tail -n N`, `| tail -N` en fin de commande sous forme de limites structurées,
- supprime les espaces en début et fin de chaîne,
- conserve les espaces internes intacts.

Puis fusionne les limites extraites avec les arguments explicites de l'outil :

- les arguments `head`/`tail` explicites écrasent les valeurs extraites,
- les valeurs extraites ne sont qu'un repli.

### Mise en garde

Les commentaires de `bash-normalize.ts` mentionnent la suppression de `2>&1`, mais l'implémentation actuelle ne le supprime pas. Le comportement à l'exécution reste correct (stdout/stderr sont déjà fusionnés), mais le comportement de normalisation est plus restreint que ce que les commentaires suggèrent.

## 2) Interception optionnelle (chemin des commandes bloquées)

Si `bashInterceptor.enabled` est vrai, `BashTool` charge les règles depuis les paramètres et exécute `checkBashInterception()` sur la commande normalisée.

Comportement de l'interception :

- la commande est bloquée **uniquement** lorsque :
  - une règle regex correspond, et
  - l'outil suggéré est présent dans `ctx.toolNames`.
- les règles regex invalides sont ignorées silencieusement.
- en cas de blocage, `BashTool` lève une `ToolError` avec le message :
  - `Blocked: ...`
  - commande originale incluse.

Les motifs de règles par défaut (définis dans le code) ciblent les utilisations abusives courantes :

- lecteurs de fichiers (`cat`, `head`, `tail`, ...)
- outils de recherche (`grep`, `rg`, ...)
- outils de recherche de fichiers (`find`, `fd`, ...)
- éditeurs en place (`sed -i`, `perl -i`, `awk -i inplace`)
- écritures par redirection shell (`echo ... > file`, redirection heredoc)

### Mise en garde

`InterceptionResult` inclut `suggestedTool`, mais `BashTool` ne fait actuellement remonter que le texte du message (pas de champ structuré suggested-tool dans `details`).

## 3) Validation du CWD et limitation du délai d'expiration

`cwd` est résolu relativement au cwd de la session (`resolveToCwd`), puis validé via `stat` :

- chemin manquant -> `ToolError("Working directory does not exist: ...")`
- pas un répertoire -> `ToolError("Working directory is not a directory: ...")`

Le délai d'expiration est limité à `[1, 3600]` secondes et converti en millisecondes.

## 4) Allocation d'artefact

Avant l'exécution, l'outil alloue un chemin/identifiant d'artefact (au mieux) pour le stockage de la sortie tronquée.

- l'échec de l'allocation d'artefact est non fatal (l'exécution continue sans fichier de déversement d'artefact),
- l'identifiant/chemin d'artefact sont transmis au chemin d'exécution pour la persistance de la sortie complète en cas de troncature.

## 5) Sélection de l'exécution PTY vs non-PTY

`BashTool` choisit l'exécution PTY uniquement lorsque toutes les conditions suivantes sont vraies :

- `bash.virtualTerminal === "on"`
- `PI_NO_PTY !== "1"`
- le contexte d'outil dispose d'une UI (`ctx.hasUI === true` et `ctx.ui` défini)

Sinon, il utilise l'exécution non interactive `executeBash()`.

Cela signifie que le mode impression et les contextes RPC/outil sans UI utilisent toujours le mode non-PTY.

## Moteur d'exécution non interactif (`executeBash`)

## Modèle de réutilisation de session shell

`executeBash()` met en cache les instances natives `Shell` dans une map globale au processus, indexée par :

- chemin du shell,
- préfixe de commande configuré,
- chemin du snapshot,
- environnement shell sérialisé,
- clé de session d'agent optionnelle.

Pour les exécutions au niveau de la session, `AgentSession.executeBash()` passe `sessionKey: this.sessionId`, isolant la réutilisation par session.

Le chemin d'appel d'outil ne passe **pas** de `sessionKey`, donc la portée de réutilisation est basée sur la configuration shell/snapshot/env.

## Configuration shell et comportement des snapshots

À chaque appel, l'exécuteur charge la configuration shell depuis les paramètres (`shell`, `env`, `prefix` optionnel).

Si le shell sélectionné inclut `bash`, il tente `getOrCreateSnapshot()` :

- le snapshot capture les alias/fonctions/options depuis le rc de l'utilisateur,
- la création du snapshot fonctionne au mieux,
- l'échec se rabat sur l'absence de snapshot.

Si `prefix` est configuré, la commande devient :

```text
<prefix> <command>
```

## Diffusion en continu et annulation

`Shell.run()` diffuse les fragments via un callback. L'exécuteur redirige chaque fragment vers `OutputSink` et un callback `onChunk` optionnel.

Annulation :

- le signal d'abandon déclenche `shellSession.abort(...)`,
- le délai d'expiration du résultat natif est mappé vers `cancelled: true` + texte d'annotation,
- l'annulation explicite retourne similairement `cancelled: true` + annotation.

Aucune exception n'est levée à l'intérieur de l'exécuteur pour le délai d'expiration/l'annulation ; il retourne un `BashResult` structuré et laisse l'appelant mapper la sémantique d'erreur.

## Chemin PTY interactif (`runInteractiveBashPty`)

Lorsque le PTY est activé, l'outil exécute `runInteractiveBashPty()` qui ouvre un composant console en superposition et pilote une `PtySession` native.

Points clés du comportement :

- le terminal virtuel xterm-headless rend la fenêtre d'affichage dans la superposition,
- l'entrée clavier est normalisée (incluant les séquences Kitty et la gestion du mode curseur applicatif),
- `esc` pendant l'exécution tue la session PTY,
- le redimensionnement du terminal se propage au PTY (`session.resize(cols, rows)`).

Des valeurs par défaut de durcissement de l'environnement sont injectées pour les exécutions sans surveillance :

- pagers désactivés (`PAGER=cat`, `GIT_PAGER=cat`, etc.),
- invites d'éditeur désactivées (`GIT_EDITOR=true`, `EDITOR=true`, ...),
- invites de terminal/authentification réduites (`GIT_TERMINAL_PROMPT=0`, `SSH_ASKPASS=/usr/bin/false`, `CI=1`),
- indicateurs d'automatisation du gestionnaire de paquets/outils pour un comportement non interactif.

La sortie PTY est normalisée (`CRLF`/`CR` vers `LF`, `sanitizeText`) et écrite dans `OutputSink`, incluant le support de déversement d'artefact.

En cas d'erreur au démarrage/à l'exécution du PTY, le sink reçoit une ligne `PTY error: ...` et la commande se finalise avec un code de sortie indéfini.

## Gestion de la sortie : diffusion en continu, troncature, déversement d'artefact

Les chemins PTY et non-PTY utilisent tous deux `OutputSink`.

## Sémantique d'OutputSink

- conserve un tampon de queue en mémoire compatible UTF-8 (`DEFAULT_MAX_BYTES`, actuellement 50 Ko),
- suit le total des octets/lignes vus,
- si un chemin d'artefact existe et que la sortie déborde (ou que le fichier est déjà actif), écrit le flux complet dans le fichier d'artefact,
- lorsque le seuil mémoire déborde, réduit le tampon en mémoire à la queue (respectant les limites UTF-8),
- marque `truncated` lorsqu'un débordement/déversement fichier se produit.

`dump()` retourne :

- `output` (préfixe possiblement annoté),
- `truncated`,
- `totalLines/totalBytes`,
- `outputLines/outputBytes`,
- `artifactId` si le fichier d'artefact était actif.

### Mise en garde sur les sorties longues

La troncature à l'exécution est basée sur un seuil en octets dans `OutputSink` (50 Ko par défaut). Elle n'impose pas une limite stricte de 2000 lignes dans ce chemin de code.

## Mises à jour de l'outil en direct

Pour l'exécution non-PTY, `BashTool` utilise un `TailBuffer` séparé pour les mises à jour partielles et émet des snapshots `onUpdate` pendant l'exécution de la commande.

Pour l'exécution PTY, le rendu en direct est géré par la superposition UI personnalisée, pas par des fragments de texte `onUpdate`.

## Mise en forme du résultat, métadonnées et mapping d'erreurs

Après l'exécution :

1. Gestion de `cancelled` :
   - si le signal d'abandon est déclenché -> lève `ToolAbortError` (sémantique d'abandon),
   - sinon -> lève `ToolError` (traité comme un échec d'outil).
2. PTY `timedOut` -> lève `ToolError`.
3. applique les filtres head/tail au texte de sortie final (`applyHeadTail`, head puis tail).
4. une sortie vide devient `(no output)`.
5. attache les métadonnées de troncature via `toolResult(...).truncationFromSummary(result, { direction: "tail" })`.
6. Mapping du code de sortie :
   - code de sortie manquant -> `ToolError("... missing exit status")`
   - sortie non nulle -> `ToolError("... Command exited with code N")`
   - sortie zéro -> résultat de succès.

Structure du payload de succès :

- `content` : texte de sortie,
- `details.meta.truncation` en cas de troncature, incluant :
  - `direction`, `truncatedBy`, compteurs total/output lignes+octets,
  - `shownRange`,
  - `artifactId` lorsque disponible.

Comme les outils intégrés sont encapsulés avec `wrapToolWithMetaNotice()`, le texte de notification de troncature est automatiquement ajouté au contenu texte final (par exemple : `Full: artifact://<id>`).

## Chemins de rendu

## Rendu d'appel d'outil (`bashToolRenderer`)

`bashToolRenderer` est utilisé pour les messages d'appel d'outil (`toolCall` / `toolResult`) :

- le mode replié affiche un aperçu tronqué en lignes visuelles,
- le mode déplié affiche tout le texte de sortie actuellement disponible,
- la ligne d'avertissement inclut la raison de la troncature et `artifact://<id>` en cas de troncature,
- la valeur du délai d'expiration (depuis les arguments) est affichée dans la ligne de métadonnées du pied de page.

### Mise en garde : expansion complète de l'artefact

`BashRenderContext` possède `isFullOutput`, mais le constructeur de contexte de rendu actuel ne le définit pas pour les résultats de l'outil bash. La vue dépliée utilise toujours le texte déjà présent dans le contenu du résultat (sortie queue/tronquée) sauf si un autre appelant fournit le contenu complet de l'artefact.

## Composant de commande bang utilisateur (`BashExecutionComponent`)

`BashExecutionComponent` est destiné aux commandes `!` de l'utilisateur en mode interactif (pas aux appels d'outils du modèle) :

- diffuse les fragments en direct,
- l'aperçu replié conserve les 20 dernières lignes logiques,
- limite de ligne à 4000 caractères par ligne,
- affiche les avertissements de troncature + artefact lorsque les métadonnées sont présentes,
- marque les états annulé/erreur/sortie séparément.

Ce composant est câblé par `CommandController.handleBashCommand()` et alimenté par `AgentSession.executeBash()`.

## Différences de comportement spécifiques aux modes

| Surface                                   | Chemin d'entrée                                       | Éligible PTY                                                              | UX de sortie en direct                                                                | Remontée des erreurs                                       |
| ----------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Appel d'outil interactif                  | `BashTool.execute`                                    | Oui, quand `bash.virtualTerminal=on` et UI existante et `PI_NO_PTY!=1`   | Superposition PTY (interactif) ou mises à jour en queue diffusées                     | Les erreurs d'outil deviennent `toolResult.isError`        |
| Appel d'outil en mode impression          | `BashTool.execute`                                    | Non (pas de contexte UI)                                                  | Pas de superposition TUI ; la sortie apparaît dans le flux d'événements/texte final   | Même mapping d'erreur d'outil                              |
| Appel d'outil RPC (outillage agent)       | `BashTool.execute`                                    | Généralement pas d'UI -> non-PTY                                          | Événements/résultats d'outil structurés                                               | Même mapping d'erreur d'outil                              |
| Commande bang interactive (`!`)           | `AgentSession.executeBash` + `BashExecutionComponent` | Non (utilise l'exécuteur directement)                                     | Composant d'exécution bash dédié                                                      | Le contrôleur capture les exceptions et affiche l'erreur UI |
| Commande RPC `bash`                       | `rpc-mode` -> `session.executeBash`                   | Non                                                                       | Retourne `BashResult` directement                                                     | Le consommateur gère les champs retournés                  |

## Mises en garde opérationnelles

- L'intercepteur ne bloque les commandes que lorsque l'outil suggéré est actuellement disponible dans le contexte.
- Si l'allocation d'artefact échoue, la troncature se produit quand même mais aucune référence `artifact://` n'est disponible.
- Le cache de session shell n'a pas d'éviction explicite dans ce module ; la durée de vie est à portée du processus.
- Les surfaces de délai d'expiration PTY et non-PTY diffèrent :
  - le PTY expose un champ de résultat explicite `timedOut`,
  - le non-PTY mappe le délai d'expiration en résumé `cancelled + annotation`.

## Fichiers d'implémentation

- [`src/tools/bash.ts`](../../packages/coding-agent/src/tools/bash.ts) — point d'entrée de l'outil, normalisation/interception, sélection PTY/non-PTY, mapping résultat/erreur, rendu de l'outil bash.
- [`src/tools/bash-normalize.ts`](../../packages/coding-agent/src/tools/bash-normalize.ts) — normalisation des commandes et filtrage head/tail post-exécution.
- [`src/tools/bash-interceptor.ts`](../../packages/coding-agent/src/tools/bash-interceptor.ts) — correspondance des règles d'interception et messages de commandes bloquées.
- [`src/exec/bash-executor.ts`](../../packages/coding-agent/src/exec/bash-executor.ts) — exécuteur non-PTY, réutilisation de session shell, câblage d'annulation, intégration du sink de sortie.
- [`src/tools/bash-interactive.ts`](../../packages/coding-agent/src/tools/bash-interactive.ts) — environnement d'exécution PTY, superposition UI, normalisation d'entrée, valeurs par défaut d'environnement non interactif.
- [`src/session/streaming-output.ts`](../../packages/coding-agent/src/session/streaming-output.ts) — troncature/déversement d'artefact `OutputSink` et métadonnées de résumé.
- [`src/tools/output-utils.ts`](../../packages/coding-agent/src/tools/output-utils.ts) — utilitaires d'allocation d'artefact et tampon de queue en diffusion.
- [`src/tools/output-meta.ts`](../../packages/coding-agent/src/tools/output-meta.ts) — forme des métadonnées de troncature + wrapper d'injection de notification.
- [`src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — `executeBash` au niveau de la session, enregistrement des messages, cycle de vie d'abandon.
- [`src/modes/components/bash-execution.ts`](../../packages/coding-agent/src/modes/components/bash-execution.ts) — composant d'exécution de commande `!` interactive.
- [`src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts) — câblage pour le flux/achèvement de mise à jour de l'UI de commande `!` interactive.
- [`src/modes/rpc/rpc-mode.ts`](../../packages/coding-agent/src/modes/rpc/rpc-mode.ts) — surface de commande RPC `bash` et `abort_bash`.
- [`src/internal-urls/artifact-protocol.ts`](../../packages/coding-agent/src/internal-urls/artifact-protocol.ts) — résolution `artifact://<id>`.
