---
title: Secret Obfuscation
description: >-
  Pipeline di offuscamento dei segreti che oscura i valori sensibili dai log di
  sessione e dagli output.
sidebar:
  order: 3
  label: Secrets
i18n:
  sourceHash: 1d9dc101c614
  translator: machine
---

# Offuscamento dei Segreti

Impedisce che i valori sensibili (chiavi API, token, password) vengano inviati ai provider LLM. Quando abilitato, i segreti vengono sostituiti con segnaposto deterministici prima di lasciare il processo e ripristinati negli argomenti delle chiamate a tool restituiti dal modello.

## Abilitazione

Abilitato per impostazione predefinita. È possibile attivarlo/disattivarlo tramite l'interfaccia `/settings` o direttamente in `config.yml`:

```yaml
secrets:
  enabled: false
```

## Come funziona

1. All'avvio della sessione, i segreti vengono raccolti da due fonti:
   - **Variabili d'ambiente** che corrispondono a pattern comuni di segreti (`*_KEY`, `*_SECRET`, `*_TOKEN`, `*_PASSWORD`, ecc.) con valori >= 8 caratteri
   - **File `secrets.yml`** (vedi sotto)

2. I messaggi in uscita verso l'LLM hanno tutti i valori segreti sostituiti con segnaposto come `<<$env:S0>>`, `<<$env:S1>>`, ecc.

3. Gli argomenti delle chiamate a tool restituiti dal modello vengono percorsi in profondità e i segnaposto vengono ripristinati ai valori originali prima dell'esecuzione.

Due modalità controllano cosa succede a ciascun segreto:

| Modalità | Comportamento | Reversibile |
|---|---|---|
| `obfuscate` (predefinita) | Sostituito con segnaposto indicizzato `<<$env:SN>>` | Sì (deoffuscato negli argomenti dei tool) |
| `replace` | Sostituito con stringa deterministica della stessa lunghezza | No (irreversibile) |

## secrets.yml

Definisce voci di segreti personalizzate in YAML. Vengono controllate due posizioni:

| Livello | Percorso | Scopo |
|---|---|---|
| Globale | `~/.xcsh/agent/secrets.yml` | Segreti condivisi tra tutti i progetti |
| Progetto | `<cwd>/.xcsh/secrets.yml` | Segreti specifici del progetto |

Le voci del progetto sovrascrivono le voci globali con `content` corrispondente.

### Schema

Ogni elemento dell'array ha i seguenti campi:

| Campo | Tipo | Obbligatorio | Descrizione |
|---|---|---|---|
| `type` | `"plain"` o `"regex"` | Sì | Strategia di corrispondenza |
| `content` | string | Sì | Il valore del segreto (plain) o il pattern regex (regex) |
| `mode` | `"obfuscate"` o `"replace"` | No | Predefinito: `"obfuscate"` |
| `replacement` | string | No | Sostituzione personalizzata (solo modalità replace) |
| `flags` | string | No | Flag regex (solo tipo regex) |

### Esempi

#### Segreti plain

```yaml
# Offusca una chiave API specifica (modalità predefinita)
- type: plain
  content: sk-proj-abc123def456

# Sostituisce una password di database con una stringa fissa
- type: plain
  content: hunter2
  mode: replace
  replacement: "********"
```

#### Segreti regex

```yaml
# Offusca qualsiasi chiave in stile AWS
- type: regex
  content: "AKIA[0-9A-Z]{16}"

# Corrispondenza case-insensitive con flag espliciti
- type: regex
  content: "api[_-]?key\\s*=\\s*\\w+"
  flags: "i"

# Sintassi letterale regex (pattern e flag in un'unica stringa)
- type: regex
  content: "/bearer\\s+[a-zA-Z0-9._~+\\/=-]+/i"
```

Le voci regex eseguono sempre una scansione globale (il flag `g` viene applicato automaticamente). La sintassi letterale regex `/pattern/flags` è supportata come alternativa ai campi separati `content` + `flags`. Gli slash con escape all'interno del pattern (`\\/`) vengono gestiti correttamente.

#### Modalità replace con regex

```yaml
# Sostituzione irreversibile delle stringhe di connessione (non reversibile)
- type: regex
  content: "postgres://[^\\s]+"
  mode: replace
  replacement: "postgres://***"
```

## Interazione con il rilevamento delle variabili d'ambiente

Le variabili d'ambiente vengono sempre raccolte per prime. Le voci definite nei file vengono aggiunte successivamente, quindi le voci nei file possono coprire segreti che non risiedono nelle variabili d'ambiente (file di configurazione, valori hardcoded, ecc.). Se lo stesso valore appare in entrambi, la modalità della voce nel file ha la precedenza.

## File chiave

- `src/secrets/index.ts` -- caricamento, unione, raccolta variabili d'ambiente
- `src/secrets/obfuscator.ts` -- classe `SecretObfuscator`, generazione segnaposto, offuscamento messaggi
- `src/secrets/regex.ts` -- parsing e compilazione dei letterali regex
- `src/config/settings-schema.ts` -- definizione dell'impostazione `secrets.enabled`
