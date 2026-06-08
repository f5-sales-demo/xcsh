---
title: Mémoire autonome
description: >-
  Système de mémoire autonome pour la persistance des préférences utilisateur,
  du contexte de projet et des retours d'expérience entre les sessions.
sidebar:
  order: 7
  label: Mémoire autonome
i18n:
  sourceHash: 2aa9f516aa1e
  translator: machine
---

# Mémoire autonome

Lorsqu'elle est activée, l'agent extrait automatiquement les connaissances durables des sessions passées et injecte un résumé compact dans chaque nouvelle session. Au fil du temps, il construit un magasin de mémoire à l'échelle du projet — décisions techniques, workflows récurrents, écueils — qui se transmet sans effort manuel.

Désactivée par défaut. Activez-la via `/settings` ou `config.yml` :

```yaml
memories:
  enabled: true
```

## Utilisation

### Ce qui est injecté

Au démarrage de la session, si un résumé de mémoire existe pour le projet en cours, il est injecté dans le prompt système sous forme d'un bloc **Memory Guidance**. L'agent reçoit l'instruction de :

- Traiter la mémoire comme un contexte heuristique — utile pour les processus et les décisions antérieures, mais ne faisant pas autorité sur l'état actuel du dépôt.
- Citer le chemin de l'artefact mémoire lorsque la mémoire modifie le plan, et l'associer à des preuves issues du dépôt actuel avant d'agir.
- Privilégier l'état du dépôt et les instructions de l'utilisateur en cas de conflit avec la mémoire ; traiter la mémoire en conflit comme obsolète.

### Lecture des artefacts mémoire

L'agent peut lire les fichiers mémoire directement en utilisant les URL `memory://` avec l'outil `read` :

| URL | Contenu |
|---|---|
| `memory://root` | Résumé compact injecté au démarrage |
| `memory://root/MEMORY.md` | Document complet de mémoire à long terme |
| `memory://root/skills/<name>/SKILL.md` | Un playbook de compétence généré |

### Commande slash `/memory`

| Sous-commande | Effet |
|---|---|
| `view` | Afficher le contenu de mémoire actuellement injecté |
| `clear` / `reset` | Supprimer toutes les données mémoire et les artefacts générés |
| `enqueue` / `rebuild` | Forcer la consolidation à s'exécuter au prochain démarrage |

## Comment ça fonctionne

Les mémoires sont construites par un pipeline en arrière-plan qui s'exécute au démarrage ou est déclenché manuellement via une commande slash.

**Phase 1 — extraction par session :** Pour chaque session passée ayant changé depuis son dernier traitement, un modèle lit l'historique de la session et extrait le signal durable : décisions techniques, contraintes, échecs résolus, workflows récurrents. Les sessions trop récentes, trop anciennes ou actuellement actives sont ignorées. Chaque extraction produit un bloc mémoire brut et un court synopsis pour cette session.

**Phase 2 — consolidation :** Après l'extraction, une seconde passe de modèle lit toutes les extractions par session et produit trois sorties écrites sur le disque :

- `MEMORY.md` — un document de mémoire à long terme organisé
- `memory_summary.md` — le texte compact injecté au démarrage de la session
- `skills/` — des playbooks procéduraux réutilisables, chacun dans son propre sous-répertoire

La phase 2 utilise un bail pour empêcher une double exécution lorsque plusieurs processus démarrent simultanément. Les répertoires de compétences obsolètes des exécutions précédentes sont automatiquement élagués.

Toutes les sorties sont analysées pour détecter les secrets avant d'être écrites sur le disque.

### Comportement de l'extraction

Le comportement d'extraction et de consolidation de la mémoire est entièrement piloté par des fichiers de prompts statiques dans `src/prompts/memories/`.

| Fichier | Objectif | Variables |
|---|---|---|
| `stage_one_system.md` | Prompt système pour l'extraction par session | — |
| `stage_one_input.md` | Template côté utilisateur encapsulant le contenu de la session | `{{thread_id}}`, `{{response_items_json}}` |
| `consolidation.md` | Prompt pour la consolidation inter-sessions | `{{raw_memories}}`, `{{rollout_summaries}}` |
| `read_path.md` | Guidance mémoire injectée dans les sessions actives | `{{memory_summary}}` |

### Sélection du modèle

La mémoire s'appuie sur le système de rôles de modèle.

| Phase | Rôle | Objectif |
|---|---|---|
| Phase 1 (extraction) | `default` | Extraction de connaissances par session |
| Phase 2 (consolidation) | `smol` | Synthèse inter-sessions |

Si `smol` n'est pas configuré, la phase 2 se rabat sur le rôle `default`.

## Configuration

| Paramètre | Valeur par défaut | Description |
|---|---|---|
| `memories.enabled` | `false` | Interrupteur principal |
| `memories.maxRolloutAgeDays` | `30` | Les sessions plus anciennes que cette valeur ne sont pas traitées |
| `memories.minRolloutIdleHours` | `12` | Les sessions actives plus récemment que cette valeur sont ignorées |
| `memories.maxRolloutsPerStartup` | `64` | Limite de sessions traitées en un seul démarrage |
| `memories.summaryInjectionTokenLimit` | `5000` | Nombre maximal de tokens du résumé injecté dans le prompt système |

Des options de réglage supplémentaires (concurrence, durées de bail, budgets de tokens) sont disponibles dans la configuration pour un usage avancé.

## Fichiers clés

- `src/memories/index.ts` — orchestration du pipeline, injection, gestion des commandes slash
- `src/memories/storage.ts` — file d'attente de tâches et registre de threads adossés à SQLite
- `src/prompts/memories/` — templates de prompts mémoire
- `src/internal-urls/memory-protocol.ts` — gestionnaire d'URL `memory://`
