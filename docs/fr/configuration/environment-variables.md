---
title: Variables d'environnement
description: >-
  Référence des variables d'environnement d'exécution pour la configuration et
  le contrôle du comportement de xcsh.
sidebar:
  order: 2
  label: Variables d'environnement
i18n:
  sourceHash: 7baa9f5226ba
  translator: machine
---

# Variables d'environnement (Référence d'exécution actuelle)

Cette référence est dérivée des chemins de code actuels dans :

- `packages/coding-agent/src/**`
- `packages/ai/src/**` (résolution fournisseur/authentification utilisée par coding-agent)
- `packages/utils/src/**` et `packages/tui/src/**` lorsque ces variables affectent directement l'exécution de coding-agent

Elle ne documente que le comportement actif.

## Modèle de résolution et priorité

La plupart des recherches à l'exécution utilisent `$env` de `@f5xc-salesdemos/pi-utils` (`packages/utils/src/env.ts`).

Ordre de chargement de `$env` :

1. Environnement de processus existant (`Bun.env`)
2. `.env` du projet (`$PWD/.env`) pour les clés non déjà définies
3. `.env` du répertoire personnel (`~/.env`) pour les clés non déjà définies

Règle supplémentaire dans les fichiers `.env` : les clés `XCSH_*` sont dupliquées vers les clés `PI_*` lors de l'analyse.

---

## 1) Authentification modèle/fournisseur

Celles-ci sont consommées via `getEnvApiKey()` (`packages/ai/src/stream.ts`) sauf indication contraire.

### Identifiants des fournisseurs principaux

| Variable                        | Utilisée pour | Requise quand                                                 | Notes / priorité                                                                                  |
|---------------------------------|---|---------------------------------------------------------------|-----------------------------------------------------------------------------------------------------|
| `ANTHROPIC_OAUTH_TOKEN`         | Auth API Anthropic | Utilisation d'Anthropic avec authentification par jeton OAuth                         | Prend la priorité sur `ANTHROPIC_API_KEY` pour la résolution d'authentification du fournisseur                              |
| `ANTHROPIC_API_KEY`             | Auth API Anthropic | Utilisation d'Anthropic sans jeton OAuth                           | Solution de repli après `ANTHROPIC_OAUTH_TOKEN`                                                              |
| `ANTHROPIC_FOUNDRY_API_KEY`     | Anthropic via Azure Foundry / passerelle entreprise | `CLAUDE_CODE_USE_FOUNDRY` activé                             | Prend la priorité sur `ANTHROPIC_OAUTH_TOKEN` et `ANTHROPIC_API_KEY` quand le mode Foundry est activé  |
| `OPENAI_API_KEY`                | Auth OpenAI | Utilisation de fournisseurs de la famille OpenAI sans argument apiKey explicite | Utilisé par les fournisseurs OpenAI Completions/Responses                                                      |
| `GEMINI_API_KEY`                | Auth Google Gemini | Utilisation de modèles du fournisseur `google`                                | Clé primaire pour le mappage du fournisseur Gemini                                                             |
| `GOOGLE_API_KEY`                | Solution de repli auth outil image Gemini | Utilisation de l'outil `gemini_image` sans `GEMINI_API_KEY`            | Utilisé par le chemin de repli de l'outil image de coding-agent                                                       |
| `GROQ_API_KEY`                  | Auth Groq | Utilisation de modèles Groq                                             |                                                                                                     |
| `CEREBRAS_API_KEY`              | Auth Cerebras | Utilisation de modèles Cerebras                                         |                                                                                                     |
| `TOGETHER_API_KEY`              | Auth Together | Utilisation du fournisseur `together`                                     |                                                                                                     |
| `HUGGINGFACE_HUB_TOKEN`         | Auth Hugging Face | Utilisation du fournisseur `huggingface`                                  | Variable d'environnement primaire pour le jeton Hugging Face                                                                  |
| `HF_TOKEN`                      | Auth Hugging Face | Utilisation du fournisseur `huggingface`                                  | Solution de repli quand `HUGGINGFACE_HUB_TOKEN` n'est pas défini                                                      |
| `SYNTHETIC_API_KEY`             | Auth Synthetic | Utilisation de modèles Synthetic                                        |                                                                                                     |
| `NVIDIA_API_KEY`                | Auth NVIDIA | Utilisation du fournisseur `nvidia`                                       |                                                                                                     |
| `NANO_GPT_API_KEY`              | Auth NanoGPT | Utilisation du fournisseur `nanogpt`                                      |                                                                                                     |
| `VENICE_API_KEY`                | Auth Venice | Utilisation du fournisseur `venice`                                       |                                                                                                     |
| `LITELLM_API_KEY`               | Auth LiteLLM | Utilisation du fournisseur `litellm`                                      | Clé proxy LiteLLM compatible OpenAI. Quand définie avec `LITELLM_BASE_URL`, active la configuration automatique de `models.yml` |
| `LM_STUDIO_API_KEY`             | Auth LM Studio (optionnel) | Utilisation du fournisseur `lm-studio` avec des hôtes authentifiés           | LM Studio local fonctionne généralement sans auth ; tout jeton non vide fonctionne quand une clé est requise         |
| `OLLAMA_API_KEY`                | Auth Ollama (optionnel) | Utilisation du fournisseur `ollama` avec des hôtes authentifiés              | Ollama local fonctionne généralement sans auth ; tout jeton non vide fonctionne quand une clé est requise            |
| `LLAMA_CPP_API_KEY`             | Auth Ollama (optionnel) | Utilisation de `llama-server` avec le paramètre `--api-key`              | llama.cpp local fonctionne généralement sans auth ; tout jeton non vide fonctionne quand une clé est configurée       |
| `XIAOMI_API_KEY`                | Auth Xiaomi MiMo | Utilisation du fournisseur `xiaomi`                                       |                                                                                                     |
| `MOONSHOT_API_KEY`              | Auth Moonshot | Utilisation du fournisseur `moonshot`                                     |                                                                                                     |
| `XAI_API_KEY`                   | Auth xAI | Utilisation de modèles xAI                                              |                                                                                                     |
| `OPENROUTER_API_KEY`            | Auth OpenRouter | Utilisation de modèles OpenRouter                                       | Également utilisé par l'outil image quand le fournisseur préféré/auto est OpenRouter                                  |
| `MISTRAL_API_KEY`               | Auth Mistral | Utilisation de modèles Mistral                                          |                                                                                                     |
| `ZAI_API_KEY`                   | Auth z.ai | Utilisation de modèles z.ai                                             | Également utilisé par le fournisseur de recherche web z.ai                                                               |
| `MINIMAX_API_KEY`               | Auth MiniMax | Utilisation du fournisseur `minimax`                                      |                                                                                                     |
| `MINIMAX_CODE_API_KEY`          | Auth MiniMax Code | Utilisation du fournisseur `minimax-code`                                 |                                                                                                     |
| `MINIMAX_CODE_CN_API_KEY`       | Auth MiniMax Code CN | Utilisation du fournisseur `minimax-code-cn`                              |                                                                                                     |
| `OPENCODE_API_KEY`              | Auth OpenCode | Utilisation de modèles OpenCode                                         |                                                                                                     |
| `QIANFAN_API_KEY`               | Auth Qianfan | Utilisation du fournisseur `qianfan`                                      |                                                                                                     |
| `QWEN_OAUTH_TOKEN`              | Auth Qwen Portal | Utilisation de `qwen-portal` avec jeton OAuth                          | Prend la priorité sur `QWEN_PORTAL_API_KEY`                                                         |
| `QWEN_PORTAL_API_KEY`           | Auth Qwen Portal | Utilisation de `qwen-portal` avec clé API                              | Solution de repli après `QWEN_OAUTH_TOKEN`                                                                   |
| `ZENMUX_API_KEY`                | Auth ZenMux | Utilisation du fournisseur `zenmux`                                       | Utilisé pour les routes ZenMux compatibles OpenAI et Anthropic                                              |
| `VLLM_API_KEY`                  | Auth/découverte vLLM opt-in | Utilisation du fournisseur `vllm` (serveurs locaux compatibles OpenAI)       | Toute valeur non vide fonctionne pour les serveurs locaux sans auth                                                 |
| `CURSOR_ACCESS_TOKEN`           | Auth fournisseur Cursor | Utilisation du fournisseur Cursor                                         |                                                                                                     |
| `AI_GATEWAY_API_KEY`            | Auth Vercel AI Gateway | Utilisation du fournisseur `vercel-ai-gateway`                            |                                                                                                     |
| `CLOUDFLARE_AI_GATEWAY_API_KEY` | Auth Cloudflare AI Gateway | Utilisation du fournisseur `cloudflare-ai-gateway`                        | L'URL de base doit être configurée comme `https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/anthropic` |

### Chaînes de jetons GitHub/Copilot

| Variable | Utilisée pour | Chaîne |
|---|---|---|
| `COPILOT_GITHUB_TOKEN` | Auth fournisseur GitHub Copilot | `COPILOT_GITHUB_TOKEN` → `GH_TOKEN` → `GITHUB_TOKEN` |
| `GH_TOKEN` | Repli Copilot ; auth API GitHub dans le scraper web | Dans le scraper web : `GITHUB_TOKEN` → `GH_TOKEN` |
| `GITHUB_TOKEN` | Repli Copilot ; auth API GitHub dans le scraper web | Dans le scraper web : vérifié avant `GH_TOKEN` |

---

## 2) Configuration d'exécution spécifique aux fournisseurs

### Passerelle Anthropic Foundry (Azure / proxy entreprise)

Quand `CLAUDE_CODE_USE_FOUNDRY` est activé, les requêtes Anthropic passent en mode Foundry :

- L'URL de base est résolue depuis `FOUNDRY_BASE_URL` (le repli reste l'URL de base du modèle/par défaut si non défini).
- La résolution de clé API pour le fournisseur `anthropic` devient :
  `ANTHROPIC_FOUNDRY_API_KEY` → `ANTHROPIC_OAUTH_TOKEN` → `ANTHROPIC_API_KEY`.
- `ANTHROPIC_CUSTOM_HEADERS` est analysé comme des paires `clé: valeur` séparées par des virgules/sauts de ligne et fusionné dans les en-têtes de requête.
- Le matériel TLS client/serveur peut être injecté depuis les valeurs d'environnement :
  `NODE_EXTRA_CA_CERTS`, `CLAUDE_CODE_CLIENT_CERT`, `CLAUDE_CODE_CLIENT_KEY`.
  Chacun accepte soit :
  - un chemin de fichier système vers du contenu PEM, soit
  - du PEM en ligne (incluant les séquences `\n` échappées).

| Variable | Type de valeur | Comportement |
|---|---|---|
| `CLAUDE_CODE_USE_FOUNDRY` | Chaîne de type booléen (`1`, `true`, `yes`, `on`) | Active le mode Foundry pour le fournisseur Anthropic |
| `FOUNDRY_BASE_URL` | Chaîne URL | URL de base du point de terminaison Anthropic en mode Foundry |
| `ANTHROPIC_FOUNDRY_API_KEY` | Chaîne de jeton | Utilisé pour `Authorization: Bearer <token>` |
| `ANTHROPIC_CUSTOM_HEADERS` | Chaîne de liste d'en-têtes | En-têtes supplémentaires ; format `header-a: value, header-b: value` ou séparé par des sauts de ligne |
| `NODE_EXTRA_CA_CERTS` | Chemin PEM ou PEM en ligne | Chaîne CA supplémentaire pour la validation du certificat serveur |
| `CLAUDE_CODE_CLIENT_CERT` | Chemin PEM ou PEM en ligne | Certificat client mTLS |
| `CLAUDE_CODE_CLIENT_KEY` | Chemin PEM ou PEM en ligne | Clé privée client mTLS (doit être associée au certificat) |

### Amazon Bedrock

| Variable | Valeur par défaut / comportement |
|---|---|
| `AWS_REGION` | Source primaire de région |
| `AWS_DEFAULT_REGION` | Solution de repli si `AWS_REGION` non défini |
| `AWS_PROFILE` | Active le chemin d'authentification par profil nommé |
| `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` | Active le chemin d'authentification par clé IAM |
| `AWS_BEARER_TOKEN_BEDROCK` | Active le chemin d'authentification par jeton porteur |
| `AWS_CONTAINER_CREDENTIALS_RELATIVE_URI` / `AWS_CONTAINER_CREDENTIALS_FULL_URI` | Active le chemin d'identifiants de tâche ECS |
| `AWS_WEB_IDENTITY_TOKEN_FILE` + `AWS_ROLE_ARN` | Active le chemin d'authentification par identité web |
| `AWS_BEDROCK_SKIP_AUTH` | Si `1`, injecte des identifiants factices (scénarios proxy/sans auth) |
| `AWS_BEDROCK_FORCE_HTTP1` | Si `1`, force le gestionnaire de requêtes Node HTTP/1 |

Repli de région dans le code du fournisseur : `options.region` → `AWS_REGION` → `AWS_DEFAULT_REGION` → `us-east-1`.

### Azure OpenAI Responses

| Variable | Valeur par défaut / comportement |
|---|---|
| `AZURE_OPENAI_API_KEY` | Requis sauf si la clé API est passée en option |
| `AZURE_OPENAI_API_VERSION` | Par défaut `v1` |
| `AZURE_OPENAI_BASE_URL` | Remplacement direct de l'URL de base |
| `AZURE_OPENAI_RESOURCE_NAME` | Utilisé pour construire l'URL de base : `https://<resource>.openai.azure.com/openai/v1` |
| `AZURE_OPENAI_DEPLOYMENT_NAME_MAP` | Chaîne de mappage optionnelle : `modelId=deploymentName,model2=deployment2` |

Résolution de l'URL de base : option `azureBaseUrl` → env `AZURE_OPENAI_BASE_URL` → nom de ressource option/env → `model.baseUrl`.

### Google Vertex AI

| Variable | Requis ? | Notes |
|---|---|---|
| `GOOGLE_CLOUD_PROJECT` | Oui (sauf si passé dans les options) | Solution de repli : `GCLOUD_PROJECT` |
| `GCLOUD_PROJECT` | Solution de repli | Utilisé comme source alternative d'ID de projet |
| `GOOGLE_CLOUD_LOCATION` | Oui (sauf si passé dans les options) | Pas de valeur par défaut dans le fournisseur |
| `GOOGLE_APPLICATION_CREDENTIALS` | Conditionnel | Si défini, le fichier doit exister ; sinon le chemin de repli ADC est vérifié (`~/.config/gcloud/application_default_credentials.json`) |

### Kimi

| Variable | Valeur par défaut / comportement |
|---|---|
| `KIMI_CODE_OAUTH_HOST` | Remplacement primaire de l'hôte OAuth |
| `KIMI_OAUTH_HOST` | Remplacement de l'hôte OAuth en repli |
| `KIMI_CODE_BASE_URL` | Remplace l'URL de base du point de terminaison d'utilisation Kimi (`usage/kimi.ts`) |

Chaîne hôte OAuth : `KIMI_CODE_OAUTH_HOST` → `KIMI_OAUTH_HOST` → `https://auth.kimi.com`.

### Compatibilité Antigravity/image Gemini

| Variable | Valeur par défaut / comportement |
|---|---|
| `PI_AI_ANTIGRAVITY_VERSION` | Remplace le tag de version user-agent Antigravity dans le fournisseur Gemini CLI |

### Réponses OpenAI Codex (contrôles fonctionnalité/débogage)

| Variable | Comportement |
|---|---|
| `PI_CODEX_DEBUG` | `1`/`true` active la journalisation de débogage du fournisseur Codex |
| `PI_CODEX_WEBSOCKET` | `1`/`true` active la préférence de transport websocket |
| `PI_CODEX_WEBSOCKET_V2` | `1`/`true` active le chemin websocket v2 |
| `PI_CODEX_WEBSOCKET_IDLE_TIMEOUT_MS` | Remplacement par entier positif (par défaut 300000) |
| `PI_CODEX_WEBSOCKET_RETRY_BUDGET` | Remplacement par entier non négatif (par défaut 5) |
| `PI_CODEX_WEBSOCKET_RETRY_DELAY_MS` | Remplacement du délai de recul de base par entier positif (par défaut 500) |

### Débogage du fournisseur Cursor

| Variable | Comportement |
|---|---|
| `DEBUG_CURSOR` | Active les logs de débogage du fournisseur ; `2`/`verbose` pour des extraits détaillés de charge utile |
| `DEBUG_CURSOR_LOG` | Chemin de fichier optionnel pour la sortie de log de débogage JSONL |

### Commutateur de compatibilité du cache de prompts

| Variable | Comportement |
|---|---|
| `PI_CACHE_RETENTION` | Si `long`, active la rétention longue là où c'est supporté (`anthropic`, `openai-responses`, résolution de rétention Bedrock) |

---

## 3) Sous-système de recherche web

### Identifiants des fournisseurs de recherche

| Variable | Utilisée par |
|---|---|
| `EXA_API_KEY` | Fournisseur de recherche Exa et outils MCP Exa |
| `BRAVE_API_KEY` | Fournisseur de recherche Brave |
| `PERPLEXITY_API_KEY` | Fournisseur de recherche Perplexity en mode clé API |
| `TAVILY_API_KEY` | Fournisseur de recherche Tavily |
| `ZAI_API_KEY` | Fournisseur de recherche z.ai (vérifie également l'OAuth stocké dans `agent.db`) |
| `OPENAI_API_KEY` / OAuth Codex dans la BD | Disponibilité/auth du fournisseur de recherche Codex |

### Chaîne d'authentification de recherche web Anthropic

`packages/coding-agent/src/web/search/auth.ts` résout les identifiants de recherche web Anthropic dans cet ordre :

1. `ANTHROPIC_SEARCH_API_KEY` (+ optionnel `ANTHROPIC_SEARCH_BASE_URL`)
2. Entrée fournisseur `models.json` avec `api: "anthropic-messages"`
3. Identifiants OAuth Anthropic depuis `agent.db` (ne doit pas expirer dans un tampon de 5 minutes)
4. Repli générique env Anthropic : clé fournisseur (`ANTHROPIC_FOUNDRY_API_KEY`/`ANTHROPIC_OAUTH_TOKEN`/`ANTHROPIC_API_KEY`) + optionnel `ANTHROPIC_BASE_URL` (`FOUNDRY_BASE_URL` quand le mode Foundry est activé)

Variables associées :

| Variable | Valeur par défaut / comportement |
|---|---|
| `ANTHROPIC_SEARCH_API_KEY` | Clé de recherche explicite de priorité maximale |
| `ANTHROPIC_SEARCH_BASE_URL` | Par défaut `https://api.anthropic.com` quand omis |
| `ANTHROPIC_SEARCH_MODEL` | Par défaut `claude-haiku-4-5` |
| `ANTHROPIC_BASE_URL` | URL de base de repli générique pour le chemin d'auth de niveau 4 |

### Drapeau de comportement du flux OAuth Perplexity

| Variable | Comportement |
|---|---|
| `PI_AUTH_NO_BORROW` | Si défini, désactive le chemin d'emprunt de jeton d'application native macOS dans le flux de connexion Perplexity |

---

## 4) Outillage Python et exécution du noyau

| Variable | Valeur par défaut / comportement |
|---|---|
| `PI_PY` | Remplacement du mode outil Python : `0`/`bash`=`bash-only`, `1`/`py`=`ipy-only`, `mix`/`both`=`both` ; les valeurs invalides sont ignorées |
| `PI_PYTHON_SKIP_CHECK` | Si `1`, ignore les vérifications de disponibilité/préchauffage du noyau Python |
| `PI_PYTHON_GATEWAY_URL` | Si défini, utilise une passerelle de noyau externe au lieu de la passerelle partagée locale |
| `PI_PYTHON_GATEWAY_TOKEN` | Jeton d'authentification optionnel pour la passerelle externe (`Authorization: token <value>`) |
| `PI_PYTHON_IPC_TRACE` | Si `1`, active le chemin de trace IPC bas niveau dans le module noyau |
| `VIRTUAL_ENV` | Chemin venv de priorité maximale pour la résolution de l'environnement Python |

Comportement conditionnel supplémentaire :

- Si `BUN_ENV=test` ou `NODE_ENV=test`, les vérifications de disponibilité Python sont traitées comme OK et le préchauffage est ignoré.
- Le filtrage d'environnement Python refuse les clés API courantes et autorise les variables de base sûres + les préfixes `LC_`, `XDG_`, `PI_`.

---

## 5) Bascules de comportement agent/exécution

| Variable                   | Valeur par défaut / comportement                                                                           |
|----------------------------|----------------------------------------------------------------------------------------------|
| `PI_SMOL_MODEL`            | Remplacement éphémère de rôle de modèle pour `smol` (CLI `--smol` prend la priorité)                     |
| `PI_SLOW_MODEL`            | Remplacement éphémère de rôle de modèle pour `slow` (CLI `--slow` prend la priorité)                     |
| `PI_PLAN_MODEL`            | Remplacement éphémère de rôle de modèle pour `plan` (CLI `--plan` prend la priorité)                     |
| `PI_NO_TITLE`              | Si défini (toute valeur non vide), désactive la génération automatique de titre de session sur le premier message utilisateur   |
| `NULL_PROMPT`              | Si `true`, le constructeur de prompt système retourne une chaîne vide                                        |
| `PI_BLOCKED_AGENT`         | Bloque un type de sous-agent spécifique dans l'outil de tâche                                                 |
| `PI_SUBPROCESS_CMD`        | Remplace la commande de lancement de sous-agent (contournement de la résolution `xcsh` / `xcsh.cmd`)                       |
| `PI_TASK_MAX_OUTPUT_BYTES` | Octets de sortie capturés maximum par sous-agent (par défaut `500000`)                                    |
| `PI_TASK_MAX_OUTPUT_LINES` | Lignes de sortie capturées maximum par sous-agent (par défaut `5000`)                                      |
| `PI_TIMING`                | Si `1`, active les logs d'instrumentation de chronométrage démarrage/outil                                     |
| `PI_DEBUG_STARTUP`         | Active les impressions de débogage des étapes de démarrage vers stderr dans plusieurs chemins de démarrage                       |
| `PI_PACKAGE_DIR`           | Remplace la résolution du répertoire de base des ressources du paquet (recherche de chemin docs/exemples/changelog)            |
| `PI_DISABLE_LSPMUX`        | Si `1`, désactive la détection/intégration lspmux et force le lancement direct du serveur LSP          |
| `LITELLM_BASE_URL`         | URL de base du proxy LiteLLM. Quand défini avec `LITELLM_API_KEY`, déclenche la génération automatique de `models.yml` au premier lancement et l'auto-réparation à chaque démarrage |
| `LM_STUDIO_BASE_URL`       | Remplacement de l'URL de base de découverte implicite par défaut de LM Studio (`http://127.0.0.1:1234/v1` si non défini) |
| `OLLAMA_BASE_URL`          | Remplacement de l'URL de base de découverte implicite par défaut d'Ollama (`http://127.0.0.1:11434` si non défini)      |
| `LLAMA_CPP_BASE_URL`       | Remplacement de l'URL de base de découverte implicite par défaut de Llama.cpp (`http://127.0.0.1:8080` si non défini)    |
| `PI_EDIT_VARIANT`          | Si `hashline`, force le mode d'affichage hashline read/grep quand l'outil d'édition est disponible               |
| `PI_NO_PTY`                | Si `1`, désactive le chemin PTY interactif pour l'outil bash                                          |

`PI_NO_PTY` est également défini en interne quand CLI `--no-pty` est utilisé.

---

## 6) Chemins racine de stockage et configuration

Ceux-ci sont consommés via `@f5xc-salesdemos/pi-utils/dirs` et affectent l'emplacement de stockage des données de coding-agent.

| Variable | Valeur par défaut / comportement |
|---|---|
| `PI_CONFIG_DIR` | Nom du répertoire racine de configuration sous le répertoire personnel (par défaut `.xcsh`) |
| `PI_CODING_AGENT_DIR` | Remplacement complet du répertoire de l'agent (par défaut `~/<PI_CONFIG_DIR ou .xcsh>/agent`) |
| `PWD` | Utilisé lors de la correspondance du répertoire de travail canonique actuel dans les fonctions d'aide de chemin |

---

## 7) Environnement d'exécution shell/outil

(Depuis `packages/utils/src/procmgr.ts` et l'intégration de l'outil bash de coding-agent.)

| Variable | Comportement |
|---|---|
| `PI_BASH_NO_CI` | Supprime l'injection automatique de `CI=true` dans l'environnement shell lancé |
| `CLAUDE_BASH_NO_CI` | Alias hérité de repli pour `PI_BASH_NO_CI` |
| `PI_BASH_NO_LOGIN` | Destiné à désactiver le mode shell de connexion |
| `CLAUDE_BASH_NO_LOGIN` | Alias hérité de repli pour `PI_BASH_NO_LOGIN` |
| `PI_SHELL_PREFIX` | Préfixe de commande d'encapsulation optionnel |
| `CLAUDE_CODE_SHELL_PREFIX` | Alias hérité de repli pour `PI_SHELL_PREFIX` |
| `VISUAL` | Commande d'éditeur externe préféré |
| `EDITOR` | Commande d'éditeur externe de repli |

Note d'implémentation actuelle : `PI_BASH_NO_LOGIN`/`CLAUDE_BASH_NO_LOGIN` sont lus, mais le `getShellArgs()` actuel retourne `['-l','-c']` dans les deux branches (effectivement sans effet aujourd'hui).

---

## 8) Détection UI/thème/session (env auto-détecté)

Ceux-ci sont lus comme signaux d'exécution ; ils sont généralement définis par le terminal/OS plutôt que configurés manuellement.

| Variable | Utilisée pour |
|---|---|
| `COLORTERM`, `TERM`, `WT_SESSION` | Détection de capacité de couleur (mode couleur du thème) |
| `COLORFGBG` | Auto-détection clair/sombre de l'arrière-plan du terminal |
| `TERM_PROGRAM`, `TERM_PROGRAM_VERSION`, `TERMINAL_EMULATOR` | Identité du terminal dans le prompt/contexte système |
| `KDE_FULL_SESSION`, `XDG_CURRENT_DESKTOP`, `DESKTOP_SESSION`, `XDG_SESSION_DESKTOP`, `GDMSESSION`, `WINDOWMANAGER` | Détection bureau/gestionnaire de fenêtres dans le prompt/contexte système |
| `KITTY_WINDOW_ID`, `TMUX_PANE`, `TERM_SESSION_ID`, `WT_SESSION` | IDs de fil d'Ariane de session stables par terminal |
| `SHELL`, `ComSpec`, `TERM_PROGRAM`, `TERM` | Diagnostics d'informations système |
| `APPDATA`, `XDG_CONFIG_HOME` | Résolution de chemin de configuration lspmux |
| `HOME` | Raccourcissement de chemin dans l'UI de commande MCP |

---

## 9) Drapeaux de chargeur natif/débogage

| Variable | Comportement |
|---|---|
| `PI_DEV` | Active les diagnostics verbeux de chargement d'addon natif dans `packages/natives` |

## 10) Drapeaux d'exécution TUI (paquet partagé, affecte l'UX de coding-agent)

| Variable | Comportement |
|---|---|
| `PI_NOTIFICATIONS` | `off` / `0` / `false` supprime les notifications de bureau |
| `PI_TUI_WRITE_LOG` | Si défini, journalise les écritures TUI dans un fichier |
| `PI_HARDWARE_CURSOR` | Si `1`, active le mode curseur matériel |
| `PI_CLEAR_ON_SHRINK` | Si `1`, efface les lignes vides quand le contenu se réduit |
| `PI_DEBUG_REDRAW` | Si `1`, active la journalisation de débogage du redessin |
| `PI_TUI_DEBUG` | Si `1`, active le chemin de vidage de débogage approfondi TUI |

---

## 11) Contrôles de génération de commits

| Variable | Comportement |
|---|---|
| `PI_COMMIT_TEST_FALLBACK` | Si `true` (insensible à la casse), force le chemin de génération de repli de commit |
| `PI_COMMIT_NO_FALLBACK` | Si `true`, désactive le repli quand l'agent ne retourne aucune proposition |
| `PI_COMMIT_MAP_REDUCE` | Si `false`, désactive le chemin d'analyse de commit map-reduce |
| `DEBUG` | Si défini, les traces de pile d'erreurs de l'agent de commit sont affichées |

---

## Variables sensibles en matière de sécurité

Traitez celles-ci comme des secrets ; ne les journalisez pas et ne les committez pas :

- Clés API et identifiants OAuth/porteur des fournisseurs (toutes les `*_API_KEY`, `*_TOKEN`, jetons d'accès/rafraîchissement OAuth)
- Identifiants cloud (`AWS_*`, le chemin `GOOGLE_APPLICATION_CREDENTIALS` peut exposer du matériel de compte de service)
- Variables d'auth recherche/fournisseur (`EXA_API_KEY`, `BRAVE_API_KEY`, `PERPLEXITY_API_KEY`, clés de recherche Anthropic)
- Matériel mTLS Foundry (`CLAUDE_CODE_CLIENT_CERT`, `CLAUDE_CODE_CLIENT_KEY`, `NODE_EXTRA_CA_CERTS` quand il pointe vers des bundles CA privés)

L'environnement Python supprime également explicitement de nombreuses variables de clés courantes avant de lancer les sous-processus noyau (`packages/coding-agent/src/ipy/runtime.ts`).
