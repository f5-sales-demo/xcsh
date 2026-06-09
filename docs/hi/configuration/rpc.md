---
title: RPC प्रोटोकॉल संदर्भ
description: xcsh घटकों के बीच अंतर-प्रक्रिया संचार के लिए JSON-RPC प्रोटोकॉल संदर्भ।
sidebar:
  order: 5
  label: RPC प्रोटोकॉल
i18n:
  sourceHash: b4a3ddaf08ab
  translator: machine
---

# RPC प्रोटोकॉल संदर्भ

RPC मोड कोडिंग एजेंट को stdio पर न्यूलाइन-डीलिमिटेड JSON प्रोटोकॉल के रूप में चलाता है।

- **stdin**: कमांड (`RpcCommand`) और एक्सटेंशन UI प्रतिक्रियाएँ
- **stdout**: कमांड प्रतिक्रियाएँ (`RpcResponse`), सेशन/एजेंट इवेंट, एक्सटेंशन UI अनुरोध

प्राथमिक कार्यान्वयन:

- `src/modes/rpc/rpc-mode.ts`
- `src/modes/rpc/rpc-types.ts`
- `src/session/agent-session.ts`
- `packages/agent/src/agent.ts`
- `packages/agent/src/agent-loop.ts`

## स्टार्टअप

```bash
xcsh --mode rpc [regular CLI options]
```

व्यवहार संबंधी नोट:

- RPC मोड में `@file` CLI आर्गुमेंट अस्वीकार किए जाते हैं।
- RPC मोड अतिरिक्त मॉडल कॉल से बचने के लिए डिफ़ॉल्ट रूप से स्वचालित सेशन शीर्षक जनरेशन को अक्षम करता है।
- RPC मोड वर्कफ़्लो-बदलने वाली `todo.*`, `task.*`, और `async.*` सेटिंग्स को उपयोगकर्ता ओवरराइड इनहेरिट करने के बजाय उनके बिल्ट-इन डिफ़ॉल्ट पर रीसेट करता है।
- प्रक्रिया stdin को JSONL (`readJsonl(Bun.stdin.stream())`) के रूप में पढ़ती है।
- जब stdin बंद होता है, तो प्रक्रिया कोड `0` के साथ बाहर निकलती है।
- प्रतिक्रियाएँ/इवेंट प्रति पंक्ति एक JSON ऑब्जेक्ट के रूप में लिखे जाते हैं।

## ट्रांसपोर्ट और फ़्रेमिंग

प्रत्येक फ़्रेम एक एकल JSON ऑब्जेक्ट है जिसके बाद `\n` आता है।

ऑब्जेक्ट शेप के अलावा कोई एनवेलप नहीं है।

### आउटबाउंड फ़्रेम श्रेणियाँ (stdout)

1. `RpcResponse` (`{ type: "response", ... }`)
2. `AgentSessionEvent` ऑब्जेक्ट (`agent_start`, `message_update`, आदि)
3. `RpcExtensionUIRequest` (`{ type: "extension_ui_request", ... }`)
4. एक्सटेंशन त्रुटियाँ (`{ type: "extension_error", extensionPath, event, error }`)

### इनबाउंड फ़्रेम श्रेणियाँ (stdin)

1. `RpcCommand`
2. `RpcExtensionUIResponse` (`{ type: "extension_ui_response", ... }`)

## अनुरोध/प्रतिक्रिया सहसंबंध

सभी कमांड वैकल्पिक `id?: string` स्वीकार करते हैं।

- यदि प्रदान किया जाता है, तो सामान्य कमांड प्रतिक्रियाएँ उसी `id` को इको करती हैं।
- `RpcClient` लंबित-अनुरोध समाधान के लिए इस पर निर्भर करता है।

रनटाइम से महत्वपूर्ण एज व्यवहार:

- अज्ञात कमांड प्रतिक्रियाएँ `id: undefined` के साथ उत्सर्जित होती हैं (भले ही अनुरोध में `id` हो)।
- इनपुट लूप में पार्स/हैंडलर अपवाद `command: "parse"` को `id: undefined` के साथ उत्सर्जित करते हैं।
- `prompt` और `abort_and_prompt` तत्काल सफलता लौटाते हैं, फिर यदि एसिंक प्रॉम्प्ट शेड्यूलिंग विफल हो जाती है तो **उसी** id के साथ बाद में एक त्रुटि प्रतिक्रिया उत्सर्जित कर सकते हैं।

## कमांड स्कीमा (कैनोनिकल)

`RpcCommand` को `src/modes/rpc/rpc-types.ts` में परिभाषित किया गया है:

### प्रॉम्प्टिंग

- `{ id?, type: "prompt", message: string, images?: ImageContent[], streamingBehavior?: "steer" | "followUp" }`
- `{ id?, type: "steer", message: string, images?: ImageContent[] }`
- `{ id?, type: "follow_up", message: string, images?: ImageContent[] }`
- `{ id?, type: "abort" }`
- `{ id?, type: "abort_and_prompt", message: string, images?: ImageContent[] }`
- `{ id?, type: "new_session", parentSession?: string }`

### स्थिति

- `{ id?, type: "get_state" }`
- `{ id?, type: "set_todos", phases: TodoPhase[] }`
- `{ id?, type: "set_host_tools", tools: RpcHostToolDefinition[] }`

### मॉडल

- `{ id?, type: "set_model", provider: string, modelId: string }`
- `{ id?, type: "cycle_model" }`
- `{ id?, type: "get_available_models" }`

### थिंकिंग

- `{ id?, type: "set_thinking_level", level: ThinkingLevel }`
- `{ id?, type: "cycle_thinking_level" }`

### क्यू मोड

- `{ id?, type: "set_steering_mode", mode: "all" | "one-at-a-time" }`
- `{ id?, type: "set_follow_up_mode", mode: "all" | "one-at-a-time" }`
- `{ id?, type: "set_interrupt_mode", mode: "immediate" | "wait" }`

### कॉम्पैक्शन

- `{ id?, type: "compact", customInstructions?: string }`
- `{ id?, type: "set_auto_compaction", enabled: boolean }`

### पुनः प्रयास

- `{ id?, type: "set_auto_retry", enabled: boolean }`
- `{ id?, type: "abort_retry" }`

### Bash

- `{ id?, type: "bash", command: string }`
- `{ id?, type: "abort_bash" }`

### सेशन

- `{ id?, type: "get_session_stats" }`
- `{ id?, type: "export_html", outputPath?: string }`
- `{ id?, type: "switch_session", sessionPath: string }`
- `{ id?, type: "branch", entryId: string }`
- `{ id?, type: "get_branch_messages" }`
- `{ id?, type: "get_last_assistant_text" }`
- `{ id?, type: "set_session_name", name: string }`

### संदेश

- `{ id?, type: "get_messages" }`

## प्रतिक्रिया स्कीमा

सभी कमांड परिणाम `RpcResponse` का उपयोग करते हैं:

- सफलता: `{ id?, type: "response", command: <command>, success: true, data?: ... }`
- विफलता: `{ id?, type: "response", command: string, success: false, error: string }`

डेटा पेलोड कमांड-विशिष्ट हैं और `rpc-types.ts` में परिभाषित हैं।

### `get_state` पेलोड

```json
{
  "model": { "provider": "...", "id": "..." },
  "thinkingLevel": "off|minimal|low|medium|high|xhigh",
  "isStreaming": false,
  "isCompacting": false,
  "steeringMode": "all|one-at-a-time",
  "followUpMode": "all|one-at-a-time",
  "interruptMode": "immediate|wait",
  "sessionFile": "...",
  "sessionId": "...",
  "sessionName": "...",
  "autoCompactionEnabled": true,
  "messageCount": 0,
  "queuedMessageCount": 0,
  "todoPhases": [
    {
      "id": "phase-1",
      "name": "Todos",
      "tasks": [
        {
          "id": "task-1",
          "content": "Map the tool surface",
          "status": "in_progress"
        }
      ]
    }
  ]
}
```

### `set_todos` पेलोड

वर्तमान सेशन के लिए इन-मेमोरी टूडू स्थिति को बदलता है और सामान्यीकृत फ़ेज़ सूची लौटाता है:

```json
{
  "id": "req_2",
  "type": "set_todos",
  "phases": [
    {
      "id": "phase-1",
      "name": "Evaluation",
      "tasks": [
        {
          "id": "task-1",
          "content": "Map the read tool surface",
          "status": "in_progress"
        },
        {
          "id": "task-2",
          "content": "Exercise edit operations",
          "status": "pending"
        }
      ]
    }
  ]
}
```

यह उन होस्ट के लिए उपयोगी है जो पहले प्रॉम्प्ट से पहले एक योजना को प्री-सीड करना चाहते हैं।

### `set_host_tools` पेलोड

होस्ट-स्वामित्व वाले टूल के वर्तमान सेट को बदलता है जिन्हें RPC सर्वर stdio पर वापस
कॉल कर सकता है:

```json
{
  "id": "req_3",
  "type": "set_host_tools",
  "tools": [
    {
      "name": "echo_host",
      "label": "Echo Host",
      "description": "Echo a value from the embedding host",
      "parameters": {
        "type": "object",
        "properties": {
          "message": { "type": "string" }
        },
        "required": ["message"],
        "additionalProperties": false
      }
    }
  ]
}
```

प्रतिक्रिया पेलोड है:

```json
{
  "toolNames": ["echo_host"]
}
```

ये टूल अगले मॉडल कॉल से पहले सक्रिय सेशन टूल रजिस्ट्री में जोड़े जाते हैं। `set_host_tools` को पुनः भेजने से पिछले होस्ट-स्वामित्व वाले सेट को बदल दिया जाता है।

## इवेंट स्ट्रीम स्कीमा

RPC मोड `AgentSession.subscribe(...)` से `AgentSessionEvent` ऑब्जेक्ट को फ़ॉरवर्ड करता है।

सामान्य इवेंट प्रकार:

- `agent_start`, `agent_end`
- `turn_start`, `turn_end`
- `message_start`, `message_update`, `message_end`
- `tool_execution_start`, `tool_execution_update`, `tool_execution_end`
- `auto_compaction_start`, `auto_compaction_end`
- `auto_retry_start`, `auto_retry_end`
- `ttsr_triggered`
- `todo_reminder`
- `todo_auto_clear`

एक्सटेंशन रनर त्रुटियाँ अलग से उत्सर्जित होती हैं:

```json
{ "type": "extension_error", "extensionPath": "...", "event": "...", "error": "..." }
```

`message_update` में `assistantMessageEvent` (text/thinking/toolcall डेल्टा) में स्ट्रीमिंग डेल्टा शामिल होते हैं।

## प्रॉम्प्ट/क्यू समवर्तिता और क्रम

यह सबसे महत्वपूर्ण संचालन व्यवहार है।

### तत्काल स्वीकृति बनाम पूर्णता

`prompt` और `abort_and_prompt` **तत्काल स्वीकृत** होते हैं:

```json
{ "id": "req_1", "type": "response", "command": "prompt", "success": true }
```

इसका अर्थ है:

- कमांड स्वीकृति != रन पूर्णता
- अंतिम पूर्णता `agent_end` के माध्यम से देखी जाती है

### स्ट्रीमिंग के दौरान

`AgentSession.prompt()` को सक्रिय स्ट्रीमिंग के दौरान `streamingBehavior` की आवश्यकता होती है:

- `"steer"` => क्यूड स्टीयरिंग संदेश (इंटरप्ट पथ)
- `"followUp"` => क्यूड फ़ॉलो-अप संदेश (पोस्ट-टर्न पथ)

यदि स्ट्रीमिंग के दौरान छोड़ दिया जाता है, तो प्रॉम्प्ट विफल हो जाता है।

### क्यू डिफ़ॉल्ट

कोडिंग-एजेंट सेटिंग्स स्कीमा (`packages/coding-agent/src/config/settings-schema.ts`) से:

- `steeringMode`: `"one-at-a-time"`
- `followUpMode`: `"one-at-a-time"`
- `interruptMode`: `"wait"`

### मोड सिमेंटिक्स

- `set_steering_mode` / `set_follow_up_mode`
  - `"one-at-a-time"`: प्रति टर्न एक क्यूड संदेश डीक्यू करें
  - `"all"`: पूरी क्यू एक साथ डीक्यू करें
- `set_interrupt_mode`
  - `"immediate"`: टूल एक्ज़ीक्यूशन टूल कॉल के बीच स्टीयरिंग की जाँच करता है; लंबित स्टीयरिंग टर्न में शेष टूल कॉल को रद्द कर सकता है
  - `"wait"`: टर्न पूर्णता तक स्टीयरिंग को स्थगित करें

## एक्सटेंशन UI उप-प्रोटोकॉल

RPC मोड में एक्सटेंशन अनुरोध/प्रतिक्रिया UI फ़्रेम का उपयोग करते हैं।

### आउटबाउंड अनुरोध

`RpcExtensionUIRequest` (`type: "extension_ui_request"`) मेथड:

- `select`, `confirm`, `input`, `editor`
- `notify`, `setStatus`, `setWidget`, `setTitle`, `set_editor_text`

रनटाइम नोट:

- RPC मोड में स्वचालित सेशन शीर्षक जनरेशन अक्षम है, और `setTitle` UI
  अनुरोध भी डिफ़ॉल्ट रूप से दबा दिए जाते हैं क्योंकि अधिकांश होस्ट के पास
  एक सार्थक टर्मिनल-शीर्षक सतह नहीं होती। केवल UI इवेंट के लिए वापस ऑप्ट-इन
  करने हेतु `PI_RPC_EMIT_TITLE=1` सेट करें।

उदाहरण:

```json
{ "type": "extension_ui_request", "id": "123", "method": "confirm", "title": "Confirm", "message": "Continue?", "timeout": 30000 }
```

### इनबाउंड प्रतिक्रिया

`RpcExtensionUIResponse` (`type: "extension_ui_response"`):

- `{ type: "extension_ui_response", id: string, value: string }`
- `{ type: "extension_ui_response", id: string, confirmed: boolean }`
- `{ type: "extension_ui_response", id: string, cancelled: true }`

यदि किसी डायलॉग में टाइमआउट है, तो RPC मोड टाइमआउट/एबॉर्ट होने पर डिफ़ॉल्ट मान के साथ रिज़ॉल्व करता है।

## होस्ट टूल उप-प्रोटोकॉल

RPC होस्ट `set_host_tools` भेजकर एजेंट को कस्टम टूल उपलब्ध करा सकते हैं, फिर
उसी ट्रांसपोर्ट पर एक्ज़ीक्यूशन अनुरोधों की सेवा कर सकते हैं।

### आउटबाउंड अनुरोध

जब एजेंट चाहता है कि होस्ट उन टूल में से किसी एक को निष्पादित करे, तो RPC मोड उत्सर्जित करता है:

```json
{
  "type": "host_tool_call",
  "id": "host_1",
  "toolCallId": "toolu_123",
  "toolName": "echo_host",
  "arguments": { "message": "hello" }
}
```

यदि टूल एक्ज़ीक्यूशन बाद में रद्द किया जाता है, तो RPC मोड उत्सर्जित करता है:

```json
{
  "type": "host_tool_cancel",
  "id": "host_cancel_1",
  "targetId": "host_1"
}
```

### इनबाउंड अपडेट और पूर्णता

होस्ट वैकल्पिक रूप से प्रगति स्ट्रीम कर सकते हैं:

```json
{
  "type": "host_tool_update",
  "id": "host_1",
  "partialResult": {
    "content": [{ "type": "text", "text": "working" }]
  }
}
```

पूर्णता इस प्रकार होती है:

```json
{
  "type": "host_tool_result",
  "id": "host_1",
  "result": {
    "content": [{ "type": "text", "text": "done" }]
  }
}
```

लौटाई गई सामग्री को टूल त्रुटि के रूप में सामने लाने के लिए `host_tool_result` पर `isError: true` सेट करें।

## त्रुटि मॉडल और पुनर्प्राप्ति क्षमता

### कमांड-स्तरीय विफलताएँ

विफलताएँ स्ट्रिंग `error` के साथ `success: false` होती हैं।

```json
{ "id": "req_2", "type": "response", "command": "set_model", "success": false, "error": "Model not found: provider/model" }
```

### पुनर्प्राप्ति क्षमता अपेक्षाएँ

- अधिकांश कमांड विफलताएँ पुनर्प्राप्ति योग्य हैं; प्रक्रिया जीवित रहती है।
- विकृत JSONL / पार्स-लूप अपवाद एक `parse` त्रुटि प्रतिक्रिया उत्सर्जित करते हैं और बाद की पंक्तियों को पढ़ना जारी रखते हैं।
- खाली `set_session_name` अस्वीकार किया जाता है (`Session name cannot be empty`)।
- अज्ञात `id` वाली एक्सटेंशन UI प्रतिक्रियाएँ अनदेखी की जाती हैं।
- प्रक्रिया समाप्ति की स्थितियाँ stdin बंद होना या एक्सटेंशन-ट्रिगर्ड शटडाउन हैं।

## संक्षिप्त कमांड प्रवाह

### 1) प्रॉम्प्ट और स्ट्रीम

stdin:

```json
{ "id": "req_1", "type": "prompt", "message": "Summarize this repo" }
```

stdout अनुक्रम (विशिष्ट):

```json
{ "id": "req_1", "type": "response", "command": "prompt", "success": true }
{ "type": "agent_start" }
{ "type": "message_update", "assistantMessageEvent": { "type": "text_delta", "delta": "..." }, "message": { "role": "assistant", "content": [] } }
{ "type": "agent_end", "messages": [] }
```

### 2) स्पष्ट क्यू नीति के साथ स्ट्रीमिंग के दौरान प्रॉम्प्ट

stdin:

```json
{ "id": "req_2", "type": "prompt", "message": "Also include risks", "streamingBehavior": "followUp" }
```

### 3) क्यू व्यवहार का निरीक्षण और समायोजन

stdin:

```json
{ "id": "q1", "type": "get_state" }
{ "id": "q2", "type": "set_steering_mode", "mode": "all" }
{ "id": "q3", "type": "set_interrupt_mode", "mode": "wait" }
```

### 4) एक्सटेंशन UI राउंड ट्रिप

stdout:

```json
{ "type": "extension_ui_request", "id": "ui_7", "method": "input", "title": "Branch name", "placeholder": "feature/..." }
```

stdin:

```json
{ "type": "extension_ui_response", "id": "ui_7", "value": "feature/rpc-host" }
```

## `RpcClient` हेल्पर पर नोट्स

`src/modes/rpc/rpc-client.ts` एक सुविधा रैपर है, प्रोटोकॉल परिभाषा नहीं।

वर्तमान हेल्पर विशेषताएँ:

- `bun <cliPath> --mode rpc` स्पॉन करता है
- जनरेटेड `req_<n>` id द्वारा प्रतिक्रियाओं को सहसंबंधित करता है
- केवल मान्यता प्राप्त `AgentEvent` प्रकारों को श्रोताओं को डिस्पैच करता है
- `setCustomTools()` और `host_tool_call` / `host_tool_cancel` के स्वचालित संचालन के माध्यम से होस्ट-स्वामित्व वाले कस्टम टूल का समर्थन करता है
- प्रत्येक प्रोटोकॉल कमांड के लिए हेल्पर मेथड उपलब्ध **नहीं** कराता (उदाहरण के लिए, `set_interrupt_mode` और `set_session_name` प्रोटोकॉल प्रकारों में हैं लेकिन समर्पित मेथड के रूप में रैप नहीं किए गए हैं)

यदि आपको पूर्ण सतह कवरेज की आवश्यकता है तो कच्चे प्रोटोकॉल फ़्रेम का उपयोग करें।
