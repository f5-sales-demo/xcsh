---
title: Interne Funktionsweise der Resolve-Tool-Laufzeitumgebung
description: >-
  Resolve-Tool-Laufzeitumgebung für Dateipfadauflösung, Inhaltsabruf und
  URL-basierten Ressourcenzugriff.
sidebar:
  order: 3
  label: Resolve-Tool
i18n:
  sourceHash: 73d084ed389a
  translator: machine
---

# Interne Funktionsweise der Resolve-Tool-Laufzeitumgebung

Dieses Dokument erläutert, wie Vorschau-/Anwenden-Workflows im Coding-Agent modelliert werden und wie benutzerdefinierte Tools über `pushPendingAction` daran teilnehmen können.

## Geltungsbereich und Schlüsseldateien

- [`src/tools/resolve.ts`](../../packages/coding-agent/src/tools/resolve.ts)
- [`src/tools/pending-action.ts`](../../packages/coding-agent/src/tools/pending-action.ts)
- [`src/tools/ast-edit.ts`](../../packages/coding-agent/src/tools/ast-edit.ts)
- [`src/extensibility/custom-tools/types.ts`](../../packages/coding-agent/src/extensibility/custom-tools/types.ts)
- [`src/extensibility/custom-tools/loader.ts`](../../packages/coding-agent/src/extensibility/custom-tools/loader.ts)
- [`src/sdk.ts`](../../packages/coding-agent/src/sdk.ts)

## Was `resolve` tut

`resolve` ist ein verstecktes Tool, das eine ausstehende Vorschauaktion abschließt.

- `action: "apply"` führt `apply(reason)` auf der ausstehenden Aktion aus und persistiert die Änderungen.
- `action: "discard"` ruft `reject(reason)` auf, falls vorhanden; andernfalls wird die Aktion mit einer Standard-Nachricht "Discarded" verworfen.

Wenn keine ausstehende Aktion existiert, schlägt `resolve` fehl mit:

- `No pending action to resolve. Nothing to apply or discard.`

## Ausstehende Aktionen sind ein Stapel (LIFO)

Ausstehende Aktionen werden im `PendingActionStore` als Push/Pop-Stapel gespeichert:

- `push(action)` fügt eine neue ausstehende Aktion oben hinzu.
- `peek()` inspiziert die aktuelle oberste Aktion.
- `pop()` entfernt die oberste Aktion und gibt sie zurück.
- `hasPending` gibt an, ob der Stapel nicht leer ist.

`resolve` verarbeitet immer die **oberste** ausstehende Aktion zuerst (`pop()`), sodass mehrere vorschauerzeugende Tools in umgekehrter Registrierungsreihenfolge aufgelöst werden.

## Beispiel eines eingebauten Erzeugers (`ast_edit`)

`ast_edit` zeigt zunächst eine Vorschau struktureller Ersetzungen an. Wenn die Vorschau Ersetzungen enthält und noch nicht angewendet wurde, wird eine ausstehende Aktion auf den Stapel gelegt, die Folgendes enthält:

- label (menschenlesbare Zusammenfassung)
- `sourceToolName` (`ast_edit`)
- `apply(reason: string)` Callback, der die AST-Bearbeitung mit `dryRun: false` erneut ausführt

`resolve(action="apply", reason="...")` übergibt `reason` an diesen Callback.

## Benutzerdefinierte Tools: `pushPendingAction`

Benutzerdefinierte Tools können resolve-kompatible ausstehende Aktionen über `CustomToolAPI.pushPendingAction(...)` registrieren.

`CustomToolPendingAction`:

- `label: string` (erforderlich)
- `apply(reason: string): Promise<AgentToolResult<unknown>>` (erforderlich) — wird beim Anwenden aufgerufen; `reason` ist der an `resolve` übergebene String
- `reject?(reason: string): Promise<AgentToolResult<unknown> | undefined>` (optional) — wird beim Verwerfen aufgerufen; der Rückgabewert ersetzt die Standard-Nachricht "Discarded", falls vorhanden
- `details?: unknown` (optional)
- `sourceToolName?: string` (optional, Standardwert ist `"custom_tool"`)

### Minimales Verwendungsbeispiel

```ts
import type { CustomToolFactory } from "@f5xc-salesdemos/xcsh";

const factory: CustomToolFactory = pi => ({
 name: "batch_rename_preview",
 label: "Batch Rename Preview",
 description: "Previews renames and defers commit to resolve",
 parameters: pi.typebox.Type.Object({
  files: pi.typebox.Type.Array(pi.typebox.Type.String()),
 }),

 async execute(_toolCallId, params) {
  const previewSummary = `Prepared rename plan for ${params.files.length} files`;

  pi.pushPendingAction({
   label: `Batch rename: ${params.files.length} files`,
   sourceToolName: "batch_rename_preview",
   apply: async (reason) => {
    // apply writes here
    return {
     content: [{ type: "text", text: `Applied batch rename. Reason: ${reason}` }],
    };
   },
   reject: async (reason) => {
    // optional: cleanup or notify on discard
    return {
     content: [{ type: "text", text: `Discarded batch rename. Reason: ${reason}` }],
    };
   },
  });

  return {
   content: [{ type: "text", text: `${previewSummary}. Call resolve to apply or discard.` }],
  };
 },
});

export default factory;
```

## Laufzeitverfügbarkeit und Fehlerfälle

`pushPendingAction` wird vom Loader für benutzerdefinierte Tools unter Verwendung des aktiven Sitzungs-`PendingActionStore` verdrahtet.

Wenn die Laufzeitumgebung keinen Pending-Action-Store besitzt, wirft `pushPendingAction` eine Ausnahme:

- `Pending action store unavailable for custom tools in this runtime.`

## Verhalten der Tool-Auswahl

Wenn `PendingActionStore.hasPending` den Wert true hat, bevorzugt die Agenten-Laufzeitumgebung bei der Tool-Auswahl `resolve`, damit ausstehende Vorschauen explizit abgeschlossen werden, bevor der normale Tool-Ablauf fortgesetzt wird.

## Hinweise für Entwickler

- Verwenden Sie ausstehende Aktionen nur für destruktive oder folgenschwere Operationen, die ein explizites Anwenden/Verwerfen unterstützen sollten.
- Halten Sie `label` prägnant und spezifisch; es wird in der Ausgabe des Resolve-Renderers angezeigt.
- Stellen Sie sicher, dass `apply(reason)` deterministisch und ausreichend idempotent für eine einmalige Ausführung ist; `reason` ist informativ und sollte das Verhalten nicht ändern.
- Implementieren Sie `reject(reason)`, wenn das Verwerfen eine Bereinigung erfordert (temporärer Zustand, Sperren, Benachrichtigungen); lassen Sie es bei zustandslosen Vorschauen weg, bei denen die Standardnachricht ausreicht.
- Wenn Ihr Tool mehrere Vorschauen bereitstellen kann, beachten Sie die LIFO-Semantik: Die zuletzt hinzugefügte Aktion wird zuerst aufgelöst.
