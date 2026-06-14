---
title: เอกสารอ้างอิงโปรโตคอล RPC
description: >-
  เอกสารอ้างอิงโปรโตคอล JSON-RPC สำหรับการสื่อสารระหว่างกระบวนการของส่วนประกอบ
  xcsh
sidebar:
  order: 5
  label: โปรโตคอล RPC
i18n:
  sourceHash: b4a3ddaf08ab
  translator: machine
---

# เอกสารอ้างอิงโปรโตคอล RPC

โหมด RPC เรียกใช้งาน coding agent เป็นโปรโตคอล JSON ที่คั่นด้วยขึ้นบรรทัดใหม่ผ่าน stdio

- **stdin**: คำสั่ง (`RpcCommand`) และการตอบสนอง UI ของส่วนขยาย
- **stdout**: การตอบสนองคำสั่ง (`RpcResponse`), เหตุการณ์ session/agent, การร้องขอ UI ของส่วนขยาย

การนำไปใช้งานหลัก:

- `src/modes/rpc/rpc-mode.ts`
- `src/modes/rpc/rpc-types.ts`
- `src/session/agent-session.ts`
- `packages/agent/src/agent.ts`
- `packages/agent/src/agent-loop.ts`

## การเริ่มต้นใช้งาน

```bash
xcsh --mode rpc [regular CLI options]
```

หมายเหตุเกี่ยวกับพฤติกรรม:

- อาร์กิวเมนต์ CLI ที่ขึ้นต้นด้วย `@file` จะถูกปฏิเสธในโหมด RPC
- โหมด RPC ปิดการสร้างชื่อ session อัตโนมัติโดยค่าเริ่มต้นเพื่อหลีกเลี่ยงการเรียกใช้โมเดลเพิ่มเติม
- โหมด RPC รีเซ็ตการตั้งค่า `todo.*`, `task.*` และ `async.*` ที่เปลี่ยนแปลงกระบวนการทำงานกลับเป็นค่าเริ่มต้นในตัว แทนที่จะรับค่าที่ผู้ใช้กำหนดไว้
- กระบวนการอ่าน stdin เป็น JSONL (`readJsonl(Bun.stdin.stream())`)
- เมื่อ stdin ปิด กระบวนการจะออกด้วยรหัส `0`
- การตอบสนอง/เหตุการณ์จะถูกเขียนเป็น JSON object หนึ่งตัวต่อบรรทัด

## การขนส่งและการจัดกรอบข้อมูล

แต่ละเฟรมคือ JSON object เดียวตามด้วย `\n`

ไม่มีซองจดหมายนอกเหนือจากรูปร่างของ object เอง

### หมวดหมู่เฟรมขาออก (stdout)

1. `RpcResponse` (`{ type: "response", ... }`)
2. `AgentSessionEvent` objects (`agent_start`, `message_update`, เป็นต้น)
3. `RpcExtensionUIRequest` (`{ type: "extension_ui_request", ... }`)
4. ข้อผิดพลาดส่วนขยาย (`{ type: "extension_error", extensionPath, event, error }`)

### หมวดหมู่เฟรมขาเข้า (stdin)

1. `RpcCommand`
2. `RpcExtensionUIResponse` (`{ type: "extension_ui_response", ... }`)

## การเชื่อมโยงคำขอ/การตอบสนอง

คำสั่งทั้งหมดรับ `id?: string` แบบไม่บังคับ

- หากระบุไว้ การตอบสนองคำสั่งปกติจะส่งคืน `id` เดียวกัน
- `RpcClient` พึ่งพาสิ่งนี้สำหรับการแก้ไขคำขอที่รอดำเนินการ

พฤติกรรมขอบเขตที่สำคัญจากรันไทม์:

- การตอบสนองคำสั่งที่ไม่รู้จักจะถูกส่งออกพร้อม `id: undefined` (แม้ว่าคำขอจะมี `id`)
- ข้อยกเว้นของการแยกวิเคราะห์/ตัวจัดการในลูปอินพุตจะส่ง `command: "parse"` พร้อม `id: undefined`
- `prompt` และ `abort_and_prompt` ส่งคืนความสำเร็จทันที จากนั้นอาจส่งการตอบสนองข้อผิดพลาดในภายหลังด้วย **id เดิม** หากการกำหนดเวลา prompt แบบอะซิงโครนัสล้มเหลว

## สคีมาคำสั่ง (เชิงบัญญัติ)

`RpcCommand` กำหนดไว้ใน `src/modes/rpc/rpc-types.ts`:

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

### การคิด

- `{ id?, type: "set_thinking_level", level: ThinkingLevel }`
- `{ id?, type: "cycle_thinking_level" }`

### โหมดคิว

- `{ id?, type: "set_steering_mode", mode: "all" | "one-at-a-time" }`
- `{ id?, type: "set_follow_up_mode", mode: "all" | "one-at-a-time" }`
- `{ id?, type: "set_interrupt_mode", mode: "immediate" | "wait" }`

### การย่อข้อมูล

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

## สคีมาการตอบสนอง

ผลลัพธ์คำสั่งทั้งหมดใช้ `RpcResponse`:

- สำเร็จ: `{ id?, type: "response", command: <command>, success: true, data?: ... }`
- ล้มเหลว: `{ id?, type: "response", command: string, success: false, error: string }`

Payload ข้อมูลเป็นแบบเฉพาะคำสั่งและกำหนดไว้ใน `rpc-types.ts`

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

แทนที่สถานะ todo ในหน่วยความจำสำหรับ session ปัจจุบันและส่งคืนรายการ phase ที่ผ่านการทำให้เป็นมาตรฐานแล้ว:

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

สิ่งนี้มีประโยชน์สำหรับ host ที่ต้องการเติมแผนล่วงหน้าก่อน prompt แรก

### Payload ของ `set_host_tools`

แทนที่ชุดเครื่องมือที่ host เป็นเจ้าของในปัจจุบันที่ RPC server อาจเรียกกลับ
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

Payload การตอบสนองคือ:

```json
{
  "toolNames": ["echo_host"]
}
```

เครื่องมือเหล่านี้จะถูกเพิ่มในรีจิสทรีเครื่องมือ session ที่ใช้งานอยู่ก่อนการเรียกโมเดลครั้งถัดไป
การส่ง `set_host_tools` ซ้ำจะแทนที่ชุดที่ host เป็นเจ้าของก่อนหน้านี้

## สคีมา Event Stream

โหมด RPC ส่งต่อ `AgentSessionEvent` objects จาก `AgentSession.subscribe(...)`

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

ข้อผิดพลาดของ extension runner จะถูกส่งออกแยกต่างหากดังนี้:

```json
{ "type": "extension_error", "extensionPath": "...", "event": "...", "error": "..." }
```

`message_update` รวมเดลต้าการสตรีมใน `assistantMessageEvent` (เดลต้าข้อความ/การคิด/การเรียกใช้เครื่องมือ)

## การทำงานพร้อมกันและลำดับของ Prompt/Queue

นี่คือพฤติกรรมการทำงานที่สำคัญที่สุด

### การยืนยันทันที vs การเสร็จสมบูรณ์

`prompt` และ `abort_and_prompt` ได้รับการ**ยืนยันทันที**:

```json
{ "id": "req_1", "type": "response", "command": "prompt", "success": true }
```

ซึ่งหมายความว่า:

- การยอมรับคำสั่ง != การเสร็จสมบูรณ์ของการรัน
- การเสร็จสมบูรณ์สุดท้ายสังเกตได้ผ่าน `agent_end`

### ขณะสตรีม

`AgentSession.prompt()` ต้องการ `streamingBehavior` ระหว่างการสตรีมที่กำลังดำเนินอยู่:

- `"steer"` => ข้อความ steering ที่อยู่ในคิว (เส้นทางขัดจังหวะ)
- `"followUp"` => ข้อความ follow-up ที่อยู่ในคิว (เส้นทางหลัง turn)

หากละเว้นระหว่างการสตรีม prompt จะล้มเหลว

### ค่าเริ่มต้นของคิว

จากสคีมาการตั้งค่า coding-agent (`packages/coding-agent/src/config/settings-schema.ts`):

- `steeringMode`: `"one-at-a-time"`
- `followUpMode`: `"one-at-a-time"`
- `interruptMode`: `"wait"`

### ความหมายของโหมด

- `set_steering_mode` / `set_follow_up_mode`
  - `"one-at-a-time"`: ดึงข้อความจากคิวหนึ่งข้อความต่อ turn
  - `"all"`: ดึงคิวทั้งหมดในคราวเดียว
- `set_interrupt_mode`
  - `"immediate"`: การรันเครื่องมือตรวจสอบ steering ระหว่างการเรียกใช้เครื่องมือ; steering ที่รอดำเนินการสามารถยกเลิกการเรียกใช้เครื่องมือที่เหลือใน turn ได้
  - `"wait"`: เลื่อน steering จนกว่า turn จะเสร็จสมบูรณ์

## โปรโตคอลย่อย Extension UI

ส่วนขยายในโหมด RPC ใช้เฟรม UI แบบคำขอ/การตอบสนอง

### คำขอขาออก

เมธอด `RpcExtensionUIRequest` (`type: "extension_ui_request"`):

- `select`, `confirm`, `input`, `editor`
- `notify`, `setStatus`, `setWidget`, `setTitle`, `set_editor_text`

หมายเหตุรันไทม์:

- การสร้างชื่อ session อัตโนมัติถูกปิดใช้งานในโหมด RPC และคำขอ UI `setTitle`
  จะถูกระงับโดยค่าเริ่มต้นเช่นกัน เนื่องจาก host ส่วนใหญ่ไม่มีพื้นผิว terminal-title ที่มีความหมาย ตั้งค่า `PI_RPC_EMIT_TITLE=1` เพื่อเลือกกลับเข้าสู่ UI event เท่านั้น

ตัวอย่าง:

```json
{ "type": "extension_ui_request", "id": "123", "method": "confirm", "title": "Confirm", "message": "Continue?", "timeout": 30000 }
```

### การตอบสนองขาเข้า

`RpcExtensionUIResponse` (`type: "extension_ui_response"`):

- `{ type: "extension_ui_response", id: string, value: string }`
- `{ type: "extension_ui_response", id: string, confirmed: boolean }`
- `{ type: "extension_ui_response", id: string, cancelled: true }`

หากกล่องโต้ตอบมีการหมดเวลา โหมด RPC จะแก้ไขเป็นค่าเริ่มต้นเมื่อการหมดเวลา/การยกเลิกเกิดขึ้น

## โปรโตคอลย่อย Host Tool

Host ของ RPC สามารถเปิดเผยเครื่องมือแบบกำหนดเองให้กับ agent โดยส่ง `set_host_tools` จากนั้น
ให้บริการคำขอการดำเนินการผ่านการขนส่งเดียวกัน

### คำขอขาออก

เมื่อ agent ต้องการให้ host ดำเนินการเครื่องมือเหล่านั้น โหมด RPC จะส่งออก:

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

Host สามารถสตรีมความคืบหน้าแบบไม่บังคับ:

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

ตั้งค่า `isError: true` บน `host_tool_result` เพื่อแสดงเนื้อหาที่ส่งคืนเป็น
ข้อผิดพลาดของเครื่องมือ

## โมเดลข้อผิดพลาดและการกู้คืน

### ความล้มเหลวระดับคำสั่ง

ความล้มเหลวคือ `success: false` พร้อม `error` แบบสตริง

```json
{ "id": "req_2", "type": "response", "command": "set_model", "success": false, "error": "Model not found: provider/model" }
```

### ความคาดหวังด้านการกู้คืน

- ความล้มเหลวของคำสั่งส่วนใหญ่สามารถกู้คืนได้; กระบวนการยังคงทำงานต่อไป
- JSONL ที่รูปแบบไม่ถูกต้อง / ข้อยกเว้นของลูปการแยกวิเคราะห์จะส่งการตอบสนองข้อผิดพลาด `parse` และยังคงอ่านบรรทัดถัดไป
- `set_session_name` ที่ว่างเปล่าจะถูกปฏิเสธ (`Session name cannot be empty`)
- การตอบสนอง Extension UI ที่มี `id` ไม่รู้จักจะถูกละเว้น
- เงื่อนไขการสิ้นสุดกระบวนการคือการปิด stdin หรือการปิดระบบที่ถูกเรียกใช้โดยส่วนขยายอย่างชัดเจน

## ขั้นตอนคำสั่งแบบย่อ

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

### 2) Prompt ระหว่างการสตรีมพร้อมนโยบายคิวที่ชัดเจน

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

### 4) การรับส่ง Extension UI

stdout:

```json
{ "type": "extension_ui_request", "id": "ui_7", "method": "input", "title": "Branch name", "placeholder": "feature/..." }
```

stdin:

```json
{ "type": "extension_ui_response", "id": "ui_7", "value": "feature/rpc-host" }
```

## หมายเหตุเกี่ยวกับตัวช่วย `RpcClient`

`src/modes/rpc/rpc-client.ts` เป็น wrapper อำนวยความสะดวก ไม่ใช่นิยามโปรโตคอล

ลักษณะของตัวช่วยในปัจจุบัน:

- สร้าง `bun <cliPath> --mode rpc`
- เชื่อมโยงการตอบสนองด้วย id ที่สร้าง `req_<n>`
- ส่งเฉพาะประเภท `AgentEvent` ที่รู้จักไปยัง listener
- รองรับเครื่องมือแบบกำหนดเองที่ host เป็นเจ้าของผ่าน `setCustomTools()` และการจัดการ `host_tool_call` / `host_tool_cancel` อัตโนมัติ
- **ไม่**เปิดเผยเมธอด helper สำหรับทุกคำสั่งโปรโตคอล (ตัวอย่างเช่น `set_interrupt_mode` และ `set_session_name` อยู่ในประเภทโปรโตคอลแต่ไม่ได้ถูกห่อหุ้มเป็นเมธอดเฉพาะ)

ใช้เฟรมโปรโตคอลดิบหากต้องการครอบคลุมพื้นผิวทั้งหมด
