---
title: F5 XC Contexts
description: >-
  Verbinden Sie xcsh mit F5 Distributed Cloud Tenants -- erstellen, wechseln und
  verwalten Sie Authentifizierungskontexte.
sidebar:
  order: 1
  label: F5 XC Contexts
i18n:
  sourceHash: bdaf0fb8837c
  translator: machine
---

# F5 XC Contexts

xcsh verbindet sich mit F5 Distributed Cloud über **Kontexte** -- benannte Anmeldedatensätze, die eine Tenant-URL, ein API-Token und einen Namespace zusammenführen. Wenn Sie bereits `kubectl config use-context` oder `kubectx` verwendet haben, ist der Workflow identisch: Erstellen Sie einen Kontext, wechseln Sie namentlich zwischen ihnen und verwenden Sie `-`, um zurückzuspringen.

## Erste Schritte

### 1. Erstellen Sie Ihren ersten Kontext

Sie benötigen drei Dinge aus Ihrer F5 XC-Konsole: die Tenant-URL, ein API-Token und optional einen Namespace.

```
/context create production https://acme.console.ves.volterra.io p12k3-your-api-token
```

```
Context 'production' created. Use /context activate production to switch to it.
```

Oder verwenden Sie den geführten Assistenten, wenn Sie schrittweise Eingabeaufforderungen bevorzugen:

```
/context wizard
```

### 2. Aktivieren Sie ihn

```
/context production
```

```
╭─ production ─────────────────────────────────────────────────╮
│ F5XC_TENANT     acme                                         │
│ F5XC_API_URL    https://acme.console.ves.volterra.io         │
│ F5XC_API_TOKEN  ...oken                                      │
│ Status          Connected (312ms)                            │
├─ Environment ────────────────────────────────────────────────┤
│ F5XC_NAMESPACE  default                                      │
╰──────────────────────────────────────────────────────────────╯
```

Nach der Aktivierung injiziert xcsh die Tenant-Anmeldedaten in Ihre Sitzung. Der Agent kann nun F5 XC API-Aufrufe durchführen, und die Statuszeile zeigt den aktiven Kontext an.

### 3. Fügen Sie weitere Kontexte hinzu und wechseln Sie zwischen ihnen

```
/context create staging https://staging.console.ves.volterra.io p12k3-staging-token
```

Wechseln Sie namentlich -- kein Unterbefehl-Verb erforderlich:

```
/context staging
```

Wechseln Sie zurück zum vorherigen Kontext (im `cd -`-Stil):

```
/context -
```

Zweimaliges Aufrufen von `/context -` bringt Sie dorthin zurück, wo Sie gestartet haben.

### 4. Sehen Sie, was Sie haben

```
/context
```

```
  production           https://acme.console.ves.volterra.io
* staging              https://staging.console.ves.volterra.io
```

Das `*` markiert den aktiven Kontext.

## Alltagsbefehle

| Befehl | Was er tut |
|---|---|
| `/context` | Alle Kontexte auflisten |
| `/context <name>` | Zu einem Kontext wechseln |
| `/context -` | Zum vorherigen Kontext wechseln |
| `/context show` | Details des aktiven Kontexts anzeigen (Tokens maskiert) |
| `/context status` | Aktuellen Authentifizierungsstatus anzeigen |

## Kontext-Lebenszyklus

| Befehl | Was er tut |
|---|---|
| `/context create <name> <url> <token> [namespace]` | Einen Kontext erstellen |
| `/context delete <name> --confirm` | Einen Kontext löschen (erfordert `--confirm`) |
| `/context rename <old> <new>` | Einen Kontext umbenennen |
| `/context validate <name>` | Anmeldedaten testen, ohne zu wechseln |
| `/context export [name] [--include-token]` | Als JSON exportieren (Tokens standardmäßig maskiert) |
| `/context import <path-or-json> [--overwrite]` | Aus Datei oder Inline-JSON importieren |
| `/context wizard` | Geführte interaktive Einrichtung |

## Namespaces wechseln

Jeder Kontext hat einen Standard-Namespace. Wechseln Sie ihn, ohne den Kontext zu ändern:

```
/context namespace system
```

Tab-Vervollständigung bietet Namespace-Namen des aktiven Tenants an.

## Umgebungsvariablen in Kontexten

Kontexte können zusätzliche Umgebungsvariablen enthalten, die bei der Aktivierung in Ihre Sitzung injiziert werden. Nützlich für tenant-spezifische Konfigurationen, die nicht Teil des Anmeldedatensatzes sind.

```
/context set CUSTOM_HEADER=x-acme-trace
/context set LOG_LEVEL=debug
/context env list
/context unset LOG_LEVEL
```

Aliase: `add` = `set`, `remove`/`clear` = `unset`.

## Tab-Vervollständigung

Geben Sie `/context ` ein und drücken Sie Tab. Das Dropdown zeigt:

1. **Kontextnamen** -- mit Tenant-URL-Hinweisen, damit Sie Tenants unterscheiden können
2. **`-`** -- erscheint, wenn Sie zuvor gewechselt haben, und zeigt an, zu welchem Kontext Sie zurückspringen würden
3. **Unterbefehle** -- `list`, `create`, `delete`, usw.

Kontextnamen erscheinen zuerst, da das Wechseln die häufigste Aktion ist.

Vervollständigungen auf Unterbefehlsebene funktionieren ebenfalls: `/context activate <Tab>` vervollständigt Kontextnamen, `/context namespace <Tab>` vervollständigt Namespaces, `/context unset <Tab>` vervollständigt bekannte Umgebungsvariablen-Schlüssel.

## Benennungsregeln

Kontextnamen müssen 1-64 Zeichen lang sein: Buchstaben, Ziffern, Bindestriche, Unterstriche.

Namen, die mit Unterbefehlen kollidieren, werden abgelehnt:

```
/context create list https://example.com tok
```

```
Error: Context name 'list' conflicts with a /context subcommand. Choose a different name.
```

Die vollständige Liste reservierter Namen: `list`, `show`, `status`, `create`, `delete`, `rename`, `namespace`, `env`, `set`, `unset`, `add`, `remove`, `clear`, `activate`, `validate`, `export`, `import`, `wizard`, `help`. Der Vergleich ist nicht Groß-/Kleinschreibung-sensitiv.

## Überschreibung durch Umgebungsvariablen

Wenn `F5XC_API_URL` und `F5XC_API_TOKEN` in Ihrer Shell-Umgebung gesetzt sind, bevor Sie xcsh starten, haben sie Vorrang vor jedem Kontext. Dies ist nützlich für CI/CD-Pipelines oder einmalige Sitzungen, in denen Sie keinen persistenten Kontext erstellen möchten.

In diesem Modus zeigt `/context` die aus Umgebungsvariablen stammenden Anmeldedaten mit einem `(via env vars)`-Label an.

## Verhalten des vorherigen Kontexts

- **Sitzungsbezogen**: Der vorherige Kontext wird beim Neustart von xcsh zurückgesetzt. Er wird nicht auf der Festplatte persistiert.
- **Ping-Pong**: Zweimaliges `/context -` bringt Sie dorthin zurück, wo Sie gestartet haben.
- **Sicher bei Änderungen**: Wenn Sie den vorherigen Kontext löschen, wird der Zeiger gelöscht. Wenn Sie ihn umbenennen, folgt der Zeiger dem neuen Namen.
- **Reaktivierung ist ein No-Op**: `/context production`, wenn Sie bereits auf `production` sind, setzt den vorherigen Zeiger nicht zurück.

## Designkonventionen

Die `/context`-UX folgt:

- **kubectx**: `kubectx <name>` zum Wechseln, `kubectx -` für den vorherigen, bloßes `kubectx` zum Auflisten
- **kubectl**: `kubectl config use-context` für die explizite Form
- **Shell**: `cd -` / `OLDPWD` für die Nachverfolgung des vorherigen Verzeichnisses
