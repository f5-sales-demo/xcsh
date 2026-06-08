---
title: xcsh Dokumentation
description: >-
  KI-gestütztes Entwicklungs-CLI mit TypeScript-Coding-Agent und nativer
  Rust-Schicht für langlebige Sitzungen, MCP-Unterstützung und
  Plattform-Paketierung.
sidebar:
  order: 0
  label: Überblick
i18n:
  sourceHash: b9288f42bf46
  translator: machine
---

xcsh ist ein KI-gestütztes Entwicklungs-CLI mit einem TypeScript-Coding-Agent und einer
nativen Rust-Schicht (`pi-natives`). Es erweitert die Open-Source-Linie
[`badlogic/pi-mono`](https://github.com/badlogic/pi-mono) um eine
gehärtete Laufzeitumgebung, langlebige Sitzungen mit Baumnavigation und Kompaktierung,
ein Python-IPython-Tool, vollständige MCP-Unterstützung, ein Skills-System und
Plattform-Paketierung für Linux, macOS und Windows.

## Einstieg

- **[F5 XC Kontexte](/runtime-tools/context-command)** — Verbindung zu F5 Distributed Cloud
  Tenants herstellen. Kontexte erstellen, zwischen ihnen wechseln, Namespaces und Anmeldedaten verwalten.
- **Konfiguration** — wie xcsh Konfigurationen erkennt, auflöst und schichtet.
- **Laufzeitumgebung & Tools** — die Bash- / Notebook- / Resolve-Tool-Laufzeitumgebungen und die
  Slash-Befehlsoberfläche.
- **Sitzungen** — Append-only-Eintragsprotokoll, Baumnavigation, Kompaktierung und das
  autonome Speichersystem.
- **Natives (Rust)** — Architektur des `pi-natives` N-API-Addons, das
  Shell / PTY / Medien / Suche bereitstellt.
- **MCP** — Konfiguration, Protokoll-Interna, Laufzeit-Lebenszyklus und wie man
  Server und Tools erstellt.
- **Erweiterungen, Skills & Plugins** — Erstellung, Laden, Matching-Regeln, der
  Marketplace und der Plugin-Installer.
- **Anbieter & Modelle** — Modellkonfiguration, Streaming-Interna und die
  Python- / IPython-Laufzeitumgebung.
- **TUI** — Theming, der `/tree`-Befehl und Integrations-Hooks für
  Erweiterungen und benutzerdefinierte Tools.

## Aufbau dieser Dokumentation

Jede übergeordnete Gruppe in der Seitenleiste entspricht einem Teilsystem des Agents. Innerhalb
einer Gruppe sind die Seiten von "Überblick" bis "Interna" angeordnet, sodass Sie mit dem Lesen
aufhören können, sobald Sie genügend Kontext für die jeweilige Aufgabe haben.
