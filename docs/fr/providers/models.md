---
title: Configuration des modèles et des fournisseurs
description: >-
  Registre de modèles et configuration des fournisseurs via models.yml avec
  routage, fallback et tarification.
sidebar:
  order: 1
  label: Modèles et fournisseurs
i18n:
  sourceHash: 5f72a90277a4
  translator: machine
---

# Configuration des modèles et des fournisseurs (`models.yml`)

Ce document décrit comment le coding-agent charge actuellement les modèles, applique les surcharges, résout les identifiants et choisit les modèles à l'exécution.

## Ce qui contrôle le comportement des modèles

Fichiers d'implémentation principaux :

- `src/config/model-registry.ts` — charge les modèles intégrés + personnalisés, les surcharges de fournisseurs, la découverte à l'exécution, l'intégration de l'authentification
- `src/config/model-resolver.ts` — analyse les patterns de modèles et sélectionne les modèles initial/smol/slow
- `src/config/settings-schema.ts` — paramètres liés aux modèles (`modelRoles`, préférences de transport des fournisseurs)
- `src/session/auth-storage.ts` — ordre de résolution des clés API + OAuth
- `packages/ai/src/models.ts` et `packages/ai/src/types.ts` — fournisseurs/modèles intégrés et types `Model`/`compat`

## Emplacement du fichier de configuration et comportement hérité

Chemin de configuration par défaut :

- `~/.xcsh/agent/models.yml`

Comportement hérité toujours présent :

- Si `models.yml` est absent et que `models.json` existe au même emplacement, il est migré vers `models.yml`.
- Les chemins de configuration explicites en `.json` / `.jsonc` sont toujours pris en charge lorsqu'ils sont passés programmatiquement à `ModelRegistry`.

## Structure de `models.yml`

```yaml
configVersion: 1  # optional — written by auto-config, used for migration detection
providers:
  <provider-id>:
    # provider-level config
equivalence:
  overrides:
    <provider-id>/<model-id>: <canonical-model-id>
  exclude:
    - <provider-id>/<model-id>
```

`configVersion` est un entier optionnel écrit par le système de configuration automatique. Lorsqu'il est présent, xcsh l'utilise pour détecter les configurations obsolètes et les mettre à jour automatiquement.

`provider-id` est la clé canonique du fournisseur utilisée pour la sélection et la recherche d'authentification.

`equivalence` est optionnel et configure le regroupement canonique des modèles au-dessus des modèles concrets des fournisseurs :

- `overrides` associe un sélecteur concret exact (`provider/modelId`) à un identifiant canonique officiel en amont
- `exclude` exclut un sélecteur concret du regroupement canonique

## Champs au niveau du fournisseur

```yaml
providers:
  my-provider:
    baseUrl: https://api.example.com/v1
    apiKey: MY_PROVIDER_API_KEY
    api: openai-completions
    headers:
      X-Team: platform
    authHeader: true
    auth: apiKey
    discovery:
      type: ollama
    modelOverrides:
      some-model-id:
        name: Renamed model
    models:
      - id: some-model-id
        name: Some Model
        api: openai-completions
        reasoning: false
        input: [text]
        cost:
          input: 0
          output: 0
          cacheRead: 0
          cacheWrite: 0
        contextWindow: 128000
        maxTokens: 16384
        headers:
          X-Model: value
        compat:
          supportsStore: true
          supportsDeveloperRole: true
          supportsReasoningEffort: true
          maxTokensField: max_completion_tokens
          openRouterRouting:
            only: [anthropic]
          vercelGatewayRouting:
            order: [anthropic, openai]
          extraBody:
            gateway: m1-01
            controller: mlx
```

### Valeurs `api` autorisées pour les fournisseurs/modèles

- `openai-completions`
- `openai-responses`
- `openai-codex-responses`
- `azure-openai-responses`
- `anthropic-messages`
- `google-generative-ai`
- `google-vertex`

### Valeurs autorisées pour auth/discovery

- `auth` : `apiKey` (par défaut) ou `none`
- `discovery.type` : `ollama`

## Règles de validation (actuelles)

### Fournisseur personnalisé complet (`models` non vide)

Requis :

- `baseUrl`
- `apiKey` sauf si `auth: none`
- `api` au niveau du fournisseur ou pour chaque modèle

### Fournisseur en surcharge uniquement (`models` absent ou vide)

Doit définir au moins l'un des éléments suivants :

- `baseUrl`
- `modelOverrides`
- `discovery`

### Découverte

- `discovery` nécessite `api` au niveau du fournisseur.

### Vérifications des valeurs des modèles

- `id` requis
- `contextWindow` et `maxTokens` doivent être positifs s'ils sont fournis

## Ordre de fusion et de surcharge

Pipeline de ModelRegistry (lors du rafraîchissement) :

1. Charger les fournisseurs/modèles intégrés depuis `@f5xc-salesdemos/pi-ai`.
2. Charger la configuration personnalisée `models.yml`.
3. Appliquer les surcharges de fournisseurs (`baseUrl`, `headers`) aux modèles intégrés.
4. Appliquer les `modelOverrides` (par fournisseur + identifiant de modèle).
5. Fusionner les `models` personnalisés :
   - même `provider + id` remplace l'existant
   - sinon, ajouter à la suite
6. Appliquer les modèles découverts à l'exécution (actuellement Ollama et LM Studio), puis réappliquer les surcharges de modèles.

## Équivalence canonique des modèles et coalescence

Le registre conserve chaque modèle concret de fournisseur puis construit une couche canonique au-dessus.

Les identifiants canoniques sont uniquement des identifiants officiels en amont, par exemple :

- `claude-opus-4-6`
- `claude-haiku-4-5`
- `gpt-5.3-codex`

### Configuration d'équivalence dans `models.yml`

Exemple :

```yaml
providers:
  zenmux:
    baseUrl: https://api.zenmux.example/v1
    apiKey: ZENMUX_API_KEY
    api: openai-codex-responses
    models:
      - id: codex
        name: Zenmux Codex
        reasoning: true
        input: [text]
        cost:
          input: 0
          output: 0
          cacheRead: 0
          cacheWrite: 0
        contextWindow: 200000
        maxTokens: 32768

equivalence:
  overrides:
    zenmux/codex: gpt-5.3-codex
    p-codex/codex: gpt-5.3-codex
  exclude:
    - demo/codex-preview
```

Ordre de construction pour le regroupement canonique :

1. surcharge utilisateur exacte depuis `equivalence.overrides`
2. correspondances d'identifiants officiels groupés depuis les métadonnées des modèles intégrés
3. normalisation heuristique conservatrice pour les variantes de passerelle/fournisseur
4. repli sur l'identifiant propre du modèle concret

Les heuristiques actuelles sont intentionnellement restrictives :

- les préfixes amont intégrés peuvent être supprimés lorsqu'ils sont présents, par exemple `anthropic/...` ou `openai/...`
- les variantes de version avec points et tirets ne peuvent être normalisées que lorsqu'elles correspondent à un identifiant officiel existant, par exemple `4.6 -> 4-6`
- les familles ou versions ambiguës ne sont pas fusionnées sans correspondance groupée ou surcharge explicite

### Comportement de la résolution canonique

Lorsque plusieurs variantes concrètes partagent un identifiant canonique, la résolution utilise :

1. disponibilité et authentification
2. `modelProviderOrder` dans `config.yml`
3. ordre existant du registre/fournisseur si `modelProviderOrder` n'est pas défini

Les fournisseurs désactivés ou non authentifiés sont ignorés.

L'état de session et les transcriptions continuent d'enregistrer le fournisseur/modèle concret qui a réellement exécuté le tour.

Valeurs par défaut du fournisseur vs surcharges par modèle :

- Les `headers` du fournisseur constituent la base.
- Les `headers` du modèle surchargent les clés d'en-tête du fournisseur.
- Les `modelOverrides` peuvent surcharger les métadonnées du modèle (`name`, `reasoning`, `input`, `cost`, `contextWindow`, `maxTokens`, `headers`, `compat`, `contextPromotionTarget`).
- `compat` est fusionné en profondeur pour les blocs de routage imbriqués (`openRouterRouting`, `vercelGatewayRouting`, `extraBody`).

## Intégration de la découverte à l'exécution

### Découverte implicite d'Ollama

Si `ollama` n'est pas explicitement configuré, le registre ajoute un fournisseur découvrable implicite :

- fournisseur : `ollama`
- api : `openai-completions`
- URL de base : `OLLAMA_BASE_URL` ou `http://127.0.0.1:11434`
- mode d'authentification : sans clé (comportement `auth: none`)

La découverte à l'exécution appelle `GET /api/tags` sur Ollama et synthétise des entrées de modèle avec les valeurs par défaut locales.

### Découverte implicite de llama.cpp

Si `llama.cpp` n'est pas explicitement configuré, le registre ajoute un fournisseur découvrable implicite :
Note : il utilise la nouvelle API anthropic messages au lieu de openai-completions.

- fournisseur : `llama.cpp`
- api : `openai-responses`
- URL de base : `LLAMA_CPP_BASE_URL` ou `http://127.0.0.1:8080`
- mode d'authentification : sans clé (comportement `auth: none`)

La découverte à l'exécution appelle `GET models` sur llama.cpp et synthétise des entrées de modèle avec les valeurs par défaut locales.

### Découverte implicite de LM Studio

Si `lm-studio` n'est pas explicitement configuré, le registre ajoute un fournisseur découvrable implicite :

- fournisseur : `lm-studio`
- api : `openai-completions`
- URL de base : `LM_STUDIO_BASE_URL` ou `http://127.0.0.1:1234/v1`
- mode d'authentification : sans clé (comportement `auth: none`)

La découverte à l'exécution récupère les modèles (`GET /models`) et synthétise des entrées de modèle avec les valeurs par défaut locales.

### Découverte explicite de fournisseur

Vous pouvez configurer la découverte vous-même :

```yaml
providers:
  ollama:
    baseUrl: http://127.0.0.1:11434
    api: openai-completions
    auth: none
    discovery:
      type: ollama
      
  llama.cpp:
    baseUrl: http://127.0.0.1:8080
    api: openai-responses
    auth: none
    discovery:
      type: llama.cpp
```

### Enregistrement de fournisseur par extension

Les extensions peuvent enregistrer des fournisseurs à l'exécution (`pi.registerProvider(...)`), incluant :

- remplacement/ajout de modèle pour un fournisseur
- enregistrement de gestionnaire de flux personnalisé pour de nouveaux identifiants d'API
- enregistrement de fournisseur OAuth personnalisé

## Ordre de résolution de l'authentification et des clés API

Lors de la demande d'une clé pour un fournisseur, l'ordre effectif est :

1. Surcharge à l'exécution (CLI `--api-key`)
2. Identifiant de clé API stocké dans `agent.db`
3. Identifiant OAuth stocké dans `agent.db` (avec rafraîchissement)
4. Correspondance de variable d'environnement (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc.)
5. Résolveur de repli de ModelRegistry (`apiKey` du fournisseur depuis `models.yml`, sémantique nom-d'env-ou-littéral)

Comportement de `apiKey` dans `models.yml` :

- La valeur est d'abord traitée comme un nom de variable d'environnement.
- Si aucune variable d'environnement n'existe, la chaîne littérale est utilisée comme jeton.

Si `authHeader: true` et que `apiKey` du fournisseur est défini, les modèles reçoivent :

- Un en-tête `Authorization: Bearer <clé-résolue>` injecté.

Fournisseurs sans clé :

- Les fournisseurs marqués `auth: none` sont considérés comme disponibles sans identifiants.
- `getApiKey*` retourne `kNoAuth` pour ceux-ci.

## Disponibilité des modèles vs tous les modèles

- `getAll()` retourne le registre de modèles chargé (intégrés + personnalisés fusionnés + découverts).
- `getAvailable()` filtre pour ne garder que les modèles sans clé ou avec une authentification résolvable.

Ainsi, un modèle peut exister dans le registre mais ne pas être sélectionnable tant que l'authentification n'est pas disponible.

## Résolution des modèles à l'exécution

### CLI et analyse de patterns

`model-resolver.ts` prend en charge :

- `provider/modelId` exact
- identifiant canonique de modèle exact
- identifiant de modèle exact (fournisseur déduit)
- correspondance floue/par sous-chaîne
- patterns glob dans `--models` (par ex. `openai/*`, `*sonnet*`)
- suffixe optionnel `:thinkingLevel` (`off|minimal|low|medium|high|xhigh`)

`--provider` est hérité ; `--model` est préféré.

Ordre de précédence pour les sélecteurs exacts :

1. `provider/modelId` exact contourne la coalescence
2. l'identifiant canonique exact est résolu via l'index canonique
3. l'identifiant concret nu exact fonctionne toujours
4. la correspondance floue et glob s'exécute après les chemins exacts

### Priorité de sélection du modèle initial

`findInitialModel(...)` utilise cet ordre :

1. fournisseur+modèle explicite en CLI
2. premier modèle dans la portée (si pas en reprise de session)
3. fournisseur/modèle par défaut sauvegardé
4. valeurs par défaut de fournisseurs connus (par ex. OpenAI/Anthropic/etc.) parmi les modèles disponibles
5. premier modèle disponible

### Alias de rôles et paramètres

Rôles de modèle pris en charge :

- `default`, `smol`, `slow`, `plan`, `commit`

Les alias de rôle comme `pi/smol` sont développés via `settings.modelRoles`. Chaque valeur de rôle peut également ajouter un sélecteur de réflexion tel que `:minimal`, `:low`, `:medium` ou `:high`.

Si un rôle pointe vers un autre rôle, le modèle cible hérite normalement et tout suffixe explicite sur le rôle référent l'emporte pour cette utilisation spécifique au rôle.

Paramètres associés :

- `modelRoles` (enregistrement)
- `enabledModels` (liste de patterns avec portée)
- `modelProviderOrder` (précédence globale fournisseur canonique)
- `providers.kimiApiFormat` (format de requête `openai` ou `anthropic`)
- `providers.openaiWebsockets` (préférence websocket `auto|off|on` pour le transport OpenAI Codex)

`modelRoles` peut stocker soit :

- `provider/modelId` pour épingler une variante de fournisseur concrète
- un identifiant canonique tel que `gpt-5.3-codex` pour permettre la coalescence des fournisseurs

Pour `enabledModels` et `--models` en CLI :

- les identifiants canoniques exacts sont développés vers toutes les variantes concrètes de ce groupe canonique
- les entrées explicites `provider/modelId` restent exactes
- les globs et correspondances floues opèrent toujours sur les modèles concrets

## `/model` et `--list-models`

Les deux interfaces gardent les modèles préfixés par le fournisseur visibles et sélectionnables.

Elles exposent désormais également les modèles canoniques/coalescés :

- `/model` inclut une vue canonique aux côtés des onglets par fournisseur
- `--list-models` affiche une section canonique plus les lignes concrètes par fournisseur

Sélectionner une entrée canonique stocke le sélecteur canonique. Sélectionner une ligne de fournisseur stocke le `provider/modelId` explicite.

## Promotion de contexte (chaînes de repli au niveau du modèle)

La promotion de contexte est un mécanisme de récupération de dépassement pour les variantes à petit contexte (par exemple `*-spark`) qui promeut automatiquement vers un modèle frère à plus grand contexte lorsque l'API rejette une requête avec une erreur de longueur de contexte.

### Déclenchement et ordre

Lorsqu'un tour échoue avec une erreur de dépassement de contexte (par ex. `context_length_exceeded`), `AgentSession` tente la promotion **avant** de recourir à la compaction :

1. Si `contextPromotion.enabled` est vrai, résoudre une cible de promotion (voir ci-dessous).
2. Si une cible est trouvée, basculer vers elle et réessayer la requête — aucune compaction nécessaire.
3. Si aucune cible n'est disponible, passer à la compaction automatique sur le modèle actuel.

### Sélection de la cible

La sélection est pilotée par le modèle, pas par le rôle :

1. `currentModel.contextPromotionTarget` (si configuré)
2. plus petit modèle à plus grand contexte sur le même fournisseur + API

Les candidats sont ignorés à moins que les identifiants ne soient résolus (`ModelRegistry.getApiKey(...)`).

### Transfert websocket OpenAI Codex

Si le basculement se fait depuis/vers `openai-codex-responses`, la clé d'état du fournisseur de session `openai-codex-responses` est fermée avant le changement de modèle. Cela supprime l'état du transport websocket afin que le prochain tour démarre proprement sur le modèle promu.

### Comportement de persistance

La promotion utilise un basculement temporaire (`setModelTemporary`) :

- enregistré comme un `model_change` temporaire dans l'historique de session
- ne réécrit pas la correspondance de rôle sauvegardée

### Configuration de chaînes de repli explicites

Configurez le repli directement dans les métadonnées du modèle via `contextPromotionTarget`.

`contextPromotionTarget` accepte soit :

- `provider/model-id` (explicite)
- `model-id` (résolu au sein du fournisseur actuel)

Exemple (`models.yml`) pour Spark -> non-Spark sur le même fournisseur :

```yaml
providers:
  openai-codex:
    modelOverrides:
      gpt-5.3-codex-spark:
        contextPromotionTarget: openai-codex/gpt-5.3-codex
```

Le générateur de modèles intégré attribue également ceci automatiquement pour les modèles `*-spark` lorsqu'un modèle de base du même fournisseur existe.

## Champs de compatibilité et de routage

`models.yml` prend en charge ce sous-ensemble `compat` :

- `supportsStore`
- `supportsDeveloperRole`
- `supportsReasoningEffort`
- `maxTokensField` (`max_completion_tokens` ou `max_tokens`)
- `openRouterRouting.only` / `openRouterRouting.order`
- `vercelGatewayRouting.only` / `vercelGatewayRouting.order`

Ceux-ci sont consommés par la logique de transport OpenAI-completions et combinés avec la détection automatique basée sur l'URL.

## Exemples pratiques

### Point de terminaison local compatible OpenAI (sans authentification)

```yaml
providers:
  local-openai:
    baseUrl: http://127.0.0.1:8000/v1
    auth: none
    api: openai-completions
    models:
      - id: Qwen/Qwen2.5-Coder-32B-Instruct
        name: Qwen 2.5 Coder 32B (local)
```

### Proxy hébergé avec clé basée sur une variable d'environnement

```yaml
providers:
  anthropic-proxy:
    baseUrl: https://proxy.example.com/anthropic
    apiKey: ANTHROPIC_PROXY_API_KEY
    api: anthropic-messages
    authHeader: true
    models:
      - id: claude-sonnet-4-20250514
        name: Claude Sonnet 4 (Proxy)
        reasoning: true
        input: [text, image]
```

### Surcharger la route d'un fournisseur intégré + métadonnées du modèle

```yaml
providers:
  openrouter:
    baseUrl: https://my-proxy.example.com/v1
    headers:
      X-Team: platform
    modelOverrides:
      anthropic/claude-sonnet-4:
        name: Sonnet 4 (Corp)
        compat:
          openRouterRouting:
            only: [anthropic]
```

## Configuration automatique du proxy LiteLLM

Lorsque les deux variables d'environnement `LITELLM_BASE_URL` et `LITELLM_API_KEY` sont définies, xcsh gère automatiquement la configuration de `models.yml` pour le proxy LiteLLM.

### Génération automatique au premier lancement

Si `models.yml` n'existe pas et que les variables d'environnement LiteLLM sont détectées, xcsh le génère automatiquement :

```yaml
# Auto-generated by xcsh for LiteLLM proxy
# API key resolved from LITELLM_API_KEY env var at runtime
configVersion: 1
providers:
  anthropic:
    baseUrl: "https://your-litellm-proxy.example.com/anthropic"
    apiKey: LITELLM_API_KEY
```

Un `config.yml` par défaut est également généré avec des paramètres de fournisseur d'images appropriés.

### Auto-réparation au démarrage

À chaque démarrage, `startupHealthCheck()` dans le registre des modèles effectue les vérifications suivantes :

| Condition | Action |
|-----------|--------|
| `models.yml` absent | Génération automatique à partir des variables d'environnement |
| `models.yml` corrompu ou non analysable | Sauvegarde en `.bak`, régénération |
| `baseUrl` ne correspond pas à `LITELLM_BASE_URL` | Sauvegarde en `.bak`, régénération avec la nouvelle URL |
| `configVersion` absent ou obsolète | Sauvegarde en `.bak`, régénération avec la version actuelle |
| Configuration saine | Aucune action |

Toutes les réparations créent des sauvegardes `.bak` avant l'écrasement. Toutes les opérations sont idempotentes.

### Commande CLI

```bash
xcsh setup litellm              # Generate or fix LiteLLM config
xcsh setup litellm --check      # Validate without writing
xcsh setup litellm --check --json  # Machine-readable validation output
```

### Variables d'environnement requises

| Variable | Objectif |
|----------|---------|
| `LITELLM_BASE_URL` | URL du proxy LiteLLM (par ex. `https://your-proxy.example.com`). Doit commencer par `http://` ou `https://`. |
| `LITELLM_API_KEY` | Clé API pour le proxy. Référencée par nom dans la configuration générée, résolue à l'exécution. |

Si l'une des variables n'est pas définie, la configuration automatique est silencieusement ignorée.

### Versionnement de la configuration

Les configurations générées incluent un champ `configVersion`. Lorsque le format généré change dans les versions futures, xcsh détecte les configurations obsolètes et les met à jour automatiquement (avec sauvegarde).

## Avertissement concernant les consommateurs hérités

La plupart de la configuration des modèles passe maintenant par `models.yml` via `ModelRegistry`.

Un chemin hérité notable subsiste : la résolution d'authentification Anthropic pour la recherche web lit toujours `~/.xcsh/agent/models.json` directement dans `src/web/search/auth.ts`.

Si vous dépendez de ce chemin spécifique, gardez la compatibilité JSON à l'esprit jusqu'à ce que ce module soit migré.

## Mode d'échec

Si `models.yml` échoue aux vérifications de schéma ou de validation :

- Si `LITELLM_BASE_URL` et `LITELLM_API_KEY` sont définies, la vérification de santé au démarrage tente une auto-réparation (sauvegarde du fichier corrompu, régénération à partir des variables d'environnement). Si la réparation réussit, le registre recharge la configuration corrigée.
- Si l'auto-réparation n'est pas possible (variables d'environnement non définies, échec d'écriture), le registre continue de fonctionner avec les modèles intégrés.
- L'erreur est exposée via `ModelRegistry.getError()` et affichée dans l'interface/les notifications.
