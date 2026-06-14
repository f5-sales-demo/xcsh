---
title: रिज़ॉल्व टूल रनटाइम इंटर्नल्स
description: >-
  फ़ाइल पाथ रिज़ॉल्यूशन, कंटेंट फ़ेचिंग और URL-आधारित संसाधन एक्सेस के लिए
  रिज़ॉल्व टूल रनटाइम।
sidebar:
  order: 3
  label: रिज़ॉल्व टूल
i18n:
  sourceHash: 73d084ed389a
  translator: machine
---

# रिज़ॉल्व टूल रनटाइम इंटर्नल्स

यह दस्तावेज़ बताता है कि coding-agent में preview/apply वर्कफ़्लो को कैसे मॉडल किया जाता है और कस्टम उपकरण `pushPendingAction` के माध्यम से इसमें कैसे भाग ले सकते हैं।

## स्कोप और मुख्य फ़ाइलें

- [`src/tools/resolve.ts`](../../packages/coding-agent/src/tools/resolve.ts)
- [`src/tools/pending-action.ts`](../../packages/coding-agent/src/tools/pending-action.ts)
- [`src/tools/ast-edit.ts`](../../packages/coding-agent/src/tools/ast-edit.ts)
- [`src/extensibility/custom-tools/types.ts`](../../packages/coding-agent/src/extensibility/custom-tools/types.ts)
- [`src/extensibility/custom-tools/loader.ts`](../../packages/coding-agent/src/extensibility/custom-tools/loader.ts)
- [`src/sdk.ts`](../../packages/coding-agent/src/sdk.ts)

## `resolve` क्या करता है

`resolve` एक छुपा हुआ टूल है जो एक pending preview action को अंतिम रूप देता है।

- `action: "apply"` pending action पर `apply(reason)` को निष्पादित करता है और परिवर्तनों को सुरक्षित करता है।
- `action: "discard"` यदि प्रदान किया गया हो तो `reject(reason)` को आमंत्रित करता है; अन्यथा डिफ़ॉल्ट "Discarded" संदेश के साथ action को हटा देता है।

यदि कोई pending action मौजूद नहीं है, तो `resolve` इस त्रुटि के साथ विफल हो जाता है:

- `No pending action to resolve. Nothing to apply or discard.`

## Pending actions एक stack (LIFO) हैं

Pending actions को `PendingActionStore` में push/pop stack के रूप में संग्रहीत किया जाता है:

- `push(action)` शीर्ष पर एक नया pending action जोड़ता है।
- `peek()` वर्तमान शीर्ष action का निरीक्षण करता है।
- `pop()` शीर्ष action को हटाता है और वापस करता है।
- `hasPending` इंगित करता है कि stack खाली नहीं है।

`resolve` हमेशा पहले **सबसे ऊपरी** pending action को consume करता है (`pop()`), इसलिए कई preview-producing उपकरण पंजीकरण के विपरीत क्रम में resolve होते हैं।

## बिल्ट-इन producer उदाहरण (`ast_edit`)

`ast_edit` पहले structural replacements का preview करता है। जब preview में replacements होती हैं और वह अभी तक apply नहीं हुई है, तो यह एक pending action push करता है जिसमें शामिल हैं:

- label (मानव-पठनीय सारांश)
- `sourceToolName` (`ast_edit`)
- `apply(reason: string)` callback जो `dryRun: false` के साथ AST edit को पुनः चलाता है

`resolve(action="apply", reason="...")` इस callback में `reason` पास करता है।

## कस्टम उपकरण: `pushPendingAction`

कस्टम उपकरण `CustomToolAPI.pushPendingAction(...)` के माध्यम से resolve-compatible pending actions पंजीकृत कर सकते हैं।

`CustomToolPendingAction`:

- `label: string` (आवश्यक)
- `apply(reason: string): Promise<AgentToolResult<unknown>>` (आवश्यक) — apply पर आमंत्रित; `reason` वह string है जो `resolve` को पास की जाती है
- `reject?(reason: string): Promise<AgentToolResult<unknown> | undefined>` (वैकल्पिक) — discard पर आमंत्रित; यदि प्रदान किया जाए तो return value डिफ़ॉल्ट "Discarded" संदेश की जगह लेती है
- `details?: unknown` (वैकल्पिक)
- `sourceToolName?: string` (वैकल्पिक, डिफ़ॉल्ट `"custom_tool"`)

### न्यूनतम उपयोग उदाहरण

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

## रनटाइम उपलब्धता और विफलताएं

`pushPendingAction` को कस्टम टूल लोडर द्वारा सक्रिय session `PendingActionStore` का उपयोग करके जोड़ा जाता है।

यदि रनटाइम में कोई pending-action store नहीं है, तो `pushPendingAction` यह त्रुटि throw करता है:

- `Pending action store unavailable for custom tools in this runtime.`

## टूल-चॉइस व्यवहार

जब `PendingActionStore.hasPending` true होता है, तो agent रनटाइम टूल चॉइस को `resolve` की ओर झुकाता है ताकि pending previews को सामान्य टूल फ़्लो जारी रहने से पहले स्पष्ट रूप से अंतिम रूप दिया जा सके।

## डेवलपर मार्गदर्शन

- Pending actions का उपयोग केवल उन विनाशकारी या उच्च-प्रभाव वाले ऑपरेशनों के लिए करें जिन्हें स्पष्ट apply/discard का समर्थन करना चाहिए।
- `label` को संक्षिप्त और विशिष्ट रखें; यह resolve renderer आउटपुट में प्रदर्शित होता है।
- सुनिश्चित करें कि `apply(reason)` एकल-निष्पादन के लिए पर्याप्त रूप से निर्धारक और idempotent हो; `reason` सूचनात्मक है और व्यवहार नहीं बदलना चाहिए।
- `reject(reason)` तब लागू करें जब discard को cleanup की आवश्यकता हो (temporary state, locks, notifications); stateless previews के लिए इसे छोड़ें जहाँ डिफ़ॉल्ट संदेश पर्याप्त हो।
- यदि आपका टूल कई previews stage कर सकता है, तो LIFO semantics याद रखें: सबसे अंत में push किया गया action पहले resolve होता है।
