---
title: Resolve-Tool – Laufzeitinterna
description: >-
  Resolve tool runtime for file path resolution, content fetching, and URL-based
  resource access.
sidebar:
  order: 3
  label: Resolve-Tool
i18n:
  sourceHash: 73d084ed389a
  translator: machine
---

# Resolve-Tool – Laufzeitinterna

Dieses Dokument erklärt, wie Vorschau-/Anwenden-Workflows im Coding-Agent modelliert sind und wie benutzerdefinierte Tools über `pushPendingAction` daran teilnehmen können.

## Geltungsbereich und wichtige Dateien

- [`src/tools/resolve.ts`](../../packages/coding-agent/src/tools/resolve.ts)
- [`src/tools/pending-action.ts`](../../packages/coding-agent/src/tools/pending-action.ts)
- [`src/tools/ast-edit.ts`](../../packages/coding-agent/src/tools/ast-edit.ts)
- [`src/extensibility/custom-tools/types.ts`](../../packages/coding-agent/src/extensibility/custom-tools/types.ts)
- [`src/extensibility/custom-tools/loader.ts`](../../packages/coding-agent/src/extensibility/custom-tools/loader.ts)
- [`src/sdk.ts`](../../packages/coding-agent/src/sdk.ts)

## Was `resolve` tut

`resolve` ist ein verborgenes Tool, das eine ausstehende Vorschau-Aktion abschließt.

- `action: "apply"` führt `apply(reason)` auf der ausstehenden Aktion aus und persistiert die Änderungen.
- `action: "discard"` ruft `reject(reason)` auf, falls vorhanden; andernfalls verwirft es die Aktion mit einer Standard-Nachricht "Discarded".

Wenn keine ausstehende Aktion existiert, schlägt `resolve` mit folgender Meldung fehl:

- `No pending action to resolve. Nothing to apply or discard.`

## Ausstehende Aktionen sind ein Stack (LIFO)

Ausstehende Aktionen werden im `PendingActionStore` als Push/Pop-Stack gespeichert:

- `push(action)` fügt eine neue ausstehende Aktion oben hinzu.
- `peek()` inspiziert die aktuelle oberste Aktion.
- `pop()` entfernt die oberste Aktion und gibt sie zurück.
- `hasPending` gibt an, ob der Stack nicht leer ist.

`resolve` konsumiert immer zuerst die **oberste** ausstehende Aktion (`pop()`), sodass mehrere Vorschau-erzeugende Tools in umgekehrter Reihenfolge ihrer Registrierung aufgelöst werden.

## Beispiel eines eingebauten Produzenten (`ast_edit`)

`ast_edit` zeigt zunächst eine Vorschau struktureller Ersetzungen an. Wenn die Vorschau Ersetzungen enthält und noch nicht angewendet wurde, wird eine ausstehende Aktion auf den Stack gelegt, die Folgendes enthält:

- Label (menschenlesbare Zusammenfassung)
- `sourceToolName` (`ast_edit`)
- `apply(reason: string)`-Callback, der die AST-Bearbeitung mit `dryRun: false` erneut ausführt

`resolve(action="apply", reason="...")` übergibt `reason` an diesen Callback.

## Benutzerdefinierte Tools: `pushPendingAction`

Benutzerdefinierte Tools können resolve-kompatible ausstehende Aktionen über `CustomToolAPI.pushPendingAction(...)` registrieren.

`CustomToolPendingAction`:

- `label: string` (erforderlich)
- `apply(reason: string): Promise<AgentToolResult<unknown>>` (erforderlich) — wird beim Anwenden aufgerufen; `reason` ist die an `resolve` übergebene Zeichenkette
- `reject?(reason: string): Promise<AgentToolResult<unknown> | undefined>` (optional) — wird beim Verwerfen aufgerufen; der Rückgabewert ersetzt die Standard-Nachricht "Discarded", falls vorhanden
- `details?: unknown` (optional)
- `sourceToolName?: string` (optional, Standardwert ist `"custom_tool"`)

### Minimales Nutzungsbeispiel

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

## Laufzeitverfügbarkeit und Fehler

`pushPendingAction` wird vom Custom-Tool-Loader unter Verwendung des aktiven Sitzungs-`PendingActionStore` verdrahtet.

Wenn die Laufzeitumgebung keinen Pending-Action-Store hat, wirft `pushPendingAction` einen Fehler:

- `Pending action store unavailable for custom tools in this runtime.`

## Tool-Choice-Verhalten

Wenn `PendingActionStore.hasPending` den Wert `true` hat, bevorzugt die Agenten-Laufzeit die Tool-Auswahl von `resolve`, damit ausstehende Vorschauen explizit abgeschlossen werden, bevor der normale Tool-Ablauf fortgesetzt wird.

## Hinweise für Entwickler

- Verwenden Sie ausstehende Aktionen nur für destruktive oder schwerwiegende Operationen, die ein explizites Anwenden/Verwerfen unterstützen sollen.
- Halten Sie `label` prägnant und spezifisch; es wird in der Ausgabe des Resolve-Renderers angezeigt.
- Stellen Sie sicher, dass `apply(reason)` deterministisch und hinreichend idempotent für eine einmalige Ausführung ist; `reason` ist informativ und sollte das Verhalten nicht ändern.
- Implementieren Sie `reject(reason)`, wenn das Verwerfen eine Bereinigung erfordert (temporärer Zustand, Sperren, Benachrichtigungen); lassen Sie es bei zustandslosen Vorschauen weg, bei denen die Standardnachricht ausreicht.
- Wenn Ihr Tool mehrere Vorschauen bereitstellen kann, beachten Sie die LIFO-Semantik: Die zuletzt hinzugefügte Aktion wird zuerst aufgelöst.
