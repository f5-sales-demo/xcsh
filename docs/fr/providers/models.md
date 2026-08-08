---
title: Configuration des modèles et des fournisseurs
description: Registre de modèles et configuration de fournisseurs via models.yml avec routage, solution de repli (fallback) et tarification.
sidebar:
  order: 1
  label: Modèles et fournisseurs
i18n:
  sourceHash: "8053df967ff6"
  translator: "machine"
---

# Configuration des modèles et des fournisseurs (`models.yml`)

Ce document décrit comment l'agent de codage (coding-agent) charge actuellement les modèles, applique les remplacements (overrides), résout les informations d'identification (credentials) et choisit les modèles lors de l'exécution (runtime).

## Ce qui contrôle le comportement du modèle

Fichiers d'implémentation principaux :

- `src/config/model-registry.ts` — charge les modèles intégrés + personnalisés, les remplacements de fournisseurs, la découverte à l'exécution, l'intégration de l'authentification
- `src/config/model-resolver.ts` — analyse les modèles de recherche (patterns) et sélectionne les modèles initiaux/smol/lents (slow)
- `src/config/settings-schema.ts` — paramètres liés aux modèles (`modelRoles`, préférences de transport des fournisseurs)
- `src/session/auth-storage.ts` — ordre de résolution de la clé API + OAuth
- `packages/ai/src/models.ts` et `packages/ai/src/types.ts` — fournisseurs/modèles intégrés et types `Model`/`compat`

## Emplacement du fichier de configuration et comportement hérité (legacy)

Chemin de configuration par défaut :

- `~/.xcsh/agent/models.yml`

Comportement hérité toujours présent :

- Si `models.yml` est manquant et que `models.json` existe au même emplacement, il est migré vers `models.yml`.
- Les chemins de configuration explicites `.json` / `.jsonc` sont toujours pris en charge lorsqu'ils sont passés programmatiquement à `ModelRegistry`.

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

`equivalence` est optionnel et configure le regroupement canonique des modèles au-dessus des modèles concrets du fournisseur :

- `overrides` mappe un sélecteur concret exact (`provider/modelId`) vers un identifiant canonique officiel en amont (upstream)
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
        name: Modèle renommé
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

### Valeurs `api` autorisées pour le fournisseur/modèle

- `openai-completions`
- `openai-responses`
- `openai-codex-responses`
- `azure-openai-responses`
- `anthropic-messages`
- `google-generative-ai`
- `google-vertex`

### Valeurs `auth`/`discovery` autorisées

- `auth`: `apiKey` (par défaut) ou `none`
- `discovery.type`: `ollama`

## Règles de validation (actuelles)

### Fournisseur personnalisé complet (`models` n'est pas vide)

Requis :

- `baseUrl`
- `apiKey` sauf si `auth: none`
- `api` au niveau du fournisseur ou de chaque modèle

### Fournisseur avec remplacements uniquement (`models` manquant ou vide)

Doit définir au moins l'un des éléments suivants :

- `baseUrl`
- `modelOverrides`
- `discovery`

### Découverte (Discovery)

- `discovery` nécessite `api` au niveau du fournisseur.

### Vérifications des valeurs du modèle

- `id` requis
- `contextWindow` et `maxTokens` doivent être positifs s'ils sont fournis

## Ordre de fusion et de remplacement

Pipeline ModelRegistry (lors de l'actualisation) :

1. Charger les fournisseurs/modèles intégrés à partir de `@f5-sales-demo/pi-ai`.
2. Charger la configuration personnalisée `models.yml`.
3. Appliquer les remplacements de fournisseur (`baseUrl`, `headers`) aux modèles intégrés.
4. Appliquer `modelOverrides` (par fournisseur + identifiant de modèle).
5. Fusionner les `models` personnalisés :
   - même `provider + id` remplace l'existant
   - sinon, ajouter
6. Appliquer les modèles découverts à l'exécution (actuellement Ollama et LM Studio), puis réappliquer les remplacements de modèles.

## Équivalence canonique des modèles et regroupement

Le registre conserve chaque modèle de fournisseur concret, puis construit une couche canonique au-dessus d'eux.

Les identifiants canoniques sont uniquement des identifiants officiels en amont, par exemple :

- `claude-opus-4-6`
- `claude-haiku-4-5`
- `gpt-5.3-codex`

### Configuration de l'équivalence dans `models.yml`

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

1. remplacement utilisateur exact à partir de `equivalence.overrides`
2. correspondances d'identifiants officiels intégrés à partir des métadonnées du modèle
3. normalisation heuristique conservatrice pour les variantes de passerelle/fournisseur
4. repli sur le propre identifiant du modèle concret

Les heuristiques actuelles sont intentionnellement limitées :

- les préfixes amont intégrés peuvent être supprimés s'ils sont présents, par exemple `anthropic/...` ou `openai/...`
- les variantes de version avec des points et des tirets ne peuvent être normalisées que si elles correspondent à un identifiant officiel existant, par exemple `4.6 -> 4-6`
- les familles ou versions ambiguës ne sont pas fusionnées sans une correspondance intégrée ou un remplacement explicite

### Comportement de la résolution canonique

Lorsque plusieurs variantes concrètes partagent un identifiant canonique, la résolution utilise :

1. disponibilité et authentification
2. `config.yml` `modelProviderOrder`
3. ordre du registre/fournisseur existant si `modelProviderOrder` n'est pas défini

Les fournisseurs désactivés ou non authentifiés sont ignorés.

L'état de la session et les transcriptions continuent d'enregistrer le fournisseur/modèle concret qui a réellement exécuté le tour (turn).

Valeurs par défaut du fournisseur vs remplacements par modèle :

- Les `headers` du fournisseur sont la base.
- Les `headers` du modèle remplacent les clés d'en-tête du fournisseur.
- `modelOverrides` peut remplacer les métadonnées du modèle (`name`, `reasoning`, `input`, `cost`, `contextWindow`, `maxTokens`, `headers`, `compat`, `contextPromotionTarget`).
- `compat` est fusionné en profondeur (deep-merged) pour les blocs de routage imbriqués (`openRouterRouting`, `vercelGatewayRouting`, `extraBody`).

## Intégration de la découverte à l'exécution

### Découverte implicite Ollama

Si `ollama` n'est pas explicitement configuré, le registre ajoute un fournisseur découvrable implicite :

- provider : `ollama`
- api : `openai-completions`
- base URL : `OLLAMA_BASE_URL` ou `http://127.0.0.1:11434`
- mode d'authentification : sans clé (comportement `auth: none`)

La découverte à l'exécution appelle `GET /api/tags` sur Ollama et synthétise les entrées de modèles avec les valeurs par défaut locales.

### Découverte implicite llama.cpp

Si `llama.cpp` n'est pas explicitement configuré, le registre ajoute un fournisseur découvrable implicite :
Remarque : il utilise la nouvelle api anthropic messages au lieu de openai-completions.

- provider : `llama.cpp`
- api : `openai-responses`
- base URL : `LLAMA_CPP_BASE_URL` ou `http://127.0.0.1:8080`
- mode d'authentification : sans clé (comportement `auth: none`)

La découverte à l'exécution appelle `GET models` sur llama.cpp et synthétise les entrées de modèles avec les valeurs par défaut locales.

### Découverte implicite LM Studio

Si `lm-studio` n'est pas explicitement configuré, le registre ajoute un fournisseur découvrable implicite :

- provider : `lm-studio`
- api : `openai-completions`
- base URL : `LM_STUDIO_BASE_URL` ou `http://127.0.0.1:1234/v1`
- mode d'authentification : sans clé (comportement `auth: none`)

La découverte à l'exécution récupère les modèles (`GET /models`) et synthétise les entrées de modèles avec les valeurs par défaut locales.

### Découverte de fournisseur explicite

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

Les extensions peuvent enregistrer des fournisseurs à l'exécution (`pi.registerProvider(...)`), notamment :

- remplacement/ajout de modèles pour un fournisseur
- enregistrement de gestionnaire de flux personnalisé pour de nouveaux identifiants d'API
- enregistrement de fournisseur OAuth personnalisé

## Ordre de résolution de l'authentification et de la clé API

Lors de la demande d'une clé pour un fournisseur, l'ordre effectif est le suivant :

1. Remplacement à l'exécution (CLI `--api-key`)
2. Informations d'identification de clé API stockées dans `agent.db`
3. Informations d'identification OAuth stockées dans `agent.db` (avec actualisation)
4. Mappage des variables d'environnement (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc.)
5. Résolveur de secours (fallback) ModelRegistry (`apiKey` du fournisseur à partir de `models.yml`, sémantique nom d'environnement ou littéral)

Comportement de `apiKey` dans `models.yml` :

- La valeur est d'abord traitée comme un nom de variable d'environnement.
- Si aucune variable d'environnement n'existe, la chaîne littérale est utilisée comme jeton (token).

Si `authHeader: true` et que le `apiKey` du fournisseur est défini, les modèles obtiennent :

- En-tête `Authorization: Bearer <resolved-key>` injecté.

Fournisseurs sans clé :

- Les fournisseurs marqués `auth: none` sont traités comme disponibles sans informations d'identification.
- `getApiKey*` renvoie `kNoAuth` pour eux.

## Disponibilité des modèles vs tous les modèles

- `getAll()` renvoie le registre des modèles chargés (intégrés + personnalisés fusionnés + découverts).
- `getAvailable()` filtre les modèles pour ne conserver que ceux qui sont sans clé ou qui ont une authentification résolvable.

Un modèle peut donc exister dans le registre mais ne pas être sélectionnable tant que l'authentification n'est pas disponible.

## Résolution des modèles à l'exécution

### CLI et analyse de modèles (patterns)

`model-resolver.ts` prend en charge :

- `provider/modelId` exact
- identifiant de modèle canonique exact
- identifiant de modèle exact (fournisseur déduit)
- correspondance floue (fuzzy)/de sous-chaîne
- modèles de portée (glob patterns) dans `--models` (par ex. `openai/*`, `*sonnet*`)
- suffixe `:thinkingLevel` optionnel (`off|minimal|low|medium|high|xhigh`)

`--provider` est hérité (legacy) ; `--model` est préféré.

Priorité de résolution pour les sélecteurs exacts :

1. `provider/modelId` exact contourne le regroupement (coalescing)
2. l'identifiant canonique exact est résolu via l'index canonique
3. l'identifiant concret nu exact fonctionne toujours
4. la correspondance floue et les modèles globaux (glob patterns) s'exécutent après les chemins exacts

### Priorité de sélection du modèle initial

`findInitialModel(...)` utilise cet ordre :

1. fournisseur+modèle CLI explicite
2. premier modèle de portée (si ce n'est pas une reprise)
3. fournisseur/modèle par défaut enregistré
4. valeurs par défaut des fournisseurs connus (par ex. OpenAI/Anthropic/etc.) parmi les modèles disponibles
5. premier modèle disponible

### Alias de rôles et paramètres

Rôles de modèles pris en charge :

- `default`, `smol`, `slow`, `plan`, `commit`

Les alias de rôle comme `pi/smol` se développent via `settings.modelRoles`. Chaque valeur de rôle peut également ajouter un sélecteur de réflexion (thinking) tel que `:minimal`, `:low`, `:medium` ou `:high`.

Si un rôle pointe vers un autre rôle, le modèle cible hérite toujours normalement et tout suffixe explicite sur le rôle référent l'emporte pour cette utilisation spécifique au rôle.

Paramètres associés :

- `modelRoles` (enregistrement)
- `enabledModels` (liste de modèles à portée)
- `modelProviderOrder` (priorité canonique-fournisseur globale)
- `providers.kimiApiFormat` (format de requête `openai` ou `anthropic`)
- `providers.openaiWebsockets` (préférence de transport websocket `auto|off|on` pour OpenAI Codex)

`modelRoles` peut stocker soit :

- `provider/modelId` pour épingler une variante concrète d'un fournisseur
- un identifiant canonique tel que `gpt-5.3-codex` pour permettre le regroupement de fournisseurs

Pour `enabledModels` et le CLI `--models` :

- les identifiants canoniques exacts se développent vers toutes les variantes concrètes de ce groupe canonique
- les entrées `provider/modelId` explicites restent exactes
- les correspondances globales (globs) et floues (fuzzy) continuent d'opérer sur les modèles concrets

## `/model` et `--list-models`

Les deux interfaces gardent les modèles préfixés par le fournisseur visibles et sélectionnables.

Elles exposent désormais également les modèles canoniques/regroupés :

- `/model` inclut une vue canonique aux côtés des onglets des fournisseurs
- `--list-models` affiche une section canonique en plus des lignes concrètes des fournisseurs

La sélection d'une entrée canonique enregistre le sélecteur canonique. La sélection d'une ligne de fournisseur enregistre le `provider/modelId` explicite.

## Promotion de contexte (chaînes de repli au niveau du modèle)

La promotion de contexte est un mécanisme de récupération de dépassement (overflow) pour les variantes à petit contexte (par exemple `*-spark`) qui promeut automatiquement vers un modèle frère (sibling) à contexte plus grand lorsque l'API rejette une requête avec une erreur de longueur de contexte.

### Déclencheur et ordre

Lorsqu'un tour échoue avec une erreur de dépassement de contexte (par exemple `context_length_exceeded`), `AgentSession` tente une promotion **avant** de se replier sur la compaction :

1. Si `contextPromotion.enabled` est vrai (true), résoudre une cible de promotion (voir ci-dessous).
2. Si une cible est trouvée, basculer vers elle et relancer la requête — aucune compaction n'est nécessaire.
3. Si aucune cible n'est disponible, passer à la compaction automatique sur le modèle actuel.

### Sélection de la cible

La sélection est pilotée par le modèle, et non par le rôle :

1. `currentModel.contextPromotionTarget` (si configuré)
2. le plus petit modèle à contexte plus grand sur le même fournisseur + API

Les candidats sont ignorés à moins que les informations d'identification ne soient résolues (`ModelRegistry.getApiKey(...)`).

### Transfert websocket OpenAI Codex

Si le basculement se fait depuis/vers `openai-codex-responses`, la clé d'état du fournisseur de session `openai-codex-responses` est fermée avant le changement de modèle. Cela abandonne l'état du transport websocket afin que le tour suivant commence proprement sur le modèle promu.

### Comportement de persistance

La promotion utilise un basculement temporaire (`setModelTemporary`) :

- enregistré comme un `model_change` temporaire dans l'historique de la session
- ne réécrit pas le mappage de rôle enregistré

### Configuration de chaînes de repli explicites

Configurez le repli (fallback) directement dans les métadonnées du modèle via `contextPromotionTarget`.

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

Le générateur de modèles intégré l'attribue également automatiquement pour les modèles `*-spark` lorsqu'un modèle de base du même fournisseur existe.

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

### Point de terminaison (endpoint) local compatible OpenAI (sans authentification)

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

### Proxy hébergé avec clé basée sur l'environnement

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

### Remplacer la route du fournisseur intégré + les métadonnées du modèle

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

Lorsque les variables d'environnement `LITELLM_BASE_URL` et `LITELLM_API_KEY` sont toutes deux définies, xcsh gère automatiquement la configuration de `models.yml` pour le proxy LiteLLM.

### Génération automatique lors du premier lancement

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

Un `config.yml` par défaut est également généré avec des paramètres de fournisseur d'images judicieux.

### Auto-réparation au démarrage

À chaque démarrage, `startupHealthCheck()` dans le registre de modèles exécute les vérifications suivantes :

| Condition | Action |
|-----------|--------|
| `models.yml` manquant | Auto-générer à partir des variables d'environnement |
| `models.yml` corrompu ou impossible à analyser | Sauvegarder dans `.bak`, régénérer |
| `baseUrl` ne correspond pas à `LITELLM_BASE_URL` | Sauvegarder dans `.bak`, régénérer avec la nouvelle URL |
| `configVersion` manquant ou obsolète | Sauvegarder dans `.bak`, régénérer avec la version actuelle |
| La configuration est saine | Aucune action |

Toutes les réparations créent des sauvegardes `.bak` avant d'écraser. Toutes les opérations sont idempotentes.

### Commande CLI

```bash
xcsh setup litellm              # Générer ou réparer la configuration LiteLLM
xcsh setup litellm --check      # Valider sans écrire
xcsh setup litellm --check --json  # Sortie de validation lisible par machine
```

### Variables d'environnement requises

| Variable | Objectif |
|----------|---------|
| `LITELLM_BASE_URL` | URL du proxy LiteLLM (par ex. `https://your-proxy.example.com`). Doit commencer par `http://` ou `https://`. |
| `LITELLM_API_KEY` | Clé API pour le proxy. Référencée par son nom dans la configuration générée, résolue à l'exécution. |

Si l'une de ces variables n'est pas définie, la configuration automatique est ignorée silencieusement.

### Versionnement de la configuration

Les configurations générées incluent un champ `configVersion`. Lorsque le format généré change dans les versions futures, xcsh détecte les configurations obsolètes et les met à niveau automatiquement (avec sauvegarde).

### Mise en garde concernant les consommateurs hérités (Legacy consumer)

La plupart des configurations de modèles transitent désormais par `models.yml` via `ModelRegistry`.

Un chemin hérité notable demeure : la résolution de l'authentification Anthropic pour la recherche sur le Web (web-search) lit toujours `~/.xcsh/agent/models.json` directement dans `src/web/search/auth.ts`.

Si vous dépendez de ce chemin spécifique, gardez la compatibilité JSON à l'esprit jusqu'à ce que ce module soit migré.

## Mode de défaillance (Failure mode)

Si `models.yml` échoue aux vérifications de schéma ou de validation :

- Si `LITELLM_BASE_URL` et `LITELLM_API_KEY` sont définis, la vérification de santé (health check) au démarrage tente une auto-réparation (sauvegarder le fichier corrompu, régénérer à partir des variables d'environnement). Si la réparation réussit, le registre recharge la configuration corrigée.
- Si l'auto-réparation n'est pas possible (variables d'environnement non définies, échec d'écriture), le registre continue de fonctionner avec les modèles intégrés.
- L'erreur est exposée via `ModelRegistry.getError()` et remontée dans l'interface utilisateur/les notifications.
