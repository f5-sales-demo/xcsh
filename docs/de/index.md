---
title: xcsh Dokumentation
description: >-
  KI-gestützte Entwicklungs-CLI mit TypeScript-Coding-Agent und
  Rust-Native-Layer für langlebige Sitzungen, MCP-Unterstützung und
  Plattform-Paketierung.
sidebar:
  order: 0
  label: Übersicht
i18n:
  sourceHash: b9288f42bf46
  translator: machine
---

xcsh ist eine KI-gestützte Entwicklungs-CLI mit einem TypeScript-Coding-Agent und einem
Rust-Native-Layer (`pi-natives`). Sie erweitert die Open-Source-Reihe
[`badlogic/pi-mono`](https://github.com/badlogic/pi-mono) um eine
gehärtete Laufzeitumgebung, langlebige Sitzungen mit Baumnavigation und Kompaktierung,
ein Python-IPython-Tool, vollständige MCP-Unterstützung, ein Skills-System und
Plattform-Paketierung für Linux, macOS und Windows.

## Einstiegspunkte

- **[F5 XC Kontexte](/runtime-tools/context-command)** — Verbindung zu F5 Distributed Cloud
  Tenants herstellen. Kontexte erstellen, zwischen ihnen wechseln, Namespaces und Anmeldedaten verwalten.
- **Konfiguration** — wie xcsh Konfigurationen erkennt, auflöst und schichtet.
- **Laufzeit & Tools** — die Bash- / Notebook- / Resolve-Tool-Laufzeiten und die
  Slash-Befehlsoberfläche.
- **Sitzungen** — Append-Only-Eintragsprotokoll, Baumnavigation, Kompaktierung und das
  autonome Speichersystem.
- **Natives (Rust)** — Architektur des `pi-natives` N-API-Addons, das
  Shell / PTY / Medien / Suche antreibt.
- **MCP** — Konfiguration, Protokollinterna, Laufzeit-Lebenszyklus und wie man
  Server und Tools erstellt.
- **Erweiterungen, Skills & Plugins** — Erstellung, Laden, Matching-Regeln, der
  Marktplatz und der Plugin-Installer.
- **Anbieter & Modelle** — Modellkonfiguration, Streaming-Interna und die
  Python- / IPython-Laufzeit.
- **TUI** — Theming, der `/tree`-Befehl und Integrations-Hooks für
  Erweiterungen und benutzerdefinierte Tools.

## Wie diese Dokumentation aufgebaut ist

Jede übergeordnete Gruppe in der Seitenleiste entspricht einem Subsystem des Agents. Innerhalb
einer Gruppe sind die Seiten von "Übersicht" bis "Interna" angeordnet, sodass Sie mit dem Lesen
aufhören können, sobald Sie genügend Kontext für die jeweilige Aufgabe haben.
