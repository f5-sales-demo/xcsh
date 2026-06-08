---
title: RPC Protocol Reference
description: >-
  JSON-RPC protocol reference for inter-process communication between xcsh
  components.
sidebar:
  order: 5
  label: RPC protocol
i18n:
  sourceHash: b4a3ddaf08ab
  translator: machine
---

# مرجع بروتوكول RPC

يشغّل وضع RPC وكيل البرمجة كبروتوكول JSON محدد بأسطر جديدة عبر stdio.

- **stdin**: الأوامر (`RpcCommand`) واستجابات واجهة المستخدم الخاصة بالإضافات
- **stdout**: استجابات الأوامر (`RpcResponse`)، أحداث الجلسة/الوكيل، طلبات واجهة المستخدم الخاصة بالإضافات

التنفيذ الأساسي:

- `src/modes/rpc/rpc-mode.ts`
- `src/modes/rpc/rpc-types.ts`
- `src/session/agent-session.ts`
- `packages/agent/src/agent.ts`
- `packages/agent/src/agent-loop.ts`

## بدء التشغيل

```bash
xcsh --mode rpc [regular CLI options]
```

ملاحظات حول السلوك:

- يتم رفض وسائط CLI من نوع `@file` في وضع RPC.
- يعطّل وضع RPC التوليد التلقائي لعنوان الجلسة افتراضيًا لتجنب استدعاء إضافي للنموذج.
- يعيد وضع RPC تعيين إعدادات `todo.*` و `task.*` و `async.*` التي تغيّر سير العمل إلى قيمها الافتراضية المدمجة بدلاً من وراثة تخصيصات المستخدم.
- تقرأ العملية stdin كـ JSONL (`readJsonl(Bun.stdin.stream())`).
- عند إغلاق stdin، تنتهي العملية برمز خروج `0`.
- تُكتب الاستجابات/الأحداث ككائن JSON واحد لكل سطر.

## النقل والتأطير

كل إطار هو كائن JSON واحد متبوعًا بـ `\n`.

لا يوجد غلاف يتجاوز شكل الكائن نفسه.

### فئات الإطارات الصادرة (stdout)

1. `RpcResponse` (`{ type: "response", ... }`)
2. كائنات `AgentSessionEvent` (`agent_start`، `message_update`، إلخ.)
3. `RpcExtensionUIRequest` (`{ type: "extension_ui_request", ... }`)
4. أخطاء الإضافات (`{ type: "extension_error", extensionPath, event, error }`)

### فئات الإطارات الواردة (stdin)

1. `RpcCommand`
2. `RpcExtensionUIResponse` (`{ type: "extension_ui_response", ... }`)

## ربط الطلب/الاستجابة

تقبل جميع الأوامر معرّفًا اختياريًا `id?: string`.

- إذا تم توفيره، تعيد استجابات الأوامر العادية نفس `id`.
- يعتمد `RpcClient` على هذا لحل الطلبات المعلقة.

سلوك حدودي مهم من وقت التشغيل:

- يتم إصدار استجابات الأوامر غير المعروفة مع `id: undefined` (حتى لو كان للطلب `id`).
- تصدر استثناءات التحليل/المعالجة في حلقة الإدخال `command: "parse"` مع `id: undefined`.
- يعيد `prompt` و `abort_and_prompt` نجاحًا فوريًا، ثم قد يصدران استجابة خطأ لاحقة بنفس `id` إذا فشلت جدولة الموجه غير المتزامنة.

## مخطط الأوامر (قياسي)

`RpcCommand` معرّف في `src/modes/rpc/rpc-types.ts`:

### التوجيه

- `{ id?, type: "prompt", message: string, images?: ImageContent[], streamingBehavior?: "steer" | "followUp" }`
- `{ id?, type: "steer", message: string, images?: ImageContent[] }`
- `{ id?, type: "follow_up", message: string, images?: ImageContent[] }`
- `{ id?, type: "abort" }`
- `{ id?, type: "abort_and_prompt", message: string, images?: ImageContent[] }`
- `{ id?, type: "new_session", parentSession?: string }`

### الحالة

- `{ id?, type: "get_state" }`
- `{ id?, type: "set_todos", phases: TodoPhase[] }`
- `{ id?, type: "set_host_tools", tools: RpcHostToolDefinition[] }`

### النموذج

- `{ id?, type: "set_model", provider: string, modelId: string }`
- `{ id?, type: "cycle_model" }`
- `{ id?, type: "get_available_models" }`

### التفكير

- `{ id?, type: "set_thinking_level", level: ThinkingLevel }`
- `{ id?, type: "cycle_thinking_level" }`

### أوضاع قائمة الانتظار

- `{ id?, type: "set_steering_mode", mode: "all" | "one-at-a-time" }`
- `{ id?, type: "set_follow_up_mode", mode: "all" | "one-at-a-time" }`
- `{ id?, type: "set_interrupt_mode", mode: "immediate" | "wait" }`

### الضغط

- `{ id?, type: "compact", customInstructions?: string }`
- `{ id?, type: "set_auto_compaction", enabled: boolean }`

### إعادة المحاولة

- `{ id?, type: "set_auto_retry", enabled: boolean }`
- `{ id?, type: "abort_retry" }`

### Bash

- `{ id?, type: "bash", command: string }`
- `{ id?, type: "abort_bash" }`

### الجلسة

- `{ id?, type: "get_session_stats" }`
- `{ id?, type: "export_html", outputPath?: string }`
- `{ id?, type: "switch_session", sessionPath: string }`
- `{ id?, type: "branch", entryId: string }`
- `{ id?, type: "get_branch_messages" }`
- `{ id?, type: "get_last_assistant_text" }`
- `{ id?, type: "set_session_name", name: string }`

### الرسائل

- `{ id?, type: "get_messages" }`

## مخطط الاستجابة

تستخدم جميع نتائج الأوامر `RpcResponse`:

- النجاح: `{ id?, type: "response", command: <command>, success: true, data?: ... }`
- الفشل: `{ id?, type: "response", command: string, success: false, error: string }`

حمولات البيانات خاصة بكل أمر ومعرّفة في `rpc-types.ts`.

### حمولة `get_state`

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

### حمولة `set_todos`

تستبدل حالة المهام في الذاكرة للجلسة الحالية وتعيد قائمة المراحل المُعيّرة:

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

هذا مفيد للمضيفين الذين يرغبون في تهيئة خطة مسبقة قبل أول موجه.

### حمولة `set_host_tools`

تستبدل المجموعة الحالية من الأدوات المملوكة للمضيف التي يمكن لخادم RPC استدعاؤها
عبر stdio:

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

حمولة الاستجابة هي:

```json
{
  "toolNames": ["echo_host"]
}
```

تُضاف هذه الأدوات إلى سجل أدوات الجلسة النشطة قبل استدعاء النموذج التالي.
إعادة إرسال `set_host_tools` تستبدل المجموعة السابقة المملوكة للمضيف.

## مخطط تدفق الأحداث

يقوم وضع RPC بتمرير كائنات `AgentSessionEvent` من `AgentSession.subscribe(...)`.

أنواع الأحداث الشائعة:

- `agent_start`، `agent_end`
- `turn_start`، `turn_end`
- `message_start`، `message_update`، `message_end`
- `tool_execution_start`، `tool_execution_update`، `tool_execution_end`
- `auto_compaction_start`، `auto_compaction_end`
- `auto_retry_start`، `auto_retry_end`
- `ttsr_triggered`
- `todo_reminder`
- `todo_auto_clear`

تُصدر أخطاء مشغّل الإضافات بشكل منفصل كالتالي:

```json
{ "type": "extension_error", "extensionPath": "...", "event": "...", "error": "..." }
```

يتضمن `message_update` دلتا البث في `assistantMessageEvent` (دلتا النص/التفكير/استدعاء الأدوات).

## التزامن والترتيب في الموجهات/قائمة الانتظار

هذا هو أهم سلوك تشغيلي.

### الإقرار الفوري مقابل الاكتمال

يتم **الإقرار فوريًا** بـ `prompt` و `abort_and_prompt`:

```json
{ "id": "req_1", "type": "response", "command": "prompt", "success": true }
```

هذا يعني:

- قبول الأمر ≠ اكتمال التنفيذ
- يُلاحظ الاكتمال النهائي عبر `agent_end`

### أثناء البث

يتطلب `AgentSession.prompt()` تحديد `streamingBehavior` أثناء البث النشط:

- `"steer"` => رسالة توجيه في قائمة الانتظار (مسار المقاطعة)
- `"followUp"` => رسالة متابعة في قائمة الانتظار (مسار ما بعد الدور)

إذا تم حذفه أثناء البث، يفشل الموجه.

### القيم الافتراضية لقائمة الانتظار

من مخطط إعدادات وكيل البرمجة (`packages/coding-agent/src/config/settings-schema.ts`):

- `steeringMode`: `"one-at-a-time"`
- `followUpMode`: `"one-at-a-time"`
- `interruptMode`: `"wait"`

### دلالات الأوضاع

- `set_steering_mode` / `set_follow_up_mode`
  - `"one-at-a-time"`: سحب رسالة واحدة من قائمة الانتظار لكل دور
  - `"all"`: سحب قائمة الانتظار بالكامل دفعة واحدة
- `set_interrupt_mode`
  - `"immediate"`: يتحقق تنفيذ الأدوات من التوجيه بين استدعاءات الأدوات؛ يمكن للتوجيه المعلق إلغاء استدعاءات الأدوات المتبقية في الدور
  - `"wait"`: تأجيل التوجيه حتى اكتمال الدور

## البروتوكول الفرعي لواجهة مستخدم الإضافات

تستخدم الإضافات في وضع RPC إطارات طلب/استجابة لواجهة المستخدم.

### الطلب الصادر

طرق `RpcExtensionUIRequest` (`type: "extension_ui_request"`):

- `select`، `confirm`، `input`، `editor`
- `notify`، `setStatus`، `setWidget`، `setTitle`، `set_editor_text`

ملاحظة وقت التشغيل:

- التوليد التلقائي لعنوان الجلسة معطّل في وضع RPC، كما يتم كبت طلبات واجهة المستخدم
  من نوع `setTitle` افتراضيًا لأن معظم المضيفين ليس لديهم سطح عنوان طرفية
  ذو معنى. قم بتعيين `PI_RPC_EMIT_TITLE=1` لإعادة تفعيل حدث واجهة المستخدم فقط.

مثال:

```json
{ "type": "extension_ui_request", "id": "123", "method": "confirm", "title": "Confirm", "message": "Continue?", "timeout": 30000 }
```

### الاستجابة الواردة

`RpcExtensionUIResponse` (`type: "extension_ui_response"`):

- `{ type: "extension_ui_response", id: string, value: string }`
- `{ type: "extension_ui_response", id: string, confirmed: boolean }`
- `{ type: "extension_ui_response", id: string, cancelled: true }`

إذا كان لمربع الحوار مهلة زمنية، يقوم وضع RPC بالحل إلى قيمة افتراضية عند انقضاء المهلة/الإلغاء.

## البروتوكول الفرعي لأدوات المضيف

يمكن لمضيفي RPC كشف أدوات مخصصة للوكيل عن طريق إرسال `set_host_tools`، ثم
خدمة طلبات التنفيذ عبر نفس وسيلة النقل.

### الطلب الصادر

عندما يريد الوكيل من المضيف تنفيذ إحدى تلك الأدوات، يصدر وضع RPC:

```json
{
  "type": "host_tool_call",
  "id": "host_1",
  "toolCallId": "toolu_123",
  "toolName": "echo_host",
  "arguments": { "message": "hello" }
}
```

إذا تم إلغاء تنفيذ الأداة لاحقًا، يصدر وضع RPC:

```json
{
  "type": "host_tool_cancel",
  "id": "host_cancel_1",
  "targetId": "host_1"
}
```

### التحديثات الواردة والاكتمال

يمكن للمضيفين اختياريًا بث التقدم:

```json
{
  "type": "host_tool_update",
  "id": "host_1",
  "partialResult": {
    "content": [{ "type": "text", "text": "working" }]
  }
}
```

يستخدم الاكتمال:

```json
{
  "type": "host_tool_result",
  "id": "host_1",
  "result": {
    "content": [{ "type": "text", "text": "done" }]
  }
}
```

قم بتعيين `isError: true` على `host_tool_result` لإظهار المحتوى المُرجع كخطأ
أداة.

## نموذج الأخطاء وقابلية الاستعادة

### إخفاقات مستوى الأمر

الإخفاقات تكون `success: false` مع `error` كنص:

```json
{ "id": "req_2", "type": "response", "command": "set_model", "success": false, "error": "Model not found: provider/model" }
```

### توقعات قابلية الاستعادة

- معظم إخفاقات الأوامر قابلة للاستعادة؛ تبقى العملية نشطة.
- أخطاء JSONL المشوّهة / استثناءات حلقة التحليل تصدر استجابة خطأ `parse` وتستمر في قراءة الأسطر التالية.
- يتم رفض `set_session_name` الفارغ (`Session name cannot be empty`).
- يتم تجاهل استجابات واجهة مستخدم الإضافات ذات `id` غير معروف.
- شروط إنهاء العملية هي إغلاق stdin أو إيقاف تشغيل صريح تطلقه إضافة.

## تدفقات الأوامر المختصرة

### 1) موجه وبث

stdin:

```json
{ "id": "req_1", "type": "prompt", "message": "Summarize this repo" }
```

تسلسل stdout (نموذجي):

```json
{ "id": "req_1", "type": "response", "command": "prompt", "success": true }
{ "type": "agent_start" }
{ "type": "message_update", "assistantMessageEvent": { "type": "text_delta", "delta": "..." }, "message": { "role": "assistant", "content": [] } }
{ "type": "agent_end", "messages": [] }
```

### 2) موجه أثناء البث مع سياسة قائمة انتظار صريحة

stdin:

```json
{ "id": "req_2", "type": "prompt", "message": "Also include risks", "streamingBehavior": "followUp" }
```

### 3) فحص وضبط سلوك قائمة الانتظار

stdin:

```json
{ "id": "q1", "type": "get_state" }
{ "id": "q2", "type": "set_steering_mode", "mode": "all" }
{ "id": "q3", "type": "set_interrupt_mode", "mode": "wait" }
```

### 4) دورة كاملة لواجهة مستخدم الإضافات

stdout:

```json
{ "type": "extension_ui_request", "id": "ui_7", "method": "input", "title": "Branch name", "placeholder": "feature/..." }
```

stdin:

```json
{ "type": "extension_ui_response", "id": "ui_7", "value": "feature/rpc-host" }
```

## ملاحظات حول مساعد `RpcClient`

`src/modes/rpc/rpc-client.ts` هو غلاف تسهيلي وليس تعريف البروتوكول.

خصائص المساعد الحالية:

- يشغّل `bun <cliPath> --mode rpc`
- يربط الاستجابات بمعرّفات `req_<n>` المولّدة
- يرسل فقط أنواع `AgentEvent` المعروفة إلى المستمعين
- يدعم الأدوات المخصصة المملوكة للمضيف عبر `setCustomTools()` والمعالجة التلقائية لـ `host_tool_call` / `host_tool_cancel`
- **لا** يوفر طرق مساعدة لكل أمر في البروتوكول (على سبيل المثال، `set_interrupt_mode` و `set_session_name` موجودان في أنواع البروتوكول لكن ليس لهما طرق مخصصة مغلّفة)

استخدم إطارات البروتوكول الخام إذا كنت بحاجة إلى تغطية السطح الكاملة.
