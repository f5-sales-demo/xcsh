---
title: xcsh Dokumentation
description: >-
  KI-gestützte Entwicklungs-CLI mit TypeScript Coding Agent und Rust Native
  Layer für langlebige Sitzungen, MCP-Unterstützung und Plattform-Packaging.
sidebar:
  order: 0
  label: Überblick
i18n:
  sourceHash: b9288f42bf46
  translator: machine
---

xcsh ist eine KI-gestützte Entwicklungs-CLI mit einem TypeScript Coding Agent und einem
Rust Native Layer (`pi-natives`). Es erweitert die Open-Source-Linie
[`badlogic/pi-mono`](https://github.com/badlogic/pi-mono) um eine
gehärtete Laufzeitumgebung, langlebige Sitzungen mit Baumnavigation und Komprimierung,
ein Python IPython Tool, vollständige MCP-Unterstützung, ein Skills-System und
Plattform-Packaging für Linux, macOS und Windows.

## Wo Sie beginnen sollten

- **[F5 XC Kontexte](/runtime-tools/context-command)** — Verbindung zu F5 Distributed Cloud
  Tenants herstellen. Kontexte erstellen, zwischen ihnen wechseln, Namespaces und Anmeldeinformationen verwalten.
- **Konfiguration** — wie xcsh Konfigurationen erkennt, auflöst und schichtet.
- **Laufzeit & Tools** — die Bash- / Notebook- / Resolve-Tool-Laufzeitumgebungen und die
  Slash-Befehlsoberfläche.
- **Sitzungen** — Append-Only-Eintragsprotokoll, Baumnavigation, Komprimierung und das
  autonome Gedächtnissystem.
- **Natives (Rust)** — Architektur des `pi-natives` N-API-Addons, das
  Shell / PTY / Medien / Suche antreibt.
- **MCP** — Konfiguration, Protokollinterna, Laufzeit-Lebenszyklus und wie
  Server und Tools erstellt werden.
- **Erweiterungen, Skills & Plugins** — Erstellung, Laden, Matching-Regeln, der
  Marketplace und der Plugin-Installer.
- **Anbieter & Modelle** — Modellkonfiguration, Streaming-Interna und die
  Python / IPython-Laufzeitumgebung.
- **TUI** — Theming, der `/tree`-Befehl und Integrations-Hooks für
  Erweiterungen und benutzerdefinierte Tools.

## Wie diese Dokumentation organisiert ist

Jede Hauptgruppe in der Seitenleiste entspricht einem Subsystem des Agenten. Innerhalb
einer Gruppe verlaufen die Seiten von "Überblick" bis "Interna", sodass Sie mit dem Lesen
aufhören können, sobald Sie genügend Kontext für die jeweilige Aufgabe haben.
