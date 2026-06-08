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

โหมด RPC จะเรียกใช้ coding agent เป็นโปรโตคอล JSON ที่คั่นด้วยบรรทัดใหม่ผ่าน stdio

- **stdin**: คำสั่ง (`RpcCommand`) และการตอบกลับ UI ของส่วนขยาย
- **stdout**: การตอบกลับคำสั่ง (`RpcResponse`), เหตุการณ์เซสชัน/เอเจนต์, คำขอ UI ของส่วนขยาย

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

- อาร์กิวเมนต์ CLI แบบ `@file` จะถูกปฏิเสธในโหมด RPC
- โหมด RPC ปิดการสร้างชื่อเซสชันอัตโนมัติโดยค่าเริ่มต้น เพื่อหลีกเลี่ยงการเรียกโมเดลเพิ่มเติม
- โหมด RPC จะรีเซ็ตการตั้งค่า `todo.*`, `task.*` และ `async.*` ที่ส่งผลต่อเวิร์กโฟลว์กลับเป็นค่าเริ่มต้นในตัว แทนที่จะรับช่วงการแก้ไขจากผู้ใช้
- กระบวนการจะอ่าน stdin เป็น JSONL (`readJsonl(Bun.stdin.stream())`)
- เมื่อ stdin ถูกปิด กระบวนการจะออกด้วยรหัส `0`
- การตอบกลับ/เหตุการณ์จะถูกเขียนเป็นออบเจ็กต์ JSON หนึ่งตัวต่อบรรทัด

## การขนส่งและการจัดกรอบข้อมูล

แต่ละเฟรมเป็นออบเจ็กต์ JSON เดียวตามด้วย `\n`

ไม่มี envelope เพิ่มเติมนอกเหนือจากรูปแบบของออบเจ็กต์เอง

### หมวดหมู่เฟรมขาออก (stdout)

1. `RpcResponse` (`{ type: "response", ... }`)
2. ออบเจ็กต์ `AgentSessionEvent` (`agent_start`, `message_update` ฯลฯ)
3. `RpcExtensionUIRequest` (`{ type: "extension_ui_request", ... }`)
4. ข้อผิดพลาดของส่วนขยาย (`{ type: "extension_error", extensionPath, event, error }`)

### หมวดหมู่เฟรมขาเข้า (stdin)

1. `RpcCommand`
2. `RpcExtensionUIResponse` (`{ type: "extension_ui_response", ... }`)

## การเชื่อมโยงคำขอ/การตอบกลับ

คำสั่งทั้งหมดรับ `id?: string` ที่เป็นตัวเลือก

- หากระบุไว้ การตอบกลับคำสั่งปกติจะส่งคืน `id` เดิม
- `RpcClient` อาศัยสิ่งนี้สำหรับการแก้ไขคำขอที่ค้างอยู่

พฤติกรรมขอบเขตสำคัญจากรันไทม์:

- การตอบกลับคำสั่งที่ไม่รู้จักจะถูกส่งออกพร้อม `id: undefined` (แม้ว่าคำขอจะมี `id`)
- ข้อยกเว้นจากการ parse/handler ในลูปอินพุตจะส่งออก `command: "parse"` พร้อม `id: undefined`
- `prompt` และ `abort_and_prompt` จะคืนค่าสำเร็จทันที จากนั้นอาจส่งการตอบกลับข้อผิดพลาดในภายหลังพร้อม **id เดียวกัน** หากการจัดกำหนดการ prompt แบบอะซิงโครนัสล้มเหลว

## สคีมาคำสั่ง (แบบบัญญัติ)

`RpcCommand` ถูกกำหนดใน `src/modes/rpc/rpc-types.ts`:

### การส่ง Prompt

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

### การคิดวิเคราะห์

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

### เซสชัน

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

เพย์โหลดข้อมูลเฉพาะตามคำสั่งและถูกกำหนดใน `rpc-types.ts`

### เพย์โหลด `get_state`

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

### เพย์โหลด `set_todos`

แทนที่สถานะ todo ในหน่วยความจำสำหรับเซสชันปัจจุบันและคืนค่ารายการเฟสที่ถูกทำให้เป็นมาตรฐาน:

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

สิ่งนี้มีประโยชน์สำหรับโฮสต์ที่ต้องการตั้งค่าแผนล่วงหน้าก่อน prompt แรก

### เพย์โหลด `set_host_tools`

แทนที่ชุดเครื่องมือที่เป็นของโฮสต์ปัจจุบันที่เซิร์ฟเวอร์ RPC อาจเรียกกลับ
ผ่าน stdio:

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

เพย์โหลดการตอบกลับคือ:

```json
{
  "toolNames": ["echo_host"]
}
```

เครื่องมือเหล่านี้จะถูกเพิ่มลงในรีจิสทรีเครื่องมือของเซสชันที่ใช้งานก่อนการเรียกโมเดลครั้งถัดไป การส่ง `set_host_tools` ซ้ำจะแทนที่ชุดที่เป็นของโฮสต์ก่อนหน้า

## สคีมาสตรีมเหตุการณ์

โหมด RPC จะส่งต่อออบเจ็กต์ `AgentSessionEvent` จาก `AgentSession.subscribe(...)`

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

ข้อผิดพลาดของตัวรันส่วนขยายจะถูกส่งออกแยกต่างหากเป็น:

```json
{ "type": "extension_error", "extensionPath": "...", "event": "...", "error": "..." }
```

`message_update` รวมเดลต้าแบบสตรีมมิงใน `assistantMessageEvent` (เดลต้าข้อความ/การคิด/การเรียกเครื่องมือ)

## การทำงานพร้อมกันและลำดับของ Prompt/คิว

นี่คือพฤติกรรมการทำงานที่สำคัญที่สุด

### การตอบรับทันทีเทียบกับการเสร็จสมบูรณ์

`prompt` และ `abort_and_prompt` จะ **ถูกตอบรับทันที**:

```json
{ "id": "req_1", "type": "response", "command": "prompt", "success": true }
```

นั่นหมายความว่า:

- การยอมรับคำสั่ง != การรันเสร็จสมบูรณ์
- การเสร็จสมบูรณ์สุดท้ายจะถูกสังเกตผ่าน `agent_end`

### ระหว่างการสตรีม

`AgentSession.prompt()` ต้องการ `streamingBehavior` ระหว่างการสตรีมที่กำลังดำเนินอยู่:

- `"steer"` => ข้อความ steering ที่อยู่ในคิว (เส้นทางการขัดจังหวะ)
- `"followUp"` => ข้อความ follow-up ที่อยู่ในคิว (เส้นทางหลังเทิร์น)

หากไม่ระบุระหว่างการสตรีม prompt จะล้มเหลว

### ค่าเริ่มต้นของคิว

จากสคีมาการตั้งค่า coding-agent (`packages/coding-agent/src/config/settings-schema.ts`):

- `steeringMode`: `"one-at-a-time"`
- `followUpMode`: `"one-at-a-time"`
- `interruptMode`: `"wait"`

### ความหมายของโหมด

- `set_steering_mode` / `set_follow_up_mode`
  - `"one-at-a-time"`: นำข้อความที่อยู่ในคิวออกทีละหนึ่งต่อเทิร์น
  - `"all"`: นำคิวทั้งหมดออกพร้อมกัน
- `set_interrupt_mode`
  - `"immediate"`: การดำเนินการเครื่องมือจะตรวจสอบ steering ระหว่างการเรียกเครื่องมือ; steering ที่ค้างอยู่สามารถยกเลิกการเรียกเครื่องมือที่เหลือในเทิร์นได้
  - `"wait"`: เลื่อน steering ออกไปจนกว่าเทิร์นจะเสร็จสมบูรณ์

## โปรโตคอลย่อย UI ของส่วนขยาย

ส่วนขยายในโหมด RPC ใช้เฟรม UI แบบคำขอ/การตอบกลับ

### คำขอขาออก

เมธอด `RpcExtensionUIRequest` (`type: "extension_ui_request"`):

- `select`, `confirm`, `input`, `editor`
- `notify`, `setStatus`, `setWidget`, `setTitle`, `set_editor_text`

หมายเหตุรันไทม์:

- การสร้างชื่อเซสชันอัตโนมัติถูกปิดในโหมด RPC และคำขอ UI `setTitle`
  ก็ถูกระงับโดยค่าเริ่มต้นเช่นกัน เนื่องจากโฮสต์ส่วนใหญ่ไม่มีพื้นผิวชื่อเทอร์มินัลที่มีความหมาย ตั้ง `PI_RPC_EMIT_TITLE=1` เพื่อเปิดใช้งานเหตุการณ์ UI อีกครั้ง

ตัวอย่าง:

```json
{ "type": "extension_ui_request", "id": "123", "method": "confirm", "title": "Confirm", "message": "Continue?", "timeout": 30000 }
```

### การตอบกลับขาเข้า

`RpcExtensionUIResponse` (`type: "extension_ui_response"`):

- `{ type: "extension_ui_response", id: string, value: string }`
- `{ type: "extension_ui_response", id: string, confirmed: boolean }`
- `{ type: "extension_ui_response", id: string, cancelled: true }`

หากไดอะล็อกมี timeout โหมด RPC จะแก้ไขเป็นค่าเริ่มต้นเมื่อ timeout/abort ทำงาน

## โปรโตคอลย่อยเครื่องมือของโฮสต์

โฮสต์ RPC สามารถเปิดเผยเครื่องมือที่กำหนดเองให้กับเอเจนต์โดยการส่ง `set_host_tools` จากนั้น
ให้บริการคำขอการดำเนินการผ่านช่องทางเดียวกัน

### คำขอขาออก

เมื่อเอเจนต์ต้องการให้โฮสต์ดำเนินการเครื่องมือใดเครื่องมือหนึ่ง โหมด RPC จะส่งออก:

```json
{
  "type": "host_tool_call",
  "id": "host_1",
  "toolCallId": "toolu_123",
  "toolName": "echo_host",
  "arguments": { "message": "hello" }
}
```

หากการดำเนินการเครื่องมือถูกยกเลิกในภายหลัง โหมด RPC จะส่งออก:

```json
{
  "type": "host_tool_cancel",
  "id": "host_cancel_1",
  "targetId": "host_1"
}
```

### การอัปเดตขาเข้าและการเสร็จสมบูรณ์

โฮสต์สามารถสตรีมความคืบหน้าได้ตามตัวเลือก:

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

ตั้ง `isError: true` บน `host_tool_result` เพื่อแสดงเนื้อหาที่คืนกลับเป็นข้อผิดพลาดของเครื่องมือ

## โมเดลข้อผิดพลาดและความสามารถในการกู้คืน

### ความล้มเหลวระดับคำสั่ง

ความล้มเหลวจะเป็น `success: false` พร้อมสตริง `error`

```json
{ "id": "req_2", "type": "response", "command": "set_model", "success": false, "error": "Model not found: provider/model" }
```

### ความคาดหวังด้านความสามารถในการกู้คืน

- ความล้มเหลวของคำสั่งส่วนใหญ่สามารถกู้คืนได้; กระบวนการยังคงทำงานอยู่
- JSONL ที่มีรูปแบบผิด / ข้อยกเว้นในลูปการ parse จะส่งออกการตอบกลับข้อผิดพลาด `parse` และอ่านบรรทัดถัดไปต่อไป
- `set_session_name` ที่ว่างเปล่าจะถูกปฏิเสธ (`Session name cannot be empty`)
- การตอบกลับ UI ของส่วนขยายที่มี `id` ที่ไม่รู้จักจะถูกเพิกเฉย
- เงื่อนไขการยุติกระบวนการคือ stdin ปิดหรือการปิดตัวที่ถูกกระตุ้นโดยส่วนขยาย

## ลำดับการทำงานแบบกระชับ

### 1) Prompt และสตรีม

stdin:

```json
{ "id": "req_1", "type": "prompt", "message": "Summarize this repo" }
```

ลำดับ stdout (ปกติ):

```json
{ "id": "req_1", "type": "response", "command": "prompt", "success": true }
{ "type": "agent_start" }
{ "type": "message_update", "assistantMessageEvent": { "type": "text_delta", "delta": "..." }, "message": { "role": "assistant", "content": [] } }
{ "type": "agent_end", "messages": [] }
```

### 2) Prompt ระหว่างการสตรีมพร้อมนโยบายคิวแบบชัดเจน

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

### 4) การรับส่ง UI ของส่วนขยาย

stdout:

```json
{ "type": "extension_ui_request", "id": "ui_7", "method": "input", "title": "Branch name", "placeholder": "feature/..." }
```

stdin:

```json
{ "type": "extension_ui_response", "id": "ui_7", "value": "feature/rpc-host" }
```

## หมายเหตุเกี่ยวกับตัวช่วย `RpcClient`

`src/modes/rpc/rpc-client.ts` เป็น wrapper ที่สะดวกในการใช้งาน ไม่ใช่คำจำกัดความของโปรโตคอล

ลักษณะของตัวช่วยปัจจุบัน:

- เรียกใช้ `bun <cliPath> --mode rpc`
- เชื่อมโยงการตอบกลับด้วย id ที่สร้างขึ้น `req_<n>`
- ส่งต่อเฉพาะประเภท `AgentEvent` ที่รู้จักไปยังผู้ฟัง
- รองรับเครื่องมือที่กำหนดเองของโฮสต์ผ่าน `setCustomTools()` และการจัดการ `host_tool_call` / `host_tool_cancel` อัตโนมัติ
- **ไม่ได้** เปิดเผยเมธอดตัวช่วยสำหรับทุกคำสั่งในโปรโตคอล (ตัวอย่างเช่น `set_interrupt_mode` และ `set_session_name` อยู่ในประเภทโปรโตคอลแต่ไม่ได้ถูกห่อเป็นเมธอดเฉพาะ)

ใช้เฟรมโปรโตคอลดิบหากคุณต้องการความครอบคลุมพื้นผิวทั้งหมด
