---
title: Modell- und Provider-Konfiguration
description: Modell-Registry und Provider-Konfiguration über models.yml mit Routing, Fallback und Preisgestaltung.
sidebar:
  order: 1
  label: Modelle & Provider
i18n:
  sourceHash: "8053df967ff6"
  translator: "machine"
---

# Modell- und Provider-Konfiguration (`models.yml`)

Dieses Dokument beschreibt, wie der Coding-Agent aktuell Modelle lädt, Überschreibungen anwendet, Anmeldeinformationen auflöst und Modelle zur Laufzeit auswählt.

## Was das Modellverhalten steuert

Primäre Implementierungsdateien:

- `src/config/model-registry.ts` — lädt integrierte + benutzerdefinierte Modelle, Provider-Überschreibungen, Laufzeit-Erkennung, Auth-Integration
- `src/config/model-resolver.ts` — parst Modellmuster und wählt initial/smol/slow Modelle aus
- `src/config/settings-schema.ts` — modellbezogene Einstellungen (`modelRoles`, Provider-Transport-Präferenzen)
- `src/session/auth-storage.ts` — API-Schlüssel + OAuth-Auflösungsreihenfolge
- `packages/ai/src/models.ts` und `packages/ai/src/types.ts` — integrierte Provider/Modelle und `Model`/`compat` Typen

## Speicherort der Konfigurationsdatei und Legacy-Verhalten

Standard-Konfigurationspfad:

- `~/.xcsh/agent/models.yml`

Noch vorhandenes Legacy-Verhalten:

- Wenn `models.yml` fehlt und `models.json` am selben Speicherort existiert, wird sie nach `models.yml` migriert.
- Explizite `.json` / `.jsonc` Konfigurationspfade werden weiterhin unterstützt, wenn sie programmatisch an die `ModelRegistry` übergeben werden.

## `models.yml` Struktur

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

`configVersion` ist ein optionaler Integer-Wert, der vom Auto-Config-System geschrieben wird. Wenn vorhanden, verwendet xcsh ihn, um veraltete Konfigurationen zu erkennen und automatisch zu aktualisieren.

`provider-id` ist der kanonische Provider-Schlüssel, der für die Auswahl und Auth-Suche verwendet wird.

`equivalence` ist optional und konfiguriert die kanonische Modellgruppierung auf Basis konkreter Provider-Modelle:

- `overrides` bildet einen exakten konkreten Selektor (`provider/modelId`) auf eine offizielle kanonische Upstream-ID ab
- `exclude` nimmt einen konkreten Selektor von der kanonischen Gruppierung aus

## Provider-Ebene Felder

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

### Erlaubte Provider/Modell `api` Werte

- `openai-completions`
- `openai-responses`
- `openai-codex-responses`
- `azure-openai-responses`
- `anthropic-messages`
- `google-generative-ai`
- `google-vertex`

### Erlaubte Auth/Discovery Werte

- `auth`: `apiKey` (Standard) oder `none`
- `discovery.type`: `ollama`

## Validierungsregeln (aktuell)

### Vollständiger benutzerdefinierter Provider (`models` ist nicht leer)

Erforderlich:

- `baseUrl`
- `apiKey`, es sei denn `auth: none`
- `api` auf Provider-Ebene oder für jedes Modell

### Nur-Überschreiben Provider (`models` fehlt oder ist leer)

Muss mindestens eines definieren von:

- `baseUrl`
- `modelOverrides`
- `discovery`

### Discovery

- `discovery` erfordert `api` auf Provider-Ebene.

### Modell-Wert-Prüfungen

- `id` erforderlich
- `contextWindow` und `maxTokens` müssen positiv sein, falls angegeben

## Zusammenführungs- und Überschreibungsreihenfolge

ModelRegistry-Pipeline (beim Aktualisieren):

1. Lädt integrierte Provider/Modelle von `@f5-sales-demo/pi-ai`.
2. Lädt benutzerdefinierte `models.yml` Konfiguration.
3. Wendet Provider-Überschreibungen (`baseUrl`, `headers`) auf integrierte Modelle an.
4. Wendet `modelOverrides` an (pro Provider + Modell-ID).
5. Führt benutzerdefinierte `models` zusammen:
   - gleiche `provider + id` ersetzt vorhandenes
   - andernfalls anfügen
6. Wendet zur Laufzeit erkannte Modelle an (aktuell Ollama und LM Studio) und wendet dann Modell-Überschreibungen erneut an.

## Kanonische Modell-Äquivalenz und Zusammenführung

Die Registry behält jedes konkrete Provider-Modell und baut dann eine kanonische Schicht darüber auf.

Kanonische IDs sind nur offizielle Upstream-IDs, zum Beispiel:

- `claude-opus-4-6`
- `claude-haiku-4-5`
- `gpt-5.3-codex`

### `models.yml` Äquivalenz-Konfiguration

Beispiel:

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

Erstellungsreihenfolge für die kanonische Gruppierung:

1. exakte Benutzer-Überschreibung aus `equivalence.overrides`
2. gebündelte offizielle ID-Übereinstimmungen aus integrierten Modell-Metadaten
3. konservative heuristische Normalisierung für Gateway/Provider-Varianten
4. Rückgriff auf die eigene ID des konkreten Modells

Aktuelle Heuristiken sind absichtlich eng gefasst:

- eingebettete Upstream-Präfixe können entfernt werden, wenn sie vorhanden sind, zum Beispiel `anthropic/...` oder `openai/...`
- punktierte und gestrichelte Versionsvarianten können nur normalisiert werden, wenn sie auf eine existierende offizielle ID abgebildet werden, zum Beispiel `4.6 -> 4-6`
- mehrdeutige Familien oder Versionen werden ohne eine gebündelte Übereinstimmung oder explizite Überschreibung nicht zusammengeführt

### Kanonisches Auflösungsverhalten

Wenn mehrere konkrete Varianten sich eine kanonische ID teilen, verwendet die Auflösung:

1. Verfügbarkeit und Auth
2. `config.yml` `modelProviderOrder`
3. bestehende Registry/Provider-Reihenfolge, wenn `modelProviderOrder` nicht gesetzt ist

Deaktivierte oder nicht authentifizierte Provider werden übersprungen.

Sitzungsstatus und Transkripte zeichnen weiterhin den konkreten Provider/das Modell auf, der/das den Turn tatsächlich ausgeführt hat.

Provider-Standardwerte vs. pro-Modell Überschreibungen:

- Provider `headers` sind die Basis.
- Modell `headers` überschreiben Provider-Header-Schlüssel.
- `modelOverrides` kann Modell-Metadaten überschreiben (`name`, `reasoning`, `input`, `cost`, `contextWindow`, `maxTokens`, `headers`, `compat`, `contextPromotionTarget`).
- `compat` wird für verschachtelte Routing-Blöcke tief zusammengeführt (`openRouterRouting`, `vercelGatewayRouting`, `extraBody`).

## Integration der Laufzeit-Erkennung

### Implizite Ollama-Erkennung

Wenn `ollama` nicht explizit konfiguriert ist, fügt die Registry einen implizit erkennbaren Provider hinzu:

- Provider: `ollama`
- API: `openai-completions`
- Basis-URL: `OLLAMA_BASE_URL` oder `http://127.0.0.1:11434`
- Auth-Modus: schlüssellos (`auth: none` Verhalten)

Die Laufzeit-Erkennung ruft `GET /api/tags` auf Ollama auf und synthetisiert Modelleinträge mit lokalen Standardwerten.

### Implizite llama.cpp-Erkennung

Wenn `llama.cpp` nicht explizit konfiguriert ist, fügt die Registry einen implizit erkennbaren Provider hinzu:
Hinweis: Es wird die neuere Anthropic Messages API anstelle der openai-completions verwendet.

- Provider: `llama.cpp`
- API: `openai-responses`
- Basis-URL: `LLAMA_CPP_BASE_URL` oder `http://127.0.0.1:8080`
- Auth-Modus: schlüssellos (`auth: none` Verhalten)

Die Laufzeit-Erkennung ruft `GET models` auf llama.cpp auf und synthetisiert Modelleinträge mit lokalen Standardwerten.

### Implizite LM Studio-Erkennung

Wenn `lm-studio` nicht explizit konfiguriert ist, fügt die Registry einen implizit erkennbaren Provider hinzu:

- Provider: `lm-studio`
- API: `openai-completions`
- Basis-URL: `LM_STUDIO_BASE_URL` oder `http://127.0.0.1:1234/v1`
- Auth-Modus: schlüssellos (`auth: none` Verhalten)

Die Laufzeit-Erkennung ruft Modelle ab (`GET /models`) und synthetisiert Modelleinträge mit lokalen Standardwerten.

### Explizite Provider-Erkennung

Sie können die Erkennung selbst konfigurieren:

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

### Registrierung von Erweiterungs-Providern

Erweiterungen können Provider zur Laufzeit registrieren (`pi.registerProvider(...)`), einschließlich:

- Modell-Ersetzung/Anfügen für einen Provider
- benutzerdefinierte Stream-Handler-Registrierung für neue API-IDs
- benutzerdefinierte OAuth-Provider-Registrierung

## Auth- und API-Schlüssel-Auflösungsreihenfolge

Beim Anfordern eines Schlüssels für einen Provider ist die effektive Reihenfolge:

1. Laufzeit-Überschreibung (CLI `--api-key`)
2. Gespeicherte API-Schlüssel-Anmeldeinformationen in `agent.db`
3. Gespeicherte OAuth-Anmeldeinformationen in `agent.db` (mit Aktualisierung)
4. Umgebungsvariablen-Zuordnung (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, usw.)
5. ModelRegistry Fallback-Resolver (Provider `apiKey` aus `models.yml`, Env-Name-oder-Literal Semantik)

`models.yml` `apiKey` Verhalten:

- Der Wert wird zuerst als Name einer Umgebungsvariablen behandelt.
- Wenn keine Umgebungsvariable existiert, wird die literale Zeichenfolge als Token verwendet.

Wenn `authHeader: true` und der Provider `apiKey` gesetzt ist, erhalten Modelle:

- `Authorization: Bearer <resolved-key>` Header eingefügt.

Schlüssellose Provider:

- Provider, die mit `auth: none` markiert sind, werden als ohne Anmeldeinformationen verfügbar behandelt.
- `getApiKey*` gibt für sie `kNoAuth` zurück.

## Modellverfügbarkeit vs. alle Modelle

- `getAll()` gibt die geladene Modell-Registry zurück (integriert + zusammengeführt benutzerdefiniert + erkannt).
- `getAvailable()` filtert nach Modellen, die schlüssellos sind oder über eine auflösbare Authentifizierung verfügen.

Ein Modell kann also in der Registry existieren, aber nicht auswählbar sein, bis eine Authentifizierung verfügbar ist.

## Modellauflösung zur Laufzeit

### CLI und Muster-Parsing

`model-resolver.ts` unterstützt:

- exakte `provider/modelId`
- exakte kanonische Modell-ID
- exakte Modell-ID (Provider abgeleitet)
- Fuzzy-/Teilzeichenfolgen-Abgleich
- Glob-Scope-Muster in `--models` (z. B. `openai/*`, `*sonnet*`)
- optionales `:thinkingLevel` Suffix (`off|minimal|low|medium|high|xhigh`)

`--provider` ist Legacy; `--model` wird bevorzugt.

Auflösungspräzedenz für exakte Selektoren:

1. exakte `provider/modelId` umgeht die Zusammenführung
2. exakte kanonische ID wird über den kanonischen Index aufgelöst
3. exakte bloße konkrete ID funktioniert weiterhin
4. Fuzzy- und Glob-Abgleich werden nach den exakten Pfaden ausgeführt

### Priorität der initialen Modellauswahl

`findInitialModel(...)` verwendet diese Reihenfolge:

1. expliziter CLI-Provider+Modell
2. erstes Scoped-Modell (falls nicht fortgesetzt wird)
3. gespeicherter Standard-Provider/Modell
4. bekannte Provider-Standardwerte (z. B. OpenAI/Anthropic/usw.) unter den verfügbaren Modellen
5. erstes verfügbares Modell

### Rollen-Aliase und Einstellungen

Unterstützte Modellrollen:

- `default`, `smol`, `slow`, `plan`, `commit`

Rollen-Aliase wie `pi/smol` werden durch `settings.modelRoles` erweitert. Jeder Rollenwert kann auch einen Thinking-Selektor anhängen, wie z.B. `:minimal`, `:low`, `:medium` oder `:high`.

Wenn eine Rolle auf eine andere Rolle verweist, erbt das Zielmodell weiterhin normal und jedes explizite Suffix an der verweisenden Rolle hat für diese rollenspezifische Verwendung Vorrang.

Verwandte Einstellungen:

- `modelRoles` (Record)
- `enabledModels` (Scoped-Muster-Liste)
- `modelProviderOrder` (globale Präzedenz für kanonische Provider)
- `providers.kimiApiFormat` (`openai` oder `anthropic` Anfrageformat)
- `providers.openaiWebsockets` (`auto|off|on` Websocket-Präferenz für OpenAI Codex Transport)

`modelRoles` kann entweder folgendes speichern:

- `provider/modelId`, um eine konkrete Providervariante festzupinnen
- eine kanonische ID wie `gpt-5.3-codex`, um Provider-Zusammenführung zu ermöglichen

Für `enabledModels` und CLI `--models`:

- exakte kanonische IDs werden zu allen konkreten Varianten in dieser kanonischen Gruppe erweitert
- explizite `provider/modelId` Einträge bleiben exakt
- Globs und Fuzzy-Übereinstimmungen operieren weiterhin auf konkreten Modellen

## `/model` und `--list-models`

Beide Oberflächen halten Provider-präfigierte Modelle sichtbar und auswählbar.

Sie legen nun auch kanonische/zusammengeführte Modelle offen:

- `/model` enthält eine kanonische Ansicht neben den Provider-Tabs
- `--list-models` gibt einen kanonischen Abschnitt sowie die konkreten Provider-Zeilen aus

Die Auswahl eines kanonischen Eintrags speichert den kanonischen Selektor. Die Auswahl einer Provider-Zeile speichert die explizite `provider/modelId`.

## Context Promotion (Fallback-Ketten auf Modellebene)

Context Promotion ist ein Wiederherstellungsmechanismus bei Überlauf für Varianten mit kleinem Kontext (zum Beispiel `*-spark`), der automatisch auf ein Geschwistermodell mit größerem Kontext hochstuft, wenn die API eine Anfrage mit einem Fehler zur Kontextlänge ablehnt.

### Auslöser und Reihenfolge

Wenn ein Turn mit einem Kontextüberlauf-Fehler (z. B. `context_length_exceeded`) fehlschlägt, versucht `AgentSession` eine Hochstufung **bevor** auf Komprimierung zurückgegriffen wird:

1. Wenn `contextPromotion.enabled` auf `true` gesetzt ist, wird ein Ziel für die Hochstufung aufgelöst (siehe unten).
2. Wenn ein Ziel gefunden wird, wird dorthin gewechselt und die Anfrage erneut versucht — keine Komprimierung erforderlich.
3. Wenn kein Ziel verfügbar ist, wird zur automatischen Komprimierung auf dem aktuellen Modell übergegangen.

### Zielauswahl

Die Auswahl wird durch das Modell gesteuert, nicht durch die Rolle:

1. `currentModel.contextPromotionTarget` (falls konfiguriert)
2. kleinstes Modell mit größerem Kontext vom selben Provider + API

Kandidaten werden ignoriert, es sei denn, die Anmeldeinformationen werden aufgelöst (`ModelRegistry.getApiKey(...)`).

### OpenAI Codex Websocket-Übergabe

Beim Wechsel von/zu `openai-codex-responses` wird der Sitzungs-Provider-Status-Schlüssel `openai-codex-responses` vor dem Modellwechsel geschlossen. Dadurch wird der Websocket-Transportstatus verworfen, sodass der nächste Turn sauber auf dem hochgestuften Modell beginnt.

### Persistenzverhalten

Die Hochstufung verwendet temporäres Umschalten (`setModelTemporary`):

- als temporärer `model_change` im Sitzungsverlauf aufgezeichnet
- überschreibt das gespeicherte Rollen-Mapping nicht

### Konfigurieren expliziter Fallback-Ketten

Konfigurieren Sie den Fallback direkt in den Modell-Metadaten über `contextPromotionTarget`.

`contextPromotionTarget` akzeptiert entweder:

- `provider/model-id` (explizit)
- `model-id` (innerhalb des aktuellen Providers aufgelöst)

Beispiel (`models.yml`) für Spark -> nicht-Spark beim selben Provider:

```yaml
providers:
  openai-codex:
    modelOverrides:
      gpt-5.3-codex-spark:
        contextPromotionTarget: openai-codex/gpt-5.3-codex
```

Der integrierte Modell-Generator weist dies auch automatisch für `*-spark` Modelle zu, wenn ein Basismodell desselben Providers existiert.

## Kompatibilitäts- und Routing-Felder

`models.yml` unterstützt diese `compat` Teilmenge:

- `supportsStore`
- `supportsDeveloperRole`
- `supportsReasoningEffort`
- `maxTokensField` (`max_completion_tokens` oder `max_tokens`)
- `openRouterRouting.only` / `openRouterRouting.order`
- `vercelGatewayRouting.only` / `vercelGatewayRouting.order`

Diese werden von der OpenAI-Completions Transportlogik konsumiert und mit der URL-basierten automatischen Erkennung kombiniert.

## Praktische Beispiele

### Lokaler OpenAI-kompatibler Endpunkt (keine Authentifizierung)

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

### Gehosteter Proxy mit Env-basiertem Schlüssel

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

### Integrierte Provider-Route + Modell-Metadaten überschreiben

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

## Automatische Konfiguration des LiteLLM-Proxys

Wenn die Umgebungsvariablen `LITELLM_BASE_URL` und `LITELLM_API_KEY` gesetzt sind, verwaltet xcsh automatisch die `models.yml` Konfiguration für den LiteLLM-Proxy.

### Automatische Generierung beim ersten Start

Wenn `models.yml` nicht existiert und LiteLLM-Umgebungsvariablen erkannt werden, generiert xcsh sie automatisch:

```yaml
# Auto-generated by xcsh for LiteLLM proxy
# API key resolved from LITELLM_API_KEY env var at runtime
configVersion: 1
providers:
  anthropic:
    baseUrl: "https://your-litellm-proxy.example.com/anthropic"
    apiKey: LITELLM_API_KEY
```

Es wird auch eine standardmäßige `config.yml` mit sinnvollen Einstellungen für Image-Provider generiert.

### Selbstheilung beim Start

Bei jedem Start führt der `startupHealthCheck()` in der Modell-Registry die folgenden Prüfungen durch:

| Bedingung | Aktion |
|-----------|--------|
| `models.yml` fehlt | Automatisch aus Umgebungsvariablen generieren |
| `models.yml` beschädigt oder nicht parsbar | Backup als `.bak` speichern, neu generieren |
| `baseUrl` stimmt nicht mit `LITELLM_BASE_URL` überein | Backup als `.bak` speichern, mit neuer URL neu generieren |
| `configVersion` fehlt oder ist veraltet | Backup als `.bak` speichern, mit aktueller Version neu generieren |
| Konfiguration ist in Ordnung | Keine Aktion |

Alle Reparaturen erstellen `.bak` Backups vor dem Überschreiben. Alle Operationen sind idempotent.

### CLI-Befehl

```bash
xcsh setup litellm              # Generate or fix LiteLLM config
xcsh setup litellm --check      # Validate without writing
xcsh setup litellm --check --json  # Machine-readable validation output
```

### Erforderliche Umgebungsvariablen

| Variable | Zweck |
|----------|---------|
| `LITELLM_BASE_URL` | LiteLLM-Proxy-URL (z. B. `https://your-proxy.example.com`). Muss mit `http://` oder `https://` beginnen. |
| `LITELLM_API_KEY` | API-Schlüssel für den Proxy. In der generierten Konfiguration über den Namen referenziert, zur Laufzeit aufgelöst. |

Wenn eine der Variablen nicht gesetzt ist, wird die automatische Konfiguration stillschweigend übersprungen.

### Konfigurationsversionierung

Generierte Konfigurationen enthalten ein `configVersion` Feld. Wenn sich das generierte Format in zukünftigen Releases ändert, erkennt xcsh veraltete Konfigurationen und aktualisiert sie automatisch (mit Backup).

## Hinweis zu Legacy-Konsumenten

Die meiste Modellkonfiguration läuft jetzt über `models.yml` durch die `ModelRegistry`.

Ein bemerkenswerter Legacy-Pfad bleibt bestehen: Die Web-Such-Authentifizierungsauflösung für Anthropic liest weiterhin direkt `~/.xcsh/agent/models.json` in `src/web/search/auth.ts`.

Wenn Sie sich auf diesen spezifischen Pfad verlassen, behalten Sie die JSON-Kompatibilität im Hinterkopf, bis dieses Modul migriert ist.

## Fehlermodus

Wenn `models.yml` Schema- oder Validierungsprüfungen nicht besteht:

- Wenn `LITELLM_BASE_URL` und `LITELLM_API_KEY` gesetzt sind, versucht die Gesundheitsprüfung beim Start eine automatische Reparatur (beschädigte Datei als Backup speichern, aus Umgebungsvariablen neu generieren). Wenn die Reparatur erfolgreich ist, lädt die Registry die reparierte Konfiguration neu.
- Wenn eine automatische Reparatur nicht möglich ist (Umgebungsvariablen nicht gesetzt, Schreibfehler), arbeitet die Registry weiterhin mit den integrierten Modellen.
- Der Fehler wird über `ModelRegistry.getError()` offengelegt und in der Benutzeroberfläche/Benachrichtigungen angezeigt.
