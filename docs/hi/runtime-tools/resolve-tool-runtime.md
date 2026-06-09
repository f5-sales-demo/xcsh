---
title: Resolve टूल रनटाइम आंतरिक संरचना
description: >-
  फ़ाइल पथ रिज़ॉल्यूशन, कंटेंट फ़ेचिंग, और URL-आधारित रिसोर्स एक्सेस के लिए
  Resolve टूल रनटाइम।
sidebar:
  order: 3
  label: Resolve टूल
i18n:
  sourceHash: 73d084ed389a
  translator: machine
---

# Resolve टूल रनटाइम आंतरिक संरचना

यह दस्तावेज़ बताता है कि coding-agent में preview/apply वर्कफ़्लो कैसे मॉडल किए जाते हैं और कस्टम टूल `pushPendingAction` के माध्यम से कैसे भाग ले सकते हैं।

## दायरा और मुख्य फ़ाइलें

- [`src/tools/resolve.ts`](../../packages/coding-agent/src/tools/resolve.ts)
- [`src/tools/pending-action.ts`](../../packages/coding-agent/src/tools/pending-action.ts)
- [`src/tools/ast-edit.ts`](../../packages/coding-agent/src/tools/ast-edit.ts)
- [`src/extensibility/custom-tools/types.ts`](../../packages/coding-agent/src/extensibility/custom-tools/types.ts)
- [`src/extensibility/custom-tools/loader.ts`](../../packages/coding-agent/src/extensibility/custom-tools/loader.ts)
- [`src/sdk.ts`](../../packages/coding-agent/src/sdk.ts)

## `resolve` क्या करता है

`resolve` एक छिपा हुआ टूल है जो एक पेंडिंग प्रीव्यू एक्शन को अंतिम रूप देता है।

- `action: "apply"` पेंडिंग एक्शन पर `apply(reason)` निष्पादित करता है और परिवर्तनों को स्थायी करता है।
- `action: "discard"` यदि उपलब्ध हो तो `reject(reason)` को आमंत्रित करता है; अन्यथा डिफ़ॉल्ट "Discarded" संदेश के साथ एक्शन को हटा देता है।

यदि कोई पेंडिंग एक्शन मौजूद नहीं है, तो `resolve` इस त्रुटि के साथ विफल होता है:

- `No pending action to resolve. Nothing to apply or discard.`

## पेंडिंग एक्शन एक स्टैक हैं (LIFO)

पेंडिंग एक्शन `PendingActionStore` में push/pop स्टैक के रूप में संग्रहीत होते हैं:

- `push(action)` शीर्ष पर एक नया पेंडिंग एक्शन जोड़ता है।
- `peek()` वर्तमान शीर्ष एक्शन का निरीक्षण करता है।
- `pop()` शीर्ष एक्शन को हटाकर लौटाता है।
- `hasPending` यह दर्शाता है कि स्टैक खाली नहीं है।

`resolve` हमेशा पहले **सबसे ऊपर वाले** पेंडिंग एक्शन को उपभोग करता है (`pop()`), इसलिए एकाधिक प्रीव्यू-उत्पन्न करने वाले टूल पंजीकरण के विपरीत क्रम में रिज़ॉल्व होते हैं।

## बिल्ट-इन प्रोड्यूसर उदाहरण (`ast_edit`)

`ast_edit` पहले संरचनात्मक प्रतिस्थापनों का प्रीव्यू करता है। जब प्रीव्यू में प्रतिस्थापन हों और अभी तक लागू न किए गए हों, तो यह एक पेंडिंग एक्शन पुश करता है जिसमें शामिल है:

- label (मानव-पठनीय सारांश)
- `sourceToolName` (`ast_edit`)
- `apply(reason: string)` कॉलबैक जो AST एडिट को `dryRun: false` के साथ पुनः चलाता है

`resolve(action="apply", reason="...")` इस कॉलबैक में `reason` पास करता है।

## कस्टम टूल: `pushPendingAction`

कस्टम टूल `CustomToolAPI.pushPendingAction(...)` के माध्यम से resolve-संगत पेंडिंग एक्शन पंजीकृत कर सकते हैं।

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

`pushPendingAction` को कस्टम टूल लोडर द्वारा सक्रिय सत्र `PendingActionStore` का उपयोग करके वायर किया जाता है।

यदि रनटाइम में कोई pending-action store नहीं है, तो `pushPendingAction` यह त्रुटि फेंकता है:

- `Pending action store unavailable for custom tools in this runtime.`

## टूल-चॉइस व्यवहार

जब `PendingActionStore.hasPending` true होता है, तो एजेंट रनटाइम टूल चॉइस को `resolve` की ओर बायस करता है ताकि सामान्य टूल प्रवाह जारी रहने से पहले पेंडिंग प्रीव्यू स्पष्ट रूप से अंतिम रूप दिए जाएँ।

## डेवलपर मार्गदर्शन

- पेंडिंग एक्शन का उपयोग केवल विनाशकारी या उच्च-प्रभाव वाले ऑपरेशनों के लिए करें जिन्हें स्पष्ट apply/discard का समर्थन करना चाहिए।
- `label` को संक्षिप्त और विशिष्ट रखें; यह resolve रेंडरर आउटपुट में दिखाया जाता है।
- सुनिश्चित करें कि `apply(reason)` निर्धारक और एक-शॉट निष्पादन के लिए पर्याप्त रूप से आइडेम्पोटेंट हो; `reason` सूचनात्मक है और व्यवहार को नहीं बदलना चाहिए।
- `reject(reason)` तब लागू करें जब discard को क्लीनअप की आवश्यकता हो (अस्थायी स्थिति, लॉक, सूचनाएँ); स्टेटलेस प्रीव्यू के लिए इसे छोड़ दें जहाँ डिफ़ॉल्ट संदेश पर्याप्त हो।
- यदि आपका टूल एकाधिक प्रीव्यू स्टेज कर सकता है, तो LIFO सेमेंटिक्स याद रखें: सबसे बाद में पुश किया गया एक्शन पहले रिज़ॉल्व होता है।
