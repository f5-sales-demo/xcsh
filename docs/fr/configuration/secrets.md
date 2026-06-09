---
title: Obscurcissement des secrets
description: >-
  Pipeline d'obscurcissement des secrets qui masque les valeurs sensibles dans
  les journaux de session et les sorties.
sidebar:
  order: 3
  label: Secrets
i18n:
  sourceHash: 1d9dc101c614
  translator: machine
---

# Obscurcissement des secrets

Empêche les valeurs sensibles (clés API, jetons, mots de passe) d'être envoyées aux fournisseurs de LLM. Lorsqu'il est activé, les secrets sont remplacés par des espaces réservés déterministes avant de quitter le processus, et restaurés dans les arguments d'appel d'outils retournés par le modèle.

## Activation

Activé par défaut. Basculez via l'interface `/settings` ou directement dans `config.yml` :

```yaml
secrets:
  enabled: false
```

## Fonctionnement

1. Au démarrage de la session, les secrets sont collectés à partir de deux sources :
   - **Variables d'environnement** correspondant à des motifs courants de secrets (`*_KEY`, `*_SECRET`, `*_TOKEN`, `*_PASSWORD`, etc.) avec des valeurs >= 8 caractères
   - **Fichiers `secrets.yml`** (voir ci-dessous)

2. Les messages sortants vers le LLM voient toutes les valeurs secrètes remplacées par des espaces réservés comme `<<$env:S0>>`, `<<$env:S1>>`, etc.

3. Les arguments d'appel d'outils retournés par le modèle sont parcourus en profondeur et les espaces réservés sont restaurés à leurs valeurs originales avant exécution.

Deux modes contrôlent ce qui se passe pour chaque secret :

| Mode | Comportement | Réversible |
|---|---|---|
| `obfuscate` (par défaut) | Remplacé par un espace réservé indexé `<<$env:SN>>` | Oui (désobscurci dans les arguments d'outils) |
| `replace` | Remplacé par une chaîne déterministe de même longueur | Non (irréversible) |

## secrets.yml

Définissez des entrées de secrets personnalisées en YAML. Deux emplacements sont vérifiés :

| Niveau | Chemin | Objectif |
|---|---|---|
| Global | `~/.xcsh/agent/secrets.yml` | Secrets pour tous les projets |
| Projet | `<cwd>/.xcsh/secrets.yml` | Secrets spécifiques au projet |

Les entrées de projet remplacent les entrées globales ayant un `content` correspondant.

### Schéma

Chaque entrée du tableau possède les champs suivants :

| Champ | Type | Requis | Description |
|---|---|---|---|
| `type` | `"plain"` ou `"regex"` | Oui | Stratégie de correspondance |
| `content` | string | Oui | La valeur secrète (plain) ou le motif regex (regex) |
| `mode` | `"obfuscate"` ou `"replace"` | Non | Par défaut : `"obfuscate"` |
| `replacement` | string | Non | Remplacement personnalisé (mode replace uniquement) |
| `flags` | string | Non | Drapeaux regex (type regex uniquement) |

### Exemples

#### Secrets en texte brut

```yaml
# Obscurcir une clé API spécifique (mode par défaut)
- type: plain
  content: sk-proj-abc123def456

# Remplacer un mot de passe de base de données par une chaîne fixe
- type: plain
  content: hunter2
  mode: replace
  replacement: "********"
```

#### Secrets par regex

```yaml
# Obscurcir toute clé de style AWS
- type: regex
  content: "AKIA[0-9A-Z]{16}"

# Correspondance insensible à la casse avec des drapeaux explicites
- type: regex
  content: "api[_-]?key\\s*=\\s*\\w+"
  flags: "i"

# Syntaxe littérale regex (motif et drapeaux dans une seule chaîne)
- type: regex
  content: "/bearer\\s+[a-zA-Z0-9._~+\\/=-]+/i"
```

Les entrées regex effectuent toujours une recherche globale (le drapeau `g` est appliqué automatiquement). La syntaxe littérale regex `/motif/drapeaux` est prise en charge comme alternative aux champs séparés `content` + `flags`. Les barres obliques échappées dans le motif (`\\/`) sont gérées correctement.

#### Mode replace avec regex

```yaml
# Remplacement irréversible des chaînes de connexion (non réversible)
- type: regex
  content: "postgres://[^\\s]+"
  mode: replace
  replacement: "postgres://***"
```

## Interaction avec la détection des variables d'environnement

Les variables d'environnement sont toujours collectées en premier. Les entrées définies par fichier sont ajoutées ensuite, de sorte que les entrées de fichier peuvent couvrir des secrets qui ne se trouvent pas dans les variables d'environnement (fichiers de configuration, valeurs codées en dur, etc.). Si la même valeur apparaît dans les deux, le mode de l'entrée du fichier a la priorité.

## Fichiers clés

- `src/secrets/index.ts` -- chargement, fusion, collecte des variables d'environnement
- `src/secrets/obfuscator.ts` -- classe `SecretObfuscator`, génération d'espaces réservés, obscurcissement des messages
- `src/secrets/regex.ts` -- analyse et compilation des littéraux regex
- `src/config/settings-schema.ts` -- définition du paramètre `secrets.enabled`
