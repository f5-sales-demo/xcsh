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

# เอกสารอ้างอิงโปรโตคอล RPC

โหมด RPC รัน coding agent เป็นโปรโตคอล JSON แบบคั่นด้วยบรรทัดใหม่ผ่าน stdio

- **stdin**: คำสั่ง (`RpcCommand`) และการตอบกลับ UI ของ extension
- **stdout**: การตอบกลับคำสั่ง (`RpcResponse`), เหตุการณ์ session/agent, คำขอ UI ของ extension

การ implement หลัก:

- `src/modes/rpc/rpc-mode.ts`
- `src/modes/rpc/rpc-types.ts`
- `src/session/agent-session.ts`
- `packages/agent/src/agent.ts`
- `packages/agent/src/agent-loop.ts`

## การเริ่มต้น

```bash
xcsh --mode rpc [regular CLI options]
```

หมายเหตุเกี่ยวกับพฤติกรรม:

- อาร์กิวเมนต์ CLI แบบ `@file` ถูกปฏิเสธในโหมด RPC
- โหมด RPC ปิดการสร้างชื่อ session อัตโนมัติตามค่าเริ่มต้นเพื่อหลีกเลี่ยงการเรียก model เพิ่มเติม
- โหมด RPC รีเซ็ตการตั้งค่าที่เปลี่ยนแปลง workflow ได้แก่ `todo.*`, `task.*` และ `async.*` กลับไปเป็นค่าเริ่มต้นที่ built-in แทนที่จะรับค่าจากการปรับแต่งของผู้ใช้
- โปรเซสอ่าน stdin เป็น JSONL (`readJsonl(Bun.stdin.stream())`)
- เมื่อ stdin ปิด โปรเซสจะออกด้วยรหัส `0`
- การตอบกลับ/เหตุการณ์จะถูกเขียนเป็นอ็อบเจกต์ JSON หนึ่งรายการต่อบรรทัด

## การขนส่งและการจัดเฟรม

แต่ละเฟรมเป็นอ็อบเจกต์ JSON หนึ่งรายการตามด้วย `\n`

ไม่มี envelope อื่นนอกเหนือจากรูปร่างของอ็อบเจกต์เอง

### หมวดหมู่เฟรมขาออก (stdout)

1. `RpcResponse` (`{ type: "response", ... }`)
2. อ็อบเจกต์ `AgentSessionEvent` (`agent_start`, `message_update` เป็นต้น)
3. `RpcExtensionUIRequest` (`{ type: "extension_ui_request", ... }`)
4. ข้อผิดพลาดของ extension (`{ type: "extension_error", extensionPath, event, error }`)

### หมวดหมู่เฟรมขาเข้า (stdin)

1. `RpcCommand`
2. `RpcExtensionUIResponse` (`{ type: "extension_ui_response", ... }`)

## การเชื่อมโยง Request/Response

คำสั่งทั้งหมดรับค่า `id?: string` ที่เป็นตัวเลือก

- หากระบุ การตอบกลับคำสั่งปกติจะส่ง `id` เดิมกลับมา
- `RpcClient` พึ่งพาสิ่งนี้สำหรับการ resolve คำขอที่ค้างอยู่

พฤติกรรมขอบเขตที่สำคัญจาก runtime:

- การตอบกลับคำสั่งที่ไม่รู้จักจะถูกส่งออกด้วย `id: undefined` (แม้ว่าคำขอจะมี `id`)
- ข้อยกเว้น parse/handler ใน input loop จะส่ง `command: "parse"` ด้วย `id: undefined`
- `prompt` และ `abort_and_prompt` ส่งคืนความสำเร็จทันที จากนั้นอาจส่งการตอบกลับข้อผิดพลาดในภายหลังด้วย `id` **เดิม** หากการจัดตาราง prompt แบบ async ล้มเหลว

## สคีมาคำสั่ง (canonical)

`RpcCommand` ถูกนิยามใน `src/modes/rpc/rpc-types.ts`:

### การ Prompt

- `{ id?, type: "prompt", message: string, images?: ImageContent[], streamingBehavior?: "steer" | "followUp" }`
- `{ id?, type: "steer", message: string, images?: ImageContent[] }`
- `{ id?, type: "follow_up", message: string, images?: ImageContent[] }`
- `{ id?, type: "abort" }`
- `{ id?, type: "abort_and_prompt", message: string, images?: ImageContent[] }`
- `{ id?, type: "new_session", parentSession?: string }`

### สถานะ

- `{ id?, type: "get_state" }`
- `{ id?, type: "set_todos", phases: TodoPhase[] }`
- `{ id?, type: "set_host_tools", tools: RpcHostToolDefinition[] }`

### โมเดล

- `{ id?, type: "set_model", provider: string, modelId: string }`
- `{ id?, type: "cycle_model" }`
- `{ id?, type: "get_available_models" }`

### การคิด

- `{ id?, type: "set_thinking_level", level: ThinkingLevel }`
- `{ id?, type: "cycle_thinking_level" }`

### โหมดคิว

- `{ id?, type: "set_steering_mode", mode: "all" | "one-at-a-time" }`
- `{ id?, type: "set_follow_up_mode", mode: "all" | "one-at-a-time" }`
- `{ id?, type: "set_interrupt_mode", mode: "immediate" | "wait" }`

### การบีบอัด

- `{ id?, type: "compact", customInstructions?: string }`
- `{ id?, type: "set_auto_compaction", enabled: boolean }`

### การลองใหม่

- `{ id?, type: "set_auto_retry", enabled: boolean }`
- `{ id?, type: "abort_retry" }`

### Bash

- `{ id?, type: "bash", command: string }`
- `{ id?, type: "abort_bash" }`

### Session

- `{ id?, type: "get_session_stats" }`
- `{ id?, type: "export_html", outputPath?: string }`
- `{ id?, type: "switch_session", sessionPath: string }`
- `{ id?, type: "branch", entryId: string }`
- `{ id?, type: "get_branch_messages" }`
- `{ id?, type: "get_last_assistant_text" }`
- `{ id?, type: "set_session_name", name: string }`

### ข้อความ

- `{ id?, type: "get_messages" }`

## สคีมาการตอบกลับ

ผลลัพธ์คำสั่งทั้งหมดใช้ `RpcResponse`:

- สำเร็จ: `{ id?, type: "response", command: <command>, success: true, data?: ... }`
- ล้มเหลว: `{ id?, type: "response", command: string, success: false, error: string }`

Payload ของข้อมูลเฉพาะตามคำสั่งและถูกนิยามใน `rpc-types.ts`

### Payload ของ `get_state`

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

### Payload ของ `set_todos`

แทนที่สถานะ todo ในหน่วยความจำสำหรับ session ปัจจุบันและส่งคืนรายการ phase ที่ถูก normalize:

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

สิ่งนี้มีประโยชน์สำหรับ host ที่ต้องการเตรียมแผนล่วงหน้าก่อน prompt แรก

### Payload ของ `set_host_tools`

แทนที่ชุดเครื่องมือที่ host เป็นเจ้าของปัจจุบันที่เซิร์ฟเวอร์ RPC อาจเรียกกลับผ่าน stdio:

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

Payload ของการตอบกลับคือ:

```json
{
  "toolNames": ["echo_host"]
}
```

เครื่องมือเหล่านี้จะถูกเพิ่มลงใน registry เครื่องมือของ session ที่ active ก่อนการเรียก model ครั้งถัดไป การส่ง `set_host_tools` อีกครั้งจะแทนที่ชุดเครื่องมือที่ host เป็นเจ้าของก่อนหน้า

## สคีมา Event Stream

โหมด RPC ส่งต่ออ็อบเจกต์ `AgentSessionEvent` จาก `AgentSession.subscribe(...)`

ประเภทเหตุการณ์ทั่วไป:

- `agent_start`, `agent_end`
- `turn_start`, `turn_end`
- `message_start`, `message_update`, `message_end`
- `tool_execution_start`, `tool_execution_update`, `tool_execution_end`
- `auto_compaction_start`, `auto_compaction_end`
- `auto_retry_start`, `auto_retry_end`
- `ttsr_triggered`
- `todo_reminder`
- `todo_auto_clear`

ข้อผิดพลาดของ extension runner จะถูกส่งออกแยกต่างหากเป็น:

```json
{ "type": "extension_error", "extensionPath": "...", "event": "...", "error": "..." }
```

`message_update` รวม streaming delta ใน `assistantMessageEvent` (text/thinking/toolcall delta)

## ความพร้อมกันและลำดับของ Prompt/Queue

นี่คือพฤติกรรมการทำงานที่สำคัญที่สุด

### การรับทราบทันทีเทียบกับการเสร็จสมบูรณ์

`prompt` และ `abort_and_prompt` ถูก**รับทราบทันที**:

```json
{ "id": "req_1", "type": "response", "command": "prompt", "success": true }
```

นั่นหมายความว่า:

- การยอมรับคำสั่ง != การรันเสร็จสมบูรณ์
- การเสร็จสมบูรณ์สุดท้ายสังเกตได้ผ่าน `agent_end`

### ขณะกำลัง streaming

`AgentSession.prompt()` ต้องการ `streamingBehavior` ขณะที่กำลัง streaming อยู่:

- `"steer"` => ข้อความ steering ที่เข้าคิว (เส้นทาง interrupt)
- `"followUp"` => ข้อความ follow-up ที่เข้าคิว (เส้นทางหลัง turn)

หากไม่ระบุขณะ streaming, prompt จะล้มเหลว

### ค่าเริ่มต้นของคิว

จากสคีมาการตั้งค่า coding-agent (`packages/coding-agent/src/config/settings-schema.ts`):

- `steeringMode`: `"one-at-a-time"`
- `followUpMode`: `"one-at-a-time"`
- `interruptMode`: `"wait"`

### ความหมายของโหมด

- `set_steering_mode` / `set_follow_up_mode`
  - `"one-at-a-time"`: dequeue ข้อความที่เข้าคิวทีละหนึ่งต่อ turn
  - `"all"`: dequeue ทั้งคิวพร้อมกัน
- `set_interrupt_mode`
  - `"immediate"`: การ execute เครื่องมือจะตรวจสอบ steering ระหว่าง tool call; steering ที่ค้างอยู่สามารถยกเลิก tool call ที่เหลือใน turn ได้
  - `"wait"`: เลื่อน steering ไปจนกว่า turn จะเสร็จสมบูรณ์

## โปรโตคอลย่อย Extension UI

Extension ในโหมด RPC ใช้เฟรม UI แบบ request/response

### คำขอขาออก

เมธอด `RpcExtensionUIRequest` (`type: "extension_ui_request"`):

- `select`, `confirm`, `input`, `editor`
- `notify`, `setStatus`, `setWidget`, `setTitle`, `set_editor_text`

หมายเหตุ runtime:

- การสร้างชื่อ session อัตโนมัติถูกปิดในโหมด RPC และคำขอ UI `setTitle` ก็ถูกระงับตามค่าเริ่มต้นเช่นกัน เนื่องจาก host ส่วนใหญ่ไม่มีพื้นผิว terminal-title ที่มีความหมาย ตั้ง `PI_RPC_EMIT_TITLE=1` เพื่อเปิดใช้งานเหตุการณ์ UI กลับมา

ตัวอย่าง:

```json
{ "type": "extension_ui_request", "id": "123", "method": "confirm", "title": "Confirm", "message": "Continue?", "timeout": 30000 }
```

### การตอบกลับขาเข้า

`RpcExtensionUIResponse` (`type: "extension_ui_response"`):

- `{ type: "extension_ui_response", id: string, value: string }`
- `{ type: "extension_ui_response", id: string, confirmed: boolean }`
- `{ type: "extension_ui_response", id: string, cancelled: true }`

หาก dialog มี timeout โหมด RPC จะ resolve เป็นค่าเริ่มต้นเมื่อ timeout/abort ทำงาน

## โปรโตคอลย่อย Host Tool

RPC host สามารถเปิดเผยเครื่องมือที่กำหนดเองให้กับ agent โดยส่ง `set_host_tools` จากนั้นให้บริการคำขอ execution ผ่าน transport เดียวกัน

### คำขอขาออก

เมื่อ agent ต้องการให้ host execute เครื่องมือใดเครื่องมือหนึ่ง โหมด RPC จะส่งออก:

```json
{
  "type": "host_tool_call",
  "id": "host_1",
  "toolCallId": "toolu_123",
  "toolName": "echo_host",
  "arguments": { "message": "hello" }
}
```

หากการ execute เครื่องมือถูกยกเลิกในภายหลัง โหมด RPC จะส่งออก:

```json
{
  "type": "host_tool_cancel",
  "id": "host_cancel_1",
  "targetId": "host_1"
}
```

### การอัปเดตและการเสร็จสมบูรณ์ขาเข้า

Host สามารถ stream ความคืบหน้าได้ตามต้องการ:

```json
{
  "type": "host_tool_update",
  "id": "host_1",
  "partialResult": {
    "content": [{ "type": "text", "text": "working" }]
  }
}
```

การเสร็จสมบูรณ์ใช้:

```json
{
  "type": "host_tool_result",
  "id": "host_1",
  "result": {
    "content": [{ "type": "text", "text": "done" }]
  }
}
```

ตั้ง `isError: true` บน `host_tool_result` เพื่อแสดงเนื้อหาที่ส่งคืนเป็นข้อผิดพลาดของเครื่องมือ

## โมเดลข้อผิดพลาดและการกู้คืน

### ความล้มเหลวระดับคำสั่ง

ความล้มเหลวเป็น `success: false` พร้อมสตริง `error`

```json
{ "id": "req_2", "type": "response", "command": "set_model", "success": false, "error": "Model not found: provider/model" }
```

### ความคาดหวังด้านการกู้คืน

- ความล้มเหลวของคำสั่งส่วนใหญ่สามารถกู้คืนได้; โปรเซสยังคงทำงานอยู่
- JSONL ที่ผิดรูปแบบ / ข้อยกเว้น parse-loop จะส่งการตอบกลับข้อผิดพลาด `parse` และอ่านบรรทัดถัดไปต่อไป
- `set_session_name` ว่างเปล่าจะถูกปฏิเสธ (`Session name cannot be empty`)
- การตอบกลับ UI ของ extension ที่มี `id` ไม่รู้จักจะถูกเพิกเฉย
- เงื่อนไขการยุติโปรเซสคือ stdin ปิดหรือ extension เรียก shutdown อย่างชัดเจน

## ขั้นตอนการทำงานแบบกระชับ

### 1) Prompt และ stream

stdin:

```json
{ "id": "req_1", "type": "prompt", "message": "Summarize this repo" }
```

ลำดับ stdout (ทั่วไป):

```json
{ "id": "req_1", "type": "response", "command": "prompt", "success": true }
{ "type": "agent_start" }
{ "type": "message_update", "assistantMessageEvent": { "type": "text_delta", "delta": "..." }, "message": { "role": "assistant", "content": [] } }
{ "type": "agent_end", "messages": [] }
```

### 2) Prompt ขณะ streaming ด้วยนโยบายคิวที่กำหนดชัดเจน

stdin:

```json
{ "id": "req_2", "type": "prompt", "message": "Also include risks", "streamingBehavior": "followUp" }
```

### 3) ตรวจสอบและปรับแต่งพฤติกรรมคิว

stdin:

```json
{ "id": "q1", "type": "get_state" }
{ "id": "q2", "type": "set_steering_mode", "mode": "all" }
{ "id": "q3", "type": "set_interrupt_mode", "mode": "wait" }
```

### 4) การสื่อสารไป-กลับของ Extension UI

stdout:

```json
{ "type": "extension_ui_request", "id": "ui_7", "method": "input", "title": "Branch name", "placeholder": "feature/..." }
```

stdin:

```json
{ "type": "extension_ui_response", "id": "ui_7", "value": "feature/rpc-host" }
```

## หมายเหตุเกี่ยวกับตัวช่วย `RpcClient`

`src/modes/rpc/rpc-client.ts` เป็น wrapper เพื่อความสะดวก ไม่ใช่นิยามของโปรโตคอล

ลักษณะเฉพาะของตัวช่วยปัจจุบัน:

- สร้างโปรเซส `bun <cliPath> --mode rpc`
- เชื่อมโยงการตอบกลับด้วย id ที่สร้างขึ้นแบบ `req_<n>`
- ส่งต่อเฉพาะประเภท `AgentEvent` ที่รู้จักไปยัง listener
- รองรับเครื่องมือที่กำหนดเองโดย host ผ่าน `setCustomTools()` และการจัดการ `host_tool_call` / `host_tool_cancel` อัตโนมัติ
- **ไม่**เปิดเผยเมธอดตัวช่วยสำหรับทุกคำสั่งในโปรโตคอล (ตัวอย่างเช่น `set_interrupt_mode` และ `set_session_name` มีอยู่ในประเภทของโปรโตคอลแต่ไม่ได้ถูก wrap เป็นเมธอดเฉพาะ)

ใช้เฟรมโปรโตคอลดิบหากคุณต้องการครอบคลุมพื้นผิวทั้งหมด
