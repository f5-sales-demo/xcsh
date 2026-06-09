---
title: Documentation xcsh
description: >-
  CLI de développement propulsé par l'IA avec un agent de codage TypeScript et
  une couche native Rust pour les sessions de longue durée, le support MCP et le
  packaging multiplateforme.
sidebar:
  order: 0
  label: Vue d'ensemble
i18n:
  sourceHash: b9288f42bf46
  translator: machine
---

xcsh est un CLI de développement propulsé par l'IA avec un agent de codage TypeScript et une couche native Rust (`pi-natives`). Il étend la lignée open-source
[`badlogic/pi-mono`](https://github.com/badlogic/pi-mono) avec un runtime
renforcé, des sessions de longue durée avec navigation arborescente et compaction,
un outil Python IPython, un support MCP complet, un système de compétences et un
packaging multiplateforme ciblant Linux, macOS et Windows.

## Par où commencer

- **[Contextes F5 XC](/runtime-tools/context-command)** — connectez-vous aux tenants F5 Distributed Cloud.
  Créez des contextes, basculez entre eux, gérez les espaces de noms et les identifiants.
- **Configuration** — comment xcsh découvre, résout et superpose les configurations.
- **Runtime & Outils** — les environnements d'exécution bash / notebook / resolve et la
  surface des commandes slash.
- **Sessions** — journal d'entrées en mode ajout uniquement, navigation arborescente, compaction et
  système de mémoire autonome.
- **Natives (Rust)** — architecture de l'addon N-API `pi-natives` qui
  alimente le shell / PTY / média / recherche.
- **MCP** — configuration, détails internes du protocole, cycle de vie du runtime et comment
  créer des serveurs et des outils.
- **Extensions, Compétences & Plugins** — création, chargement, règles de correspondance,
  marketplace et installateur de plugins.
- **Fournisseurs & Modèles** — configuration des modèles, détails internes du streaming et
  runtime Python / IPython.
- **TUI** — thèmes, commande `/tree` et hooks d'intégration pour les
  extensions et outils personnalisés.

## Organisation de cette documentation

Chaque groupe de premier niveau dans la barre latérale correspond à un sous-système de l'agent. Au sein
d'un groupe, les pages vont de « vue d'ensemble » à « détails internes » afin que vous puissiez arrêter
la lecture dès que vous disposez de suffisamment de contexte pour la tâche en cours.
