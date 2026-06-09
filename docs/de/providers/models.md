---
title: Modell- und Anbieterkonfiguration
description: >-
  Modellregistrierung und Anbieterkonfiguration über models.yml mit Routing,
  Fallback und Preisgestaltung.
sidebar:
  order: 1
  label: Modelle & Anbieter
i18n:
  sourceHash: 5f72a90277a4
  translator: machine
---

# Modell- und Anbieterkonfiguration (`models.yml`)

Dieses Dokument beschreibt, wie der Coding-Agent aktuell Modelle lädt, Überschreibungen anwendet, Anmeldedaten auflöst und Modelle zur Laufzeit auswählt.

## Was das Modellverhalten steuert

Primäre Implementierungsdateien:

- `src/config/model-registry.ts` — lädt eingebaute + benutzerdefinierte Modelle, Anbieter-Überschreibungen, Laufzeit-Erkennung, Auth-Integration
- `src/config/model-resolver.ts` — parst Modellmuster und wählt initial/smol/slow-Modelle
- `src/config/settings-schema.ts` — modellbezogene Einstellungen (`modelRoles`, Anbieter-Transportpräferenzen)
- `src/session/auth-storage.ts` — API-Schlüssel + OAuth-Auflösungsreihenfolge
- `packages/ai/src/models.ts` und `packages/ai/src/types.ts` — eingebaute Anbieter/Modelle und `Model`/`compat`-Typen

## Konfigurationsdatei-Speicherort und Legacy-Verhalten

Standardkonfigurationspfad:

- `~/.xcsh/agent/models.yml`

Legacy-Verhalten ist noch vorhanden:

- Wenn `models.yml` fehlt und `models.json` am selben Speicherort existiert, wird sie zu `models.yml` migriert.
- Explizite `.json`- / `.jsonc`-Konfigurationspfade werden weiterhin unterstützt, wenn sie programmatisch an `ModelRegistry` übergeben werden.

## `models.yml`-Struktur

```yaml
configVersion: 1  # optional — wird von auto-config geschrieben, für Migrationserkennung verwendet
providers:
  <provider-id>:
    # Konfiguration auf Anbieterebene
equivalence:
  overrides:
    <provider-id>/<model-id>: <canonical-model-id>
  exclude:
    - <provider-id>/<model-id>
```

`configVersion` ist eine optionale Ganzzahl, die vom Auto-Config-System geschrieben wird. Wenn vorhanden, verwendet xcsh sie zur Erkennung veralteter Konfigurationen und zum automatischen Upgrade.

`provider-id` ist der kanonische Anbieterschlüssel, der über Auswahl und Auth-Lookup hinweg verwendet wird.

`equivalence` ist optional und konfiguriert kanonische Modellgruppierung über konkreten Anbietermodellen:

- `overrides` ordnet einen exakten konkreten Selektor (`provider/modelId`) einer offiziellen kanonischen Upstream-ID zu
- `exclude` schließt einen konkreten Selektor von der kanonischen Gruppierung aus

## Felder auf Anbieterebene

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

### Erlaubte `api`-Werte für Anbieter/Modell

- `openai-completions`
- `openai-responses`
- `openai-codex-responses`
- `azure-openai-responses`
- `anthropic-messages`
- `google-generative-ai`
- `google-vertex`

### Erlaubte auth/discovery-Werte

- `auth`: `apiKey` (Standard) oder `none`
- `discovery.type`: `ollama`

## Validierungsregeln (aktuell)

### Vollständiger benutzerdefinierter Anbieter (`models` ist nicht leer)

Erforderlich:

- `baseUrl`
- `apiKey` es sei denn `auth: none`
- `api` auf Anbieterebene oder pro Modell

### Nur-Überschreibungs-Anbieter (`models` fehlt oder ist leer)

Muss mindestens eines der folgenden definieren:

- `baseUrl`
- `modelOverrides`
- `discovery`

### Discovery

- `discovery` erfordert `api` auf Anbieterebene.

### Modellwert-Prüfungen

- `id` erforderlich
- `contextWindow` und `maxTokens` müssen positiv sein, wenn angegeben

## Zusammenführungs- und Überschreibungsreihenfolge

ModelRegistry-Pipeline (bei Aktualisierung):

1. Eingebaute Anbieter/Modelle aus `@f5xc-salesdemos/pi-ai` laden.
2. Benutzerdefinierte Konfiguration aus `models.yml` laden.
3. Anbieter-Überschreibungen (`baseUrl`, `headers`) auf eingebaute Modelle anwenden.
4. `modelOverrides` anwenden (pro Anbieter + Modell-ID).
5. Benutzerdefinierte `models` zusammenführen:
   - gleiche `provider + id` ersetzt vorhandene
   - andernfalls anhängen
6. Zur Laufzeit erkannte Modelle anwenden (aktuell Ollama und LM Studio), dann Modell-Überschreibungen erneut anwenden.

## Kanonische Modelläquivalenz und Zusammenfassung

Die Registry behält jedes konkrete Anbietermodell und baut dann eine kanonische Schicht darüber auf.

Kanonische IDs sind ausschließlich offizielle Upstream-IDs, zum Beispiel:

- `claude-opus-4-6`
- `claude-haiku-4-5`
- `gpt-5.3-codex`

### `models.yml` Äquivalenzkonfiguration

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

Aufbaureihenfolge für kanonische Gruppierung:

1. Exakte Benutzerüberschreibung aus `equivalence.overrides`
2. Gebündelte offizielle-ID-Übereinstimmungen aus eingebauten Modell-Metadaten
3. Konservative heuristische Normalisierung für Gateway/Anbieter-Varianten
4. Fallback auf die eigene ID des konkreten Modells

Aktuelle Heuristiken sind absichtlich eng gefasst:

- Eingebettete Upstream-Präfixe können entfernt werden, wenn vorhanden, zum Beispiel `anthropic/...` oder `openai/...`
- Punkt- und Bindestrich-Versionsvarianten können nur normalisiert werden, wenn sie auf eine existierende offizielle ID abgebildet werden, zum Beispiel `4.6 -> 4-6`
- Mehrdeutige Familien oder Versionen werden ohne gebündelte Übereinstimmung oder explizite Überschreibung nicht zusammengeführt

### Kanonisches Auflösungsverhalten

Wenn mehrere konkrete Varianten eine kanonische ID teilen, verwendet die Auflösung:

1. Verfügbarkeit und Auth
2. `config.yml` `modelProviderOrder`
3. Bestehende Registry/Anbieter-Reihenfolge, wenn `modelProviderOrder` nicht gesetzt ist

Deaktivierte oder nicht authentifizierte Anbieter werden übersprungen.

Sitzungsstatus und Transkripte zeichnen weiterhin den konkreten Anbieter/das Modell auf, das den Turn tatsächlich ausgeführt hat.

Anbieter-Standardwerte vs. modellspezifische Überschreibungen:

- Anbieter-`headers` sind die Basislinie.
- Modell-`headers` überschreiben Anbieter-Header-Schlüssel.
- `modelOverrides` können Modell-Metadaten überschreiben (`name`, `reasoning`, `input`, `cost`, `contextWindow`, `maxTokens`, `headers`, `compat`, `contextPromotionTarget`).
- `compat` wird für verschachtelte Routing-Blöcke tief zusammengeführt (`openRouterRouting`, `vercelGatewayRouting`, `extraBody`).

## Laufzeit-Discovery-Integration

### Implizite Ollama-Discovery

Wenn `ollama` nicht explizit konfiguriert ist, fügt die Registry einen implizit erkennbaren Anbieter hinzu:

- Anbieter: `ollama`
- API: `openai-completions`
- Basis-URL: `OLLAMA_BASE_URL` oder `http://127.0.0.1:11434`
- Auth-Modus: schlüssellos (`auth: none`-Verhalten)

Die Laufzeit-Discovery ruft `GET /api/tags` auf Ollama auf und synthetisiert Modelleinträge mit lokalen Standardwerten.

### Implizite llama.cpp-Discovery

Wenn `llama.cpp` nicht explizit konfiguriert ist, fügt die Registry einen implizit erkennbaren Anbieter hinzu:
Hinweis: Es wird die neuere Anthropic Messages API anstelle der openai-completions verwendet.

- Anbieter: `llama.cpp`
- API: `openai-responses`
- Basis-URL: `LLAMA_CPP_BASE_URL` oder `http://127.0.0.1:8080`
- Auth-Modus: schlüssellos (`auth: none`-Verhalten)

Die Laufzeit-Discovery ruft `GET models` auf llama.cpp auf und synthetisiert Modelleinträge mit lokalen Standardwerten.

### Implizite LM Studio-Discovery

Wenn `lm-studio` nicht explizit konfiguriert ist, fügt die Registry einen implizit erkennbaren Anbieter hinzu:

- Anbieter: `lm-studio`
- API: `openai-completions`
- Basis-URL: `LM_STUDIO_BASE_URL` oder `http://127.0.0.1:1234/v1`
- Auth-Modus: schlüssellos (`auth: none`-Verhalten)

Die Laufzeit-Discovery ruft Modelle ab (`GET /models`) und synthetisiert Modelleinträge mit lokalen Standardwerten.

### Explizite Anbieter-Discovery

Sie können Discovery selbst konfigurieren:

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

### Erweiterungsanbieter-Registrierung

Erweiterungen können Anbieter zur Laufzeit registrieren (`pi.registerProvider(...)`), einschließlich:

- Modell-Ersetzung/Anhängen für einen Anbieter
- Registrierung benutzerdefinierter Stream-Handler für neue API-IDs
- Registrierung benutzerdefinierter OAuth-Anbieter

## Auth- und API-Schlüssel-Auflösungsreihenfolge

Beim Anfordern eines Schlüssels für einen Anbieter ist die effektive Reihenfolge:

1. Laufzeit-Überschreibung (CLI `--api-key`)
2. Gespeicherte API-Schlüssel-Anmeldedaten in `agent.db`
3. Gespeicherte OAuth-Anmeldedaten in `agent.db` (mit Aktualisierung)
4. Umgebungsvariablen-Zuordnung (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc.)
5. ModelRegistry-Fallback-Resolver (Anbieter-`apiKey` aus `models.yml`, Env-Name-oder-Literal-Semantik)

`models.yml` `apiKey`-Verhalten:

- Der Wert wird zuerst als Umgebungsvariablenname behandelt.
- Wenn keine Umgebungsvariable existiert, wird der literale String als Token verwendet.

Wenn `authHeader: true` und Anbieter-`apiKey` gesetzt ist, erhalten Modelle:

- `Authorization: Bearer <aufgelöster-schlüssel>` Header injiziert.

Schlüssellose Anbieter:

- Anbieter mit `auth: none` werden als ohne Anmeldedaten verfügbar behandelt.
- `getApiKey*` gibt für sie `kNoAuth` zurück.

## Modellverfügbarkeit vs. alle Modelle

- `getAll()` gibt die geladene Modell-Registry zurück (eingebaut + zusammengeführt benutzerdefiniert + erkannt).
- `getAvailable()` filtert auf Modelle, die schlüssellos sind oder auflösbare Auth haben.

Ein Modell kann also in der Registry existieren, aber nicht auswählbar sein, bis Auth verfügbar ist.

## Laufzeit-Modellauflösung

### CLI und Muster-Parsing

`model-resolver.ts` unterstützt:

- Exaktes `provider/modelId`
- Exakte kanonische Modell-ID
- Exakte Modell-ID (Anbieter wird abgeleitet)
- Fuzzy/Teilstring-Abgleich
- Glob-Bereichsmuster in `--models` (z.B. `openai/*`, `*sonnet*`)
- Optionales `:thinkingLevel`-Suffix (`off|minimal|low|medium|high|xhigh`)

`--provider` ist veraltet; `--model` wird bevorzugt.

Auflösungspriorität für exakte Selektoren:

1. Exaktes `provider/modelId` umgeht die Zusammenfassung
2. Exakte kanonische ID wird über den kanonischen Index aufgelöst
3. Exakte nackte konkrete ID funktioniert weiterhin
4. Fuzzy- und Glob-Abgleich werden nach den exakten Pfaden ausgeführt

### Priorität bei der initialen Modellauswahl

`findInitialModel(...)` verwendet diese Reihenfolge:

1. Expliziter CLI-Anbieter+Modell
2. Erstes Bereichsmodell (wenn keine Wiederaufnahme)
3. Gespeicherter Standard-Anbieter/Modell
4. Bekannte Anbieter-Standardwerte (z.B. OpenAI/Anthropic/etc.) unter verfügbaren Modellen
5. Erstes verfügbares Modell

### Rollenaliase und Einstellungen

Unterstützte Modellrollen:

- `default`, `smol`, `slow`, `plan`, `commit`

Rollenaliase wie `pi/smol` werden über `settings.modelRoles` expandiert. Jeder Rollenwert kann auch einen Thinking-Selektor wie `:minimal`, `:low`, `:medium` oder `:high` anhängen.

Wenn eine Rolle auf eine andere Rolle zeigt, erbt das Zielmodell normal und jedes explizite Suffix der verweisenden Rolle gewinnt für diese rollenspezifische Verwendung.

Verwandte Einstellungen:

- `modelRoles` (Record)
- `enabledModels` (Bereichsmusterliste)
- `modelProviderOrder` (globale kanonische Anbieter-Rangfolge)
- `providers.kimiApiFormat` (`openai` oder `anthropic` Anforderungsformat)
- `providers.openaiWebsockets` (`auto|off|on` WebSocket-Präferenz für OpenAI Codex-Transport)

`modelRoles` kann Folgendes speichern:

- `provider/modelId` um eine konkrete Anbietervariante festzulegen
- Eine kanonische ID wie `gpt-5.3-codex` um Anbieter-Zusammenfassung zu ermöglichen

Für `enabledModels` und CLI `--models`:

- Exakte kanonische IDs werden auf alle konkreten Varianten in dieser kanonischen Gruppe expandiert
- Explizite `provider/modelId`-Einträge bleiben exakt
- Globs und Fuzzy-Abgleiche arbeiten weiterhin auf konkreten Modellen

## `/model` und `--list-models`

Beide Oberflächen halten anbieter-präfixierte Modelle sichtbar und auswählbar.

Sie zeigen jetzt auch kanonische/zusammengefasste Modelle an:

- `/model` enthält eine kanonische Ansicht neben Anbieter-Tabs
- `--list-models` gibt einen kanonischen Abschnitt plus die konkreten Anbieterzeilen aus

Die Auswahl eines kanonischen Eintrags speichert den kanonischen Selektor. Die Auswahl einer Anbieterzeile speichert das explizite `provider/modelId`.

## Kontextpromotion (Fallback-Ketten auf Modellebene)

Kontextpromotion ist ein Überlauf-Wiederherstellungsmechanismus für Varianten mit kleinem Kontext (zum Beispiel `*-spark`), der automatisch auf ein Geschwistermodell mit größerem Kontext hochstuft, wenn die API eine Anfrage mit einem Kontextlängenfehler ablehnt.

### Auslöser und Reihenfolge

Wenn ein Turn mit einem Kontextüberlauf-Fehler fehlschlägt (z.B. `context_length_exceeded`), versucht `AgentSession` die Promotion **bevor** auf Kompaktierung zurückgegriffen wird:

1. Wenn `contextPromotion.enabled` true ist, ein Promotionsziel auflösen (siehe unten).
2. Wenn ein Ziel gefunden wird, dorthin wechseln und die Anfrage erneut versuchen — keine Kompaktierung nötig.
3. Wenn kein Ziel verfügbar ist, zur Auto-Kompaktierung auf dem aktuellen Modell durchfallen.

### Zielauswahl

Die Auswahl ist modellgesteuert, nicht rollengesteuert:

1. `currentModel.contextPromotionTarget` (wenn konfiguriert)
2. Kleinstes Modell mit größerem Kontext beim selben Anbieter + API

Kandidaten werden ignoriert, es sei denn Anmeldedaten werden aufgelöst (`ModelRegistry.getApiKey(...)`).

### OpenAI Codex WebSocket-Übergabe

Beim Wechsel von/zu `openai-codex-responses` wird der Sitzungsanbieter-Zustandsschlüssel `openai-codex-responses` vor dem Modellwechsel geschlossen. Dies verwirft den WebSocket-Transportzustand, sodass der nächste Turn sauber auf dem hochgestuften Modell startet.

### Persistenzverhalten

Promotion verwendet temporäres Wechseln (`setModelTemporary`):

- Wird als temporäre `model_change` in der Sitzungshistorie aufgezeichnet
- Überschreibt nicht die gespeicherte Rollenzuordnung

### Konfiguration expliziter Fallback-Ketten

Konfigurieren Sie Fallback direkt in den Modell-Metadaten über `contextPromotionTarget`.

`contextPromotionTarget` akzeptiert entweder:

- `provider/model-id` (explizit)
- `model-id` (wird innerhalb des aktuellen Anbieters aufgelöst)

Beispiel (`models.yml`) für Spark -> Nicht-Spark beim selben Anbieter:

```yaml
providers:
  openai-codex:
    modelOverrides:
      gpt-5.3-codex-spark:
        contextPromotionTarget: openai-codex/gpt-5.3-codex
```

Der eingebaute Modellgenerator weist dies auch automatisch für `*-spark`-Modelle zu, wenn ein Basismodell beim selben Anbieter existiert.

## Kompatibilitäts- und Routing-Felder

`models.yml` unterstützt diese `compat`-Teilmenge:

- `supportsStore`
- `supportsDeveloperRole`
- `supportsReasoningEffort`
- `maxTokensField` (`max_completion_tokens` oder `max_tokens`)
- `openRouterRouting.only` / `openRouterRouting.order`
- `vercelGatewayRouting.only` / `vercelGatewayRouting.order`

Diese werden von der OpenAI-Completions-Transportlogik konsumiert und mit URL-basierter Auto-Erkennung kombiniert.

## Praktische Beispiele

### Lokaler OpenAI-kompatibler Endpunkt (ohne Auth)

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

### Gehosteter Proxy mit umgebungsbasiertem Schlüssel

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

### Eingebaute Anbieterroute + Modell-Metadaten überschreiben

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

## LiteLLM-Proxy-Auto-Konfiguration

Wenn sowohl die Umgebungsvariablen `LITELLM_BASE_URL` als auch `LITELLM_API_KEY` gesetzt sind, verwaltet xcsh automatisch die `models.yml`-Konfiguration für den LiteLLM-Proxy.

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

Eine Standard-`config.yml` wird ebenfalls mit sinnvollen Bildanbieter-Einstellungen generiert.

### Selbstheilung beim Start

Bei jedem Start führt `startupHealthCheck()` in der Modell-Registry die folgenden Prüfungen durch:

| Bedingung | Aktion |
|-----------|--------|
| `models.yml` fehlt | Automatisch aus Umgebungsvariablen generieren |
| `models.yml` beschädigt oder nicht parsbar | Backup als `.bak` erstellen, neu generieren |
| `baseUrl` stimmt nicht mit `LITELLM_BASE_URL` überein | Backup als `.bak` erstellen, mit neuer URL neu generieren |
| `configVersion` fehlt oder veraltet | Backup als `.bak` erstellen, mit aktueller Version neu generieren |
| Konfiguration ist gesund | Keine Aktion |

Alle Reparaturen erstellen `.bak`-Backups vor dem Überschreiben. Alle Operationen sind idempotent.

### CLI-Befehl

```bash
xcsh setup litellm              # LiteLLM-Konfiguration generieren oder reparieren
xcsh setup litellm --check      # Validierung ohne Schreiben
xcsh setup litellm --check --json  # Maschinenlesbare Validierungsausgabe
```

### Erforderliche Umgebungsvariablen

| Variable | Zweck |
|----------|-------|
| `LITELLM_BASE_URL` | LiteLLM-Proxy-URL (z.B. `https://your-proxy.example.com`). Muss mit `http://` oder `https://` beginnen. |
| `LITELLM_API_KEY` | API-Schlüssel für den Proxy. Wird namentlich in der generierten Konfiguration referenziert, zur Laufzeit aufgelöst. |

Wenn eine der Variablen nicht gesetzt ist, wird die Auto-Konfiguration stillschweigend übersprungen.

### Konfigurationsversionierung

Generierte Konfigurationen enthalten ein `configVersion`-Feld. Wenn sich das generierte Format in zukünftigen Versionen ändert, erkennt xcsh veraltete Konfigurationen und aktualisiert sie automatisch (mit Backup).

## Hinweis zu Legacy-Nutzern

Die meiste Modellkonfiguration fließt jetzt über `models.yml` via `ModelRegistry`.

Ein bemerkenswerter Legacy-Pfad bleibt bestehen: Die Websuche-Anthropic-Auth-Auflösung liest weiterhin `~/.xcsh/agent/models.json` direkt in `src/web/search/auth.ts`.

Wenn Sie sich auf diesen spezifischen Pfad verlassen, behalten Sie die JSON-Kompatibilität im Auge, bis dieses Modul migriert ist.

## Fehlerverhalten

Wenn `models.yml` Schema- oder Validierungsprüfungen nicht besteht:

- Wenn `LITELLM_BASE_URL` und `LITELLM_API_KEY` gesetzt sind, versucht die Start-Gesundheitsprüfung eine automatische Reparatur (beschädigte Datei sichern, aus Umgebungsvariablen neu generieren). Wenn die Reparatur erfolgreich ist, lädt die Registry die reparierte Konfiguration neu.
- Wenn eine automatische Reparatur nicht möglich ist (Umgebungsvariablen nicht gesetzt, Schreibfehler), arbeitet die Registry mit eingebauten Modellen weiter.
- Der Fehler wird über `ModelRegistry.getError()` bereitgestellt und in der Benutzeroberfläche/Benachrichtigungen angezeigt.
