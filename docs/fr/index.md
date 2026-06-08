---
title: Documentation xcsh
description: >-
  AI-powered development CLI with TypeScript coding agent and Rust native layer
  for long-lived sessions, MCP support, and platform packaging.
sidebar:
  order: 0
  label: Vue d'ensemble
i18n:
  sourceHash: b9288f42bf46
  translator: machine
---

xcsh est un CLI de développement alimenté par l'IA avec un agent de codage TypeScript et une
couche native Rust (`pi-natives`). Il étend la lignée open-source
[`badlogic/pi-mono`](https://github.com/badlogic/pi-mono) avec un
runtime renforcé, des sessions de longue durée avec navigation arborescente et compaction,
un outil Python IPython, un support MCP complet, un système de compétences, et un
packaging multiplateforme ciblant Linux, macOS et Windows.

## Par où commencer

- **[Contextes F5 XC](/runtime-tools/context-command)** — connectez-vous aux tenants F5 Distributed Cloud.
  Créez des contextes, basculez entre eux, gérez les espaces de noms et les identifiants.
- **Configuration** — comment xcsh découvre, résout et superpose la configuration.
- **Runtime & Outils** — les runtimes d'outils bash / notebook / resolve et la
  surface des commandes slash.
- **Sessions** — journal d'entrées en ajout seul, navigation arborescente, compaction et le
  système de mémoire autonome.
- **Natives (Rust)** — architecture de l'addon N-API `pi-natives` qui
  alimente le shell / PTY / média / recherche.
- **MCP** — configuration, détails du protocole, cycle de vie du runtime, et comment
  créer des serveurs et des outils.
- **Extensions, Compétences & Plugins** — création, chargement, règles de correspondance, le
  marketplace et l'installateur de plugins.
- **Fournisseurs & Modèles** — configuration des modèles, détails du streaming et le
  runtime Python / IPython.
- **TUI** — thèmes, la commande `/tree`, et les hooks d'intégration pour les
  extensions et outils personnalisés.

## Comment cet ensemble de documentation est organisé

Chaque groupe de premier niveau dans la barre latérale correspond à un sous-système de l'agent. Au sein
d'un groupe, les pages vont de « vue d'ensemble » à « détails internes » afin que vous puissiez arrêter votre lecture
lorsque vous disposez de suffisamment de contexte pour la tâche en cours.
