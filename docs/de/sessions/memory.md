---
title: Autonomer Speicher
description: >-
  Autonomes Speichersystem zur Persistierung von Benutzereinstellungen,
  Projektkontext und Feedback über Sitzungen hinweg.
sidebar:
  order: 7
  label: Autonomer Speicher
i18n:
  sourceHash: 2aa9f516aa1e
  translator: machine
---

# Autonomer Speicher

Wenn aktiviert, extrahiert der Agent automatisch dauerhaftes Wissen aus vergangenen Sitzungen und injiziert eine kompakte Zusammenfassung in jede neue Sitzung. Im Laufe der Zeit baut er einen projektbezogenen Wissensspeicher auf — technische Entscheidungen, wiederkehrende Arbeitsabläufe, Fallstricke — der ohne manuellen Aufwand übertragen wird.

Standardmäßig deaktiviert. Aktivierung über `/settings` oder `config.yml`:

```yaml
memories:
  enabled: true
```

## Verwendung

### Was injiziert wird

Beim Sitzungsstart wird, sofern eine Speicherzusammenfassung für das aktuelle Projekt existiert, diese als **Memory Guidance**-Block in den System-Prompt injiziert. Der Agent wird angewiesen:

- Den Speicher als heuristischen Kontext zu behandeln — nützlich für Prozesse und frühere Entscheidungen, aber nicht maßgeblich für den aktuellen Repository-Zustand.
- Den Pfad des Speicher-Artefakts zu zitieren, wenn der Speicher den Plan ändert, und ihn mit aktuellen Repository-Belegen abzugleichen, bevor gehandelt wird.
- Den Repository-Zustand und Benutzeranweisungen zu bevorzugen, wenn diese mit dem Speicher in Konflikt stehen; widersprüchlichen Speicher als veraltet zu behandeln.

### Speicher-Artefakte lesen

Der Agent kann Speicherdateien direkt über `memory://`-URLs mit dem `read`-Tool lesen:

| URL | Inhalt |
|---|---|
| `memory://root` | Kompakte Zusammenfassung, die beim Start injiziert wird |
| `memory://root/MEMORY.md` | Vollständiges Langzeitspeicher-Dokument |
| `memory://root/skills/<name>/SKILL.md` | Ein generiertes Skill-Playbook |

### `/memory`-Slash-Befehl

| Unterbefehl | Wirkung |
|---|---|
| `view` | Aktuelle Speicher-Injektions-Nutzlast anzeigen |
| `clear` / `reset` | Alle Speicherdaten und generierten Artefakte löschen |
| `enqueue` / `rebuild` | Konsolidierung beim nächsten Start erzwingen |

## Funktionsweise

Speicher werden durch eine Hintergrund-Pipeline aufgebaut, die beim Start oder manuell über einen Slash-Befehl ausgelöst wird.

**Phase 1 — Extraktion pro Sitzung:** Für jede vergangene Sitzung, die sich seit der letzten Verarbeitung geändert hat, liest ein Modell den Sitzungsverlauf und extrahiert dauerhaftes Signal: technische Entscheidungen, Einschränkungen, behobene Fehler, wiederkehrende Arbeitsabläufe. Sitzungen, die zu neu, zu alt oder derzeit aktiv sind, werden übersprungen. Jede Extraktion erzeugt einen rohen Speicherblock und eine kurze Zusammenfassung für diese Sitzung.

**Phase 2 — Konsolidierung:** Nach der Extraktion liest ein zweiter Modelldurchlauf alle sitzungsbezogenen Extraktionen und erzeugt drei Ausgaben, die auf die Festplatte geschrieben werden:

- `MEMORY.md` — ein kuratiertes Langzeitspeicher-Dokument
- `memory_summary.md` — der kompakte Text, der beim Sitzungsstart injiziert wird
- `skills/` — wiederverwendbare prozedurale Playbooks, jeweils in einem eigenen Unterverzeichnis

Phase 2 verwendet eine Sperre, um doppelte Ausführung zu verhindern, wenn mehrere Prozesse gleichzeitig starten. Veraltete Skill-Verzeichnisse aus früheren Durchläufen werden automatisch bereinigt.

Alle Ausgaben werden vor dem Schreiben auf die Festplatte auf Geheimnisse geprüft.

### Extraktionsverhalten

Das Extraktions- und Konsolidierungsverhalten wird vollständig durch statische Prompt-Dateien in `src/prompts/memories/` gesteuert.

| Datei | Zweck | Variablen |
|---|---|---|
| `stage_one_system.md` | System-Prompt für die sitzungsbezogene Extraktion | — |
| `stage_one_input.md` | Benutzer-Turn-Vorlage, die Sitzungsinhalte umschließt | `{{thread_id}}`, `{{response_items_json}}` |
| `consolidation.md` | Prompt für die sitzungsübergreifende Konsolidierung | `{{raw_memories}}`, `{{rollout_summaries}}` |
| `read_path.md` | Speicher-Leitfaden, der in Live-Sitzungen injiziert wird | `{{memory_summary}}` |

### Modellauswahl

Der Speicher nutzt das bestehende Modellrollen-System.

| Phase | Rolle | Zweck |
|---|---|---|
| Phase 1 (Extraktion) | `default` | Wissensextraktion pro Sitzung |
| Phase 2 (Konsolidierung) | `smol` | Sitzungsübergreifende Synthese |

Wenn `smol` nicht konfiguriert ist, fällt Phase 2 auf die `default`-Rolle zurück.

## Konfiguration

| Einstellung | Standard | Beschreibung |
|---|---|---|
| `memories.enabled` | `false` | Hauptschalter |
| `memories.maxRolloutAgeDays` | `30` | Sitzungen, die älter als dieser Wert sind, werden nicht verarbeitet |
| `memories.minRolloutIdleHours` | `12` | Sitzungen, die kürzlicher als dieser Wert aktiv waren, werden übersprungen |
| `memories.maxRolloutsPerStartup` | `64` | Obergrenze für verarbeitete Sitzungen bei einem einzelnen Start |
| `memories.summaryInjectionTokenLimit` | `5000` | Maximale Token-Anzahl der Zusammenfassung, die in den System-Prompt injiziert wird |

Zusätzliche Einstellungsmöglichkeiten (Parallelität, Sperrdauern, Token-Budgets) sind in der Konfiguration für fortgeschrittene Nutzung verfügbar.

## Wichtige Dateien

- `src/memories/index.ts` — Pipeline-Orchestrierung, Injektion, Slash-Befehl-Verarbeitung
- `src/memories/storage.ts` — SQLite-basierte Aufgabenwarteschlange und Thread-Registrierung
- `src/prompts/memories/` — Speicher-Prompt-Vorlagen
- `src/internal-urls/memory-protocol.ts` — `memory://`-URL-Handler
