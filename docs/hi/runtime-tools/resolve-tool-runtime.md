---
title: Resolve Tool Runtime Internals
description: >-
  Resolve tool runtime for file path resolution, content fetching, and URL-based
  resource access.
sidebar:
  order: 3
  label: Resolve tool
i18n:
  sourceHash: 73d084ed389a
  translator: machine
---

# Resolve टूल रनटाइम आंतरिक विवरण

यह दस्तावेज़ बताता है कि coding-agent में preview/apply वर्कफ़्लो कैसे मॉडल किए जाते हैं और कस्टम टूल `pushPendingAction` के माध्यम से कैसे भाग ले सकते हैं।

## दायरा और प्रमुख फ़ाइलें

- [`src/tools/resolve.ts`](../../packages/coding-agent/src/tools/resolve.ts)
- [`src/tools/pending-action.ts`](../../packages/coding-agent/src/tools/pending-action.ts)
- [`src/tools/ast-edit.ts`](../../packages/coding-agent/src/tools/ast-edit.ts)
- [`src/extensibility/custom-tools/types.ts`](../../packages/coding-agent/src/extensibility/custom-tools/types.ts)
- [`src/extensibility/custom-tools/loader.ts`](../../packages/coding-agent/src/extensibility/custom-tools/loader.ts)
- [`src/sdk.ts`](../../packages/coding-agent/src/sdk.ts)

## `resolve` क्या करता है

`resolve` एक छुपा हुआ टूल है जो एक लंबित प्रीव्यू एक्शन को अंतिम रूप देता है।

- `action: "apply"` लंबित एक्शन पर `apply(reason)` निष्पादित करता है और परिवर्तनों को सहेजता है।
- `action: "discard"` यदि उपलब्ध हो तो `reject(reason)` को आमंत्रित करता है; अन्यथा डिफ़ॉल्ट "Discarded" संदेश के साथ एक्शन को छोड़ देता है।

यदि कोई लंबित एक्शन मौजूद नहीं है, तो `resolve` इस त्रुटि के साथ विफल होता है:

- `No pending action to resolve. Nothing to apply or discard.`

## लंबित एक्शन एक स्टैक हैं (LIFO)

लंबित एक्शन `PendingActionStore` में push/pop स्टैक के रूप में संग्रहीत होते हैं:

- `push(action)` शीर्ष पर एक नया लंबित एक्शन जोड़ता है।
- `peek()` वर्तमान शीर्ष एक्शन का निरीक्षण करता है।
- `pop()` शीर्ष एक्शन को हटाता है और लौटाता है।
- `hasPending` इंगित करता है कि स्टैक खाली नहीं है या नहीं।

`resolve` हमेशा पहले **सबसे ऊपर** वाले लंबित एक्शन को उपभोग करता है (`pop()`), इसलिए एकाधिक प्रीव्यू-उत्पादक टूल पंजीकरण के विपरीत क्रम में resolve होते हैं।

## अंतर्निहित प्रोड्यूसर उदाहरण (`ast_edit`)

`ast_edit` पहले संरचनात्मक प्रतिस्थापनों का प्रीव्यू दिखाता है। जब प्रीव्यू में प्रतिस्थापन हों और अभी तक लागू न किए गए हों, तो यह एक लंबित एक्शन पुश करता है जिसमें शामिल है:

- label (मानव-पठनीय सारांश)
- `sourceToolName` (`ast_edit`)
- `apply(reason: string)` कॉलबैक जो `dryRun: false` के साथ AST एडिट को फिर से चलाता है

`resolve(action="apply", reason="...")` इस कॉलबैक में `reason` पास करता है।

## कस्टम टूल: `pushPendingAction`

कस्टम टूल `CustomToolAPI.pushPendingAction(...)` के माध्यम से resolve-संगत लंबित एक्शन पंजीकृत कर सकते हैं।

`CustomToolPendingAction`:

- `label: string` (आवश्यक)
- `apply(reason: string): Promise<AgentToolResult<unknown>>` (आवश्यक) — apply पर आमंत्रित होता है; `reason` वह स्ट्रिंग है जो `resolve` को पास की जाती है
- `reject?(reason: string): Promise<AgentToolResult<unknown> | undefined>` (वैकल्पिक) — discard पर आमंत्रित होता है; यदि प्रदान किया गया हो तो रिटर्न वैल्यू डिफ़ॉल्ट "Discarded" संदेश को प्रतिस्थापित करती है
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

## रनटाइम उपलब्धता और विफलताएँ

`pushPendingAction` कस्टम टूल लोडर द्वारा सक्रिय सत्र `PendingActionStore` का उपयोग करके वायर किया जाता है।

यदि रनटाइम में कोई pending-action store नहीं है, तो `pushPendingAction` त्रुटि फेंकता है:

- `Pending action store unavailable for custom tools in this runtime.`

## Tool-choice व्यवहार

जब `PendingActionStore.hasPending` true होता है, तो एजेंट रनटाइम टूल चयन को `resolve` की ओर झुकाता है ताकि सामान्य टूल प्रवाह जारी रखने से पहले लंबित प्रीव्यू स्पष्ट रूप से अंतिम रूप दिए जाएँ।

## डेवलपर मार्गदर्शन

- लंबित एक्शन का उपयोग केवल विनाशकारी या उच्च-प्रभाव वाले संचालनों के लिए करें जिन्हें स्पष्ट apply/discard का समर्थन करना चाहिए।
- `label` को संक्षिप्त और विशिष्ट रखें; यह resolve रेंडरर आउटपुट में दिखाया जाता है।
- सुनिश्चित करें कि `apply(reason)` एक-बार निष्पादन के लिए पर्याप्त रूप से नियतात्मक (deterministic) और idempotent है; `reason` सूचनात्मक है और व्यवहार को नहीं बदलना चाहिए।
- `reject(reason)` को तब लागू करें जब discard को क्लीनअप (अस्थायी स्थिति, लॉक, सूचनाएँ) की आवश्यकता हो; स्टेटलेस प्रीव्यू के लिए इसे छोड़ दें जहाँ डिफ़ॉल्ट संदेश पर्याप्त है।
- यदि आपका टूल एकाधिक प्रीव्यू स्टेज कर सकता है, तो LIFO सिमेंटिक्स याद रखें: सबसे हाल में पुश किया गया एक्शन पहले resolve होता है।
