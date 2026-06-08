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

Dieses Dokument beschreibt, wie der Coding-Agent derzeit Modelle lädt, Überschreibungen anwendet, Anmeldedaten auflöst und Modelle zur Laufzeit auswählt.

## Was das Modellverhalten steuert

Primäre Implementierungsdateien:

- `src/config/model-registry.ts` — lädt integrierte + benutzerdefinierte Modelle, Anbieter-Überschreibungen, Laufzeit-Erkennung, Auth-Integration
- `src/config/model-resolver.ts` — parst Modellmuster und wählt initial/smol/slow-Modelle aus
- `src/config/settings-schema.ts` — modellbezogene Einstellungen (`modelRoles`, Anbieter-Transport-Präferenzen)
- `src/session/auth-storage.ts` — Auflösungsreihenfolge für API-Schlüssel + OAuth
- `packages/ai/src/models.ts` und `packages/ai/src/types.ts` — integrierte Anbieter/Modelle und `Model`/`compat`-Typen

## Speicherort der Konfigurationsdatei und Legacy-Verhalten

Standardmäßiger Konfigurationspfad:

- `~/.xcsh/agent/models.yml`

Noch vorhandenes Legacy-Verhalten:

- Wenn `models.yml` fehlt und `models.json` am selben Speicherort existiert, wird sie zu `models.yml` migriert.
- Explizite `.json`- / `.jsonc`-Konfigurationspfade werden weiterhin unterstützt, wenn sie programmatisch an `ModelRegistry` übergeben werden.

## Struktur von `models.yml`

```yaml
configVersion: 1  # optional — wird von Auto-Config geschrieben, für Migrationserkennung verwendet
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

`provider-id` ist der kanonische Anbieterschlüssel, der für Auswahl und Auth-Suche verwendet wird.

`equivalence` ist optional und konfiguriert die kanonische Modellgruppierung auf Basis konkreter Anbietermodelle:

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

### Erlaubte `api`-Werte für Anbieter/Modelle

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
- `apiKey` sofern nicht `auth: none`
- `api` auf Anbieterebene oder pro Modell

### Nur-Überschreibungs-Anbieter (`models` fehlt oder leer)

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

ModelRegistry-Pipeline (beim Aktualisieren):

1. Integrierte Anbieter/Modelle aus `@f5xc-salesdemos/pi-ai` laden.
2. Benutzerdefinierte `models.yml`-Konfiguration laden.
3. Anbieter-Überschreibungen (`baseUrl`, `headers`) auf integrierte Modelle anwenden.
4. `modelOverrides` anwenden (pro Anbieter + Modell-ID).
5. Benutzerdefinierte `models` zusammenführen:
   - gleicher `provider + id` ersetzt vorhandenes
   - ansonsten anhängen
6. Zur Laufzeit erkannte Modelle anwenden (derzeit Ollama und LM Studio), dann Modell-Überschreibungen erneut anwenden.

## Kanonische Modelläquivalenz und Zusammenfassung

Die Registry behält jedes konkrete Anbietermodell und baut dann eine kanonische Ebene darüber auf.

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

Aufbaureihenfolge für die kanonische Gruppierung:

1. Exakte Benutzer-Überschreibung aus `equivalence.overrides`
2. Gebündelte Übereinstimmungen offizieller IDs aus integrierten Modell-Metadaten
3. Konservative heuristische Normalisierung für Gateway-/Anbietervarianten
4. Fallback auf die eigene ID des konkreten Modells

Aktuelle Heuristiken sind absichtlich eng gefasst:

- Eingebettete Upstream-Präfixe können entfernt werden, wenn vorhanden, zum Beispiel `anthropic/...` oder `openai/...`
- Punkt- und Bindestrich-Versionsvarianten können nur normalisiert werden, wenn sie auf eine vorhandene offizielle ID abbilden, zum Beispiel `4.6 -> 4-6`
- Mehrdeutige Familien oder Versionen werden ohne gebündelte Übereinstimmung oder explizite Überschreibung nicht zusammengeführt

### Kanonisches Auflösungsverhalten

Wenn mehrere konkrete Varianten eine kanonische ID teilen, verwendet die Auflösung:

1. Verfügbarkeit und Auth
2. `config.yml` `modelProviderOrder`
3. Vorhandene Registry-/Anbieterreihenfolge, wenn `modelProviderOrder` nicht gesetzt ist

Deaktivierte oder nicht authentifizierte Anbieter werden übersprungen.

Sitzungsstatus und Protokolle zeichnen weiterhin den konkreten Anbieter/das Modell auf, das den Turn tatsächlich ausgeführt hat.

Anbieter-Standardwerte vs. Überschreibungen pro Modell:

- Anbieter-`headers` sind die Basis.
- Modell-`headers` überschreiben Header-Schlüssel des Anbieters.
- `modelOverrides` können Modell-Metadaten überschreiben (`name`, `reasoning`, `input`, `cost`, `contextWindow`, `maxTokens`, `headers`, `compat`, `contextPromotionTarget`).
- `compat` wird für verschachtelte Routing-Blöcke (`openRouterRouting`, `vercelGatewayRouting`, `extraBody`) tief zusammengeführt.

## Integration der Laufzeit-Erkennung

### Implizite Ollama-Erkennung

Wenn `ollama` nicht explizit konfiguriert ist, fügt die Registry einen impliziten erkennbaren Anbieter hinzu:

- Anbieter: `ollama`
- API: `openai-completions`
- Basis-URL: `OLLAMA_BASE_URL` oder `http://127.0.0.1:11434`
- Auth-Modus: schlüssellos (`auth: none`-Verhalten)

Die Laufzeit-Erkennung ruft `GET /api/tags` bei Ollama auf und synthetisiert Modelleinträge mit lokalen Standardwerten.

### Implizite llama.cpp-Erkennung

Wenn `llama.cpp` nicht explizit konfiguriert ist, fügt die Registry einen impliziten erkennbaren Anbieter hinzu:
Hinweis: Es wird die neuere Anthropic Messages API anstelle von openai-completions verwendet.

- Anbieter: `llama.cpp`
- API: `openai-responses`
- Basis-URL: `LLAMA_CPP_BASE_URL` oder `http://127.0.0.1:8080`
- Auth-Modus: schlüssellos (`auth: none`-Verhalten)

Die Laufzeit-Erkennung ruft `GET models` bei llama.cpp auf und synthetisiert Modelleinträge mit lokalen Standardwerten.

### Implizite LM Studio-Erkennung

Wenn `lm-studio` nicht explizit konfiguriert ist, fügt die Registry einen impliziten erkennbaren Anbieter hinzu:

- Anbieter: `lm-studio`
- API: `openai-completions`
- Basis-URL: `LM_STUDIO_BASE_URL` oder `http://127.0.0.1:1234/v1`
- Auth-Modus: schlüssellos (`auth: none`-Verhalten)

Die Laufzeit-Erkennung ruft Modelle ab (`GET /models`) und synthetisiert Modelleinträge mit lokalen Standardwerten.

### Explizite Anbieter-Erkennung

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

### Anbieterregistrierung durch Erweiterungen

Erweiterungen können Anbieter zur Laufzeit registrieren (`pi.registerProvider(...)`), einschließlich:

- Modellersetzung/-anhängung für einen Anbieter
- Registrierung benutzerdefinierter Stream-Handler für neue API-IDs
- Registrierung benutzerdefinierter OAuth-Anbieter

## Auth- und API-Schlüssel-Auflösungsreihenfolge

Beim Anfordern eines Schlüssels für einen Anbieter ist die effektive Reihenfolge:

1. Laufzeit-Überschreibung (CLI `--api-key`)
2. Gespeicherte API-Schlüssel-Anmeldedaten in `agent.db`
3. Gespeicherte OAuth-Anmeldedaten in `agent.db` (mit Aktualisierung)
4. Umgebungsvariablen-Zuordnung (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc.)
5. ModelRegistry-Fallback-Resolver (Anbieter-`apiKey` aus `models.yml`, Umgebungsname-oder-Literal-Semantik)

`models.yml` `apiKey`-Verhalten:

- Der Wert wird zuerst als Umgebungsvariablenname behandelt.
- Wenn keine Umgebungsvariable existiert, wird der literale String als Token verwendet.

Wenn `authHeader: true` und Anbieter-`apiKey` gesetzt ist, erhalten Modelle:

- `Authorization: Bearer <aufgelöster-Schlüssel>` als Header eingefügt.

Schlüssellose Anbieter:

- Anbieter mit der Kennzeichnung `auth: none` werden als verfügbar ohne Anmeldedaten behandelt.
- `getApiKey*` gibt für sie `kNoAuth` zurück.

## Modellverfügbarkeit vs. alle Modelle

- `getAll()` gibt die geladene Modell-Registry zurück (integriert + zusammengeführte benutzerdefinierte + erkannte).
- `getAvailable()` filtert auf Modelle, die schlüssellos sind oder auflösbare Auth haben.

Ein Modell kann also in der Registry existieren, aber erst auswählbar sein, wenn Auth verfügbar ist.

## Laufzeit-Modellauflösung

### CLI und Muster-Parsing

`model-resolver.ts` unterstützt:

- Exakt `provider/modelId`
- Exakte kanonische Modell-ID
- Exakte Modell-ID (Anbieter wird abgeleitet)
- Fuzzy-/Teilstring-Abgleich
- Glob-Bereichsmuster in `--models` (z.B. `openai/*`, `*sonnet*`)
- Optionales `:thinkingLevel`-Suffix (`off|minimal|low|medium|high|xhigh`)

`--provider` ist veraltet; `--model` wird bevorzugt.

Auflösungspriorität für exakte Selektoren:

1. Exakt `provider/modelId` umgeht die Zusammenfassung
2. Exakte kanonische ID wird über den kanonischen Index aufgelöst
3. Exakte nackte konkrete ID funktioniert weiterhin
4. Fuzzy- und Glob-Abgleich werden nach den exakten Pfaden ausgeführt

### Priorität bei der initialen Modellauswahl

`findInitialModel(...)` verwendet diese Reihenfolge:

1. Expliziter CLI-Anbieter+Modell
2. Erstes bereichsbezogenes Modell (wenn nicht fortgesetzt wird)
3. Gespeicherter Standard-Anbieter/Modell
4. Bekannte Anbieter-Standards (z.B. OpenAI/Anthropic/etc.) unter den verfügbaren Modellen
5. Erstes verfügbares Modell

### Rollenaliase und Einstellungen

Unterstützte Modellrollen:

- `default`, `smol`, `slow`, `plan`, `commit`

Rollenaliase wie `pi/smol` werden über `settings.modelRoles` erweitert. Jeder Rollenwert kann auch einen Thinking-Selektor wie `:minimal`, `:low`, `:medium` oder `:high` anhängen.

Wenn eine Rolle auf eine andere Rolle verweist, erbt das Zielmodell weiterhin normal und jedes explizite Suffix der verweisenden Rolle gewinnt für diese rollenspezifische Verwendung.

Verwandte Einstellungen:

- `modelRoles` (Record)
- `enabledModels` (bereichsbezogene Musterliste)
- `modelProviderOrder` (globale kanonische Anbieterpräzedenz)
- `providers.kimiApiFormat` (`openai` oder `anthropic` Anfrageformat)
- `providers.openaiWebsockets` (`auto|off|on` WebSocket-Präferenz für OpenAI Codex-Transport)

`modelRoles` kann entweder speichern:

- `provider/modelId` um eine konkrete Anbietervariante festzulegen
- Eine kanonische ID wie `gpt-5.3-codex` um Anbieter-Zusammenfassung zu ermöglichen

Für `enabledModels` und CLI `--models`:

- Exakte kanonische IDs werden zu allen konkreten Varianten in dieser kanonischen Gruppe erweitert
- Explizite `provider/modelId`-Einträge bleiben exakt
- Globs und Fuzzy-Abgleiche operieren weiterhin auf konkreten Modellen

## `/model` und `--list-models`

Beide Oberflächen halten anbieter-präfixierte Modelle sichtbar und auswählbar.

Sie zeigen jetzt auch kanonische/zusammengefasste Modelle an:

- `/model` enthält eine kanonische Ansicht neben den Anbieter-Tabs
- `--list-models` gibt einen kanonischen Abschnitt plus die konkreten Anbieterzeilen aus

Die Auswahl eines kanonischen Eintrags speichert den kanonischen Selektor. Die Auswahl einer Anbieterzeile speichert den expliziten `provider/modelId`.

## Kontext-Promotion (Fallback-Ketten auf Modellebene)

Kontext-Promotion ist ein Überlauf-Wiederherstellungsmechanismus für Varianten mit kleinem Kontext (zum Beispiel `*-spark`), der automatisch zu einem Geschwistermodell mit größerem Kontext wechselt, wenn die API eine Anfrage mit einem Kontextlängenfehler ablehnt.

### Auslöser und Reihenfolge

Wenn ein Turn mit einem Kontext-Überlauf-Fehler fehlschlägt (z.B. `context_length_exceeded`), versucht `AgentSession` eine Promotion **bevor** auf Komprimierung zurückgefallen wird:

1. Wenn `contextPromotion.enabled` true ist, ein Promotionsziel auflösen (siehe unten).
2. Wenn ein Ziel gefunden wird, zu diesem wechseln und die Anfrage erneut versuchen — keine Komprimierung nötig.
3. Wenn kein Ziel verfügbar ist, zur Auto-Komprimierung auf dem aktuellen Modell übergehen.

### Zielauswahl

Die Auswahl ist modellgesteuert, nicht rollengesteuert:

1. `currentModel.contextPromotionTarget` (falls konfiguriert)
2. Kleinstes Modell mit größerem Kontext beim selben Anbieter + API

Kandidaten werden ignoriert, sofern keine Anmeldedaten aufgelöst werden können (`ModelRegistry.getApiKey(...)`).

### OpenAI Codex WebSocket-Übergabe

Beim Wechsel von/zu `openai-codex-responses` wird der Sitzungsanbieterstatus-Schlüssel `openai-codex-responses` vor dem Modellwechsel geschlossen. Dies verwirft den WebSocket-Transportstatus, sodass der nächste Turn sauber auf dem beförderten Modell startet.

### Persistenzverhalten

Promotion verwendet temporäres Umschalten (`setModelTemporary`):

- wird als temporäre `model_change` in der Sitzungshistorie aufgezeichnet
- schreibt die gespeicherte Rollenzuordnung nicht um

### Konfiguration expliziter Fallback-Ketten

Konfigurieren Sie den Fallback direkt in den Modell-Metadaten über `contextPromotionTarget`.

`contextPromotionTarget` akzeptiert entweder:

- `provider/model-id` (explizit)
- `model-id` (innerhalb des aktuellen Anbieters aufgelöst)

Beispiel (`models.yml`) für Spark -> Nicht-Spark beim selben Anbieter:

```yaml
providers:
  openai-codex:
    modelOverrides:
      gpt-5.3-codex-spark:
        contextPromotionTarget: openai-codex/gpt-5.3-codex
```

Der integrierte Modellgenerator weist dies auch automatisch für `*-spark`-Modelle zu, wenn ein Basismodell beim selben Anbieter existiert.

## Kompatibilitäts- und Routing-Felder

`models.yml` unterstützt diese `compat`-Teilmenge:

- `supportsStore`
- `supportsDeveloperRole`
- `supportsReasoningEffort`
- `maxTokensField` (`max_completion_tokens` oder `max_tokens`)
- `openRouterRouting.only` / `openRouterRouting.order`
- `vercelGatewayRouting.only` / `vercelGatewayRouting.order`

Diese werden von der OpenAI-Completions-Transportlogik verarbeitet und mit URL-basierter Auto-Erkennung kombiniert.

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

### Überschreibung der integrierten Anbieterroute + Modell-Metadaten

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

## LiteLLM-Proxy Auto-Konfiguration

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
| `models.yml` beschädigt oder nicht parsebar | Backup als `.bak`, neu generieren |
| `baseUrl` stimmt nicht mit `LITELLM_BASE_URL` überein | Backup als `.bak`, mit neuer URL neu generieren |
| `configVersion` fehlt oder veraltet | Backup als `.bak`, mit aktueller Version neu generieren |
| Konfiguration ist gesund | Keine Aktion |

Alle Reparaturen erstellen `.bak`-Backups vor dem Überschreiben. Alle Operationen sind idempotent.

### CLI-Befehl

```bash
xcsh setup litellm              # LiteLLM-Konfiguration generieren oder reparieren
xcsh setup litellm --check      # Validierung ohne Schreibvorgang
xcsh setup litellm --check --json  # Maschinenlesbare Validierungsausgabe
```

### Erforderliche Umgebungsvariablen

| Variable | Zweck |
|----------|-------|
| `LITELLM_BASE_URL` | LiteLLM-Proxy-URL (z.B. `https://your-proxy.example.com`). Muss mit `http://` oder `https://` beginnen. |
| `LITELLM_API_KEY` | API-Schlüssel für den Proxy. Wird namentlich in der generierten Konfiguration referenziert, zur Laufzeit aufgelöst. |

Wenn eine der Variablen nicht gesetzt ist, wird die Auto-Konfiguration stillschweigend übersprungen.

### Konfigurations-Versionierung

Generierte Konfigurationen enthalten ein `configVersion`-Feld. Wenn sich das generierte Format in zukünftigen Releases ändert, erkennt xcsh veraltete Konfigurationen und aktualisiert sie automatisch (mit Backup).

## Hinweis zu Legacy-Konsumenten

Die meiste Modellkonfiguration fließt jetzt über `models.yml` via `ModelRegistry`.

Ein bemerkenswerter Legacy-Pfad bleibt bestehen: Die Anthropic-Auth-Auflösung für die Websuche liest weiterhin direkt `~/.xcsh/agent/models.json` in `src/web/search/auth.ts`.

Wenn Sie auf diesen spezifischen Pfad angewiesen sind, beachten Sie die JSON-Kompatibilität, bis dieses Modul migriert ist.

## Fehlerverhalten

Wenn `models.yml` Schema- oder Validierungsprüfungen nicht besteht:

- Wenn `LITELLM_BASE_URL` und `LITELLM_API_KEY` gesetzt sind, versucht die Startup-Health-Check eine automatische Reparatur (beschädigte Datei sichern, aus Umgebungsvariablen neu generieren). Wenn die Reparatur erfolgreich ist, lädt die Registry die reparierte Konfiguration neu.
- Wenn eine automatische Reparatur nicht möglich ist (Umgebungsvariablen nicht gesetzt, Schreibfehler), arbeitet die Registry weiterhin mit integrierten Modellen.
- Der Fehler wird über `ModelRegistry.getError()` bereitgestellt und in der UI/Benachrichtigungen angezeigt.
