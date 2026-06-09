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

Wenn aktiviert, extrahiert der Agent automatisch dauerhaftes Wissen aus vergangenen Sitzungen und injiziert eine kompakte Zusammenfassung in jede neue Sitzung. Im Laufe der Zeit baut er einen projektbezogenen Wissensspeicher auf — technische Entscheidungen, wiederkehrende Arbeitsabläufe, Fallstricke — der ohne manuellen Aufwand fortbesteht.

Standardmäßig deaktiviert. Aktivierung über `/settings` oder `config.yml`:

```yaml
memories:
  enabled: true
```

## Verwendung

### Was injiziert wird

Beim Sitzungsstart wird, falls eine Speicherzusammenfassung für das aktuelle Projekt existiert, diese als **Memory Guidance**-Block in den System-Prompt injiziert. Der Agent wird angewiesen:

- Gespeichertes Wissen als heuristischen Kontext zu behandeln — nützlich für Prozesse und frühere Entscheidungen, aber nicht maßgeblich für den aktuellen Repository-Zustand.
- Den Pfad des Speicher-Artefakts zu zitieren, wenn gespeichertes Wissen den Plan ändert, und es mit aktuellen Repository-Belegen zu kombinieren, bevor gehandelt wird.
- Repository-Zustand und Benutzeranweisungen zu bevorzugen, wenn sie mit dem gespeicherten Wissen in Konflikt stehen; widersprüchliches Wissen als veraltet zu behandeln.

### Speicher-Artefakte lesen

Der Agent kann Speicherdateien direkt über `memory://`-URLs mit dem `read`-Tool lesen:

| URL | Inhalt |
|---|---|
| `memory://root` | Kompakte Zusammenfassung, die beim Start injiziert wird |
| `memory://root/MEMORY.md` | Vollständiges Langzeitgedächtnis-Dokument |
| `memory://root/skills/<name>/SKILL.md` | Ein generiertes Skill-Playbook |

### `/memory`-Schrägstrichbefehl

| Unterbefehl | Wirkung |
|---|---|
| `view` | Zeigt den aktuellen Speicher-Injektions-Payload an |
| `clear` / `reset` | Löscht alle Speicherdaten und generierten Artefakte |
| `enqueue` / `rebuild` | Erzwingt die Konsolidierung beim nächsten Start |

## Funktionsweise

Speicher werden durch eine Hintergrund-Pipeline aufgebaut, die beim Start oder manuell über einen Schrägstrichbefehl ausgelöst wird.

**Phase 1 — Sitzungsweise Extraktion:** Für jede vergangene Sitzung, die sich seit der letzten Verarbeitung geändert hat, liest ein Modell den Sitzungsverlauf und extrahiert dauerhaftes Signal: technische Entscheidungen, Einschränkungen, behobene Fehler, wiederkehrende Arbeitsabläufe. Sitzungen, die zu neu, zu alt oder derzeit aktiv sind, werden übersprungen. Jede Extraktion erzeugt einen Roh-Speicherblock und eine kurze Zusammenfassung für diese Sitzung.

**Phase 2 — Konsolidierung:** Nach der Extraktion liest ein zweiter Modelldurchlauf alle sitzungsweisen Extraktionen und erzeugt drei Ausgaben, die auf die Festplatte geschrieben werden:

- `MEMORY.md` — ein kuratiertes Langzeitgedächtnis-Dokument
- `memory_summary.md` — der kompakte Text, der beim Sitzungsstart injiziert wird
- `skills/` — wiederverwendbare prozedurale Playbooks, jeweils in einem eigenen Unterverzeichnis

Phase 2 verwendet eine Lease-Sperre, um doppelte Ausführung zu verhindern, wenn mehrere Prozesse gleichzeitig starten. Veraltete Skill-Verzeichnisse aus früheren Durchläufen werden automatisch bereinigt.

Alle Ausgaben werden vor dem Schreiben auf die Festplatte auf Geheimnisse geprüft.

### Extraktionsverhalten

Das Verhalten der Speicherextraktion und -konsolidierung wird vollständig durch statische Prompt-Dateien in `src/prompts/memories/` gesteuert.

| Datei | Zweck | Variablen |
|---|---|---|
| `stage_one_system.md` | System-Prompt für die sitzungsweise Extraktion | — |
| `stage_one_input.md` | Benutzer-Turn-Vorlage, die den Sitzungsinhalt umschließt | `{{thread_id}}`, `{{response_items_json}}` |
| `consolidation.md` | Prompt für die sitzungsübergreifende Konsolidierung | `{{raw_memories}}`, `{{rollout_summaries}}` |
| `read_path.md` | Speicher-Leitfaden, der in Live-Sitzungen injiziert wird | `{{memory_summary}}` |

### Modellauswahl

Der Speicher nutzt das Modellrollen-System.

| Phase | Rolle | Zweck |
|---|---|---|
| Phase 1 (Extraktion) | `default` | Sitzungsweise Wissensextraktion |
| Phase 2 (Konsolidierung) | `smol` | Sitzungsübergreifende Synthese |

Wenn `smol` nicht konfiguriert ist, fällt Phase 2 auf die `default`-Rolle zurück.

## Konfiguration

| Einstellung | Standard | Beschreibung |
|---|---|---|
| `memories.enabled` | `false` | Hauptschalter |
| `memories.maxRolloutAgeDays` | `30` | Sitzungen, die älter als dieser Wert sind, werden nicht verarbeitet |
| `memories.minRolloutIdleHours` | `12` | Sitzungen, die vor kürzerer Zeit als diesem Wert aktiv waren, werden übersprungen |
| `memories.maxRolloutsPerStartup` | `64` | Obergrenze für verarbeitete Sitzungen in einem einzelnen Start |
| `memories.summaryInjectionTokenLimit` | `5000` | Maximale Token der Zusammenfassung, die in den System-Prompt injiziert wird |

Zusätzliche Feineinstellungen (Parallelität, Lease-Dauern, Token-Budgets) sind in der Konfiguration für fortgeschrittene Nutzung verfügbar.

## Wichtige Dateien

- `src/memories/index.ts` — Pipeline-Orchestrierung, Injektion, Schrägstrichbefehl-Verarbeitung
- `src/memories/storage.ts` — SQLite-basierte Job-Warteschlange und Thread-Registrierung
- `src/prompts/memories/` — Speicher-Prompt-Vorlagen
- `src/internal-urls/memory-protocol.ts` — `memory://`-URL-Handler
