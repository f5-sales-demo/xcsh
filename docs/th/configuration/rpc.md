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

โหมด RPC รันตัวแทนการเขียนโค้ดเป็นโปรโตคอล JSON ที่คั่นด้วยขึ้นบรรทัดใหม่ผ่าน stdio

- **stdin**: คำสั่ง (`RpcCommand`) และการตอบสนองจาก UI ของส่วนขยาย
- **stdout**: การตอบสนองคำสั่ง (`RpcResponse`), เหตุการณ์ session/agent, คำขอ UI ของส่วนขยาย

การนำไปใช้งานหลัก:

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
- โหมด RPC ปิดใช้งานการสร้างชื่อ session อัตโนมัติโดยค่าเริ่มต้น เพื่อหลีกเลี่ยงการเรียกโมเดลเพิ่มเติม
- โหมด RPC รีเซ็ตการตั้งค่า `todo.*`, `task.*` และ `async.*` ที่เปลี่ยนแปลงเวิร์กโฟลว์กลับเป็นค่าเริ่มต้นในตัว แทนที่จะรับค่าที่ผู้ใช้กำหนดเอง
- กระบวนการอ่าน stdin เป็น JSONL (`readJsonl(Bun.stdin.stream())`)
- เมื่อ stdin ปิด กระบวนการจะออกด้วยรหัส `0`
- การตอบสนอง/เหตุการณ์จะถูกเขียนเป็นหนึ่งวัตถุ JSON ต่อบรรทัด

## การขนส่งและการจัดกรอบ

แต่ละเฟรมคือวัตถุ JSON เดี่ยวตามด้วย `\n`

ไม่มีซองจดหมายนอกเหนือจากรูปร่างของวัตถุเอง

### ประเภทเฟรมขาออก (stdout)

1. `RpcResponse` (`{ type: "response", ... }`)
2. วัตถุ `AgentSessionEvent` (`agent_start`, `message_update`, ฯลฯ)
3. `RpcExtensionUIRequest` (`{ type: "extension_ui_request", ... }`)
4. ข้อผิดพลาดส่วนขยาย (`{ type: "extension_error", extensionPath, event, error }`)

### ประเภทเฟรมขาเข้า (stdin)

1. `RpcCommand`
2. `RpcExtensionUIResponse` (`{ type: "extension_ui_response", ... }`)

## การเชื่อมโยงคำขอ/การตอบสนอง

คำสั่งทั้งหมดรับ `id?: string` แบบไม่บังคับ

- ถ้าระบุ การตอบสนองคำสั่งปกติจะสะท้อน `id` เดิมกลับ
- `RpcClient` ใช้สิ่งนี้สำหรับการแก้ไขคำขอที่รอดำเนินการ

พฤติกรรมขอบจากรันไทม์ที่สำคัญ:

- การตอบสนองคำสั่งที่ไม่รู้จักจะถูกส่งออกพร้อมกับ `id: undefined` (แม้คำขอจะมี `id`)
- ข้อยกเว้นการแยกวิเคราะห์/ตัวจัดการในลูปอินพุตจะส่งออก `command: "parse"` พร้อมกับ `id: undefined`
- `prompt` และ `abort_and_prompt` จะคืนค่าความสำเร็จทันที จากนั้นอาจส่งการตอบสนองข้อผิดพลาดในภายหลังพร้อมกับ **id เดิม** หากการกำหนดเวลาพรอมต์แบบอะซิงโครนัสล้มเหลว

## สคีมาคำสั่ง (มาตรฐาน)

`RpcCommand` ถูกกำหนดใน `src/modes/rpc/rpc-types.ts`:

### การพรอมต์

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

## สคีมาการตอบสนอง

ผลลัพธ์คำสั่งทั้งหมดใช้ `RpcResponse`:

- สำเร็จ: `{ id?, type: "response", command: <command>, success: true, data?: ... }`
- ล้มเหลว: `{ id?, type: "response", command: string, success: false, error: string }`

เพย์โหลดข้อมูลเป็นแบบเฉพาะคำสั่งและกำหนดไว้ใน `rpc-types.ts`

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

แทนที่สถานะ todo ในหน่วยความจำสำหรับ session ปัจจุบัน และคืนค่ารายการเฟสที่ผ่านการทำให้เป็นมาตรฐานแล้ว:

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

สิ่งนี้มีประโยชน์สำหรับโฮสต์ที่ต้องการกำหนดแผนล่วงหน้าก่อนพรอมต์แรก

### เพย์โหลด `set_host_tools`

แทนที่ชุดเครื่องมือที่เป็นของโฮสต์ปัจจุบันที่เซิร์ฟเวอร์ RPC อาจเรียกกลับผ่าน stdio:

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

เพย์โหลดการตอบสนองคือ:

```json
{
  "toolNames": ["echo_host"]
}
```

เครื่องมือเหล่านี้จะถูกเพิ่มในรีจิสทรีเครื่องมือ session ที่ใช้งานอยู่ก่อนการเรียกโมเดลครั้งถัดไป การส่ง `set_host_tools` ซ้ำจะแทนที่ชุดที่เป็นของโฮสต์ก่อนหน้า

## สคีมาสตรีมเหตุการณ์

โหมด RPC ส่งต่อวัตถุ `AgentSessionEvent` จาก `AgentSession.subscribe(...)`

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

`message_update` รวมเดลต้าสตรีมมิ่งใน `assistantMessageEvent` (เดลต้าข้อความ/การคิด/การเรียกเครื่องมือ)

## ความพร้อมกันและลำดับของพรอมต์/คิว

นี่คือพฤติกรรมการดำเนินงานที่สำคัญที่สุด

### การยืนยันทันทีเทียบกับการเสร็จสิ้น

`prompt` และ `abort_and_prompt` จะถูก **ยืนยันทันที**:

```json
{ "id": "req_1", "type": "response", "command": "prompt", "success": true }
```

ซึ่งหมายความว่า:

- การยอมรับคำสั่ง != การเสร็จสิ้นการรัน
- การเสร็จสิ้นสุดท้ายสังเกตได้ผ่าน `agent_end`

### ขณะสตรีมมิ่ง

`AgentSession.prompt()` ต้องการ `streamingBehavior` ระหว่างการสตรีมมิ่งที่ใช้งานอยู่:

- `"steer"` => ข้อความ steering ที่เข้าคิว (เส้นทางขัดจังหวะ)
- `"followUp"` => ข้อความติดตามที่เข้าคิว (เส้นทางหลังเทิร์น)

หากละเว้นระหว่างสตรีมมิ่ง พรอมต์จะล้มเหลว

### ค่าเริ่มต้นของคิว

จากสคีมาการตั้งค่าตัวแทนการเขียนโค้ด (`packages/coding-agent/src/config/settings-schema.ts`):

- `steeringMode`: `"one-at-a-time"`
- `followUpMode`: `"one-at-a-time"`
- `interruptMode`: `"wait"`

### ความหมายของโหมด

- `set_steering_mode` / `set_follow_up_mode`
  - `"one-at-a-time"`: นำข้อความที่เข้าคิวหนึ่งข้อความออกต่อเทิร์น
  - `"all"`: นำคิวทั้งหมดออกพร้อมกัน
- `set_interrupt_mode`
  - `"immediate"`: การดำเนินการเครื่องมือตรวจสอบ steering ระหว่างการเรียกเครื่องมือ; steering ที่รอดำเนินการสามารถยกเลิกการเรียกเครื่องมือที่เหลือในเทิร์นได้
  - `"wait"`: เลื่อน steering จนกว่าเทิร์นจะเสร็จสิ้น

## โปรโตคอลย่อย Extension UI

ส่วนขยายในโหมด RPC ใช้เฟรม UI แบบคำขอ/การตอบสนอง

### คำขอขาออก

เมธอด `RpcExtensionUIRequest` (`type: "extension_ui_request"`):

- `select`, `confirm`, `input`, `editor`
- `notify`, `setStatus`, `setWidget`, `setTitle`, `set_editor_text`

หมายเหตุรันไทม์:

- การสร้างชื่อ session อัตโนมัติถูกปิดใช้งานในโหมด RPC และคำขอ UI `setTitle`
  ก็ถูกระงับโดยค่าเริ่มต้นเช่นกัน เนื่องจากโฮสต์ส่วนใหญ่ไม่มีพื้นผิวชื่อเทอร์มินัลที่มีความหมาย ตั้ง `PI_RPC_EMIT_TITLE=1` เพื่อเลือกรับเหตุการณ์ UI กลับ

ตัวอย่าง:

```json
{ "type": "extension_ui_request", "id": "123", "method": "confirm", "title": "Confirm", "message": "Continue?", "timeout": 30000 }
```

### การตอบสนองขาเข้า

`RpcExtensionUIResponse` (`type: "extension_ui_response"`):

- `{ type: "extension_ui_response", id: string, value: string }`
- `{ type: "extension_ui_response", id: string, confirmed: boolean }`
- `{ type: "extension_ui_response", id: string, cancelled: true }`

หากไดอะล็อกมีการหมดเวลา โหมด RPC จะแก้ไขเป็นค่าเริ่มต้นเมื่อการหมดเวลา/การยกเลิกเกิดขึ้น

## โปรโตคอลย่อย Host Tool

โฮสต์ RPC สามารถเปิดเผยเครื่องมือที่กำหนดเองให้กับตัวแทนโดยการส่ง `set_host_tools` จากนั้นให้บริการคำขอการดำเนินการผ่านการขนส่งเดิม

### คำขอขาออก

เมื่อตัวแทนต้องการให้โฮสต์ดำเนินการเครื่องมือใดเครื่องมือหนึ่ง โหมด RPC จะส่งออก:

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

### การอัปเดตและการเสร็จสิ้นขาเข้า

โฮสต์สามารถสตรีมความคืบหน้าโดยไม่บังคับ:

```json
{
  "type": "host_tool_update",
  "id": "host_1",
  "partialResult": {
    "content": [{ "type": "text", "text": "working" }]
  }
}
```

การเสร็จสิ้นใช้:

```json
{
  "type": "host_tool_result",
  "id": "host_1",
  "result": {
    "content": [{ "type": "text", "text": "done" }]
  }
}
```

ตั้งค่า `isError: true` บน `host_tool_result` เพื่อแสดงเนื้อหาที่ส่งคืนเป็นข้อผิดพลาดเครื่องมือ

## โมเดลข้อผิดพลาดและความสามารถในการกู้คืน

### ความล้มเหลวระดับคำสั่ง

ความล้มเหลวคือ `success: false` พร้อมสตริง `error`

```json
{ "id": "req_2", "type": "response", "command": "set_model", "success": false, "error": "Model not found: provider/model" }
```

### ความคาดหวังเกี่ยวกับความสามารถในการกู้คืน

- ความล้มเหลวของคำสั่งส่วนใหญ่สามารถกู้คืนได้; กระบวนการยังคงทำงานอยู่
- JSONL ที่ผิดรูปแบบ / ข้อยกเว้นในลูปการแยกวิเคราะห์จะส่งการตอบสนองข้อผิดพลาด `parse` และดำเนินการอ่านบรรทัดถัดไปต่อ
- `set_session_name` ที่ว่างเปล่าจะถูกปฏิเสธ (`Session name cannot be empty`)
- การตอบสนอง Extension UI ที่มี `id` ที่ไม่รู้จักจะถูกละเว้น
- เงื่อนไขการสิ้นสุดกระบวนการคือการปิด stdin หรือการปิดระบบที่ส่วนขยายเริ่มต้น

## โฟลว์คำสั่งแบบย่อ

### 1) พรอมต์และสตรีม

stdin:

```json
{ "id": "req_1", "type": "prompt", "message": "Summarize this repo" }
```

ลำดับ stdout (โดยทั่วไป):

```json
{ "id": "req_1", "type": "response", "command": "prompt", "success": true }
{ "type": "agent_start" }
{ "type": "message_update", "assistantMessageEvent": { "type": "text_delta", "delta": "..." }, "message": { "role": "assistant", "content": [] } }
{ "type": "agent_end", "messages": [] }
```

### 2) พรอมต์ระหว่างสตรีมมิ่งพร้อมนโยบายคิวที่ชัดเจน

stdin:

```json
{ "id": "req_2", "type": "prompt", "message": "Also include risks", "streamingBehavior": "followUp" }
```

### 3) ตรวจสอบและปรับพฤติกรรมคิว

stdin:

```json
{ "id": "q1", "type": "get_state" }
{ "id": "q2", "type": "set_steering_mode", "mode": "all" }
{ "id": "q3", "type": "set_interrupt_mode", "mode": "wait" }
```

### 4) การส่งข้อมูลไป-กลับของ Extension UI

stdout:

```json
{ "type": "extension_ui_request", "id": "ui_7", "method": "input", "title": "Branch name", "placeholder": "feature/..." }
```

stdin:

```json
{ "type": "extension_ui_response", "id": "ui_7", "value": "feature/rpc-host" }
```

## หมายเหตุเกี่ยวกับตัวช่วย `RpcClient`

`src/modes/rpc/rpc-client.ts` คือ wrapper ที่สะดวก ไม่ใช่นิยามโปรโตคอล

คุณสมบัติของตัวช่วยปัจจุบัน:

- สร้าง `bun <cliPath> --mode rpc`
- เชื่อมโยงการตอบสนองด้วย id ที่สร้างขึ้น `req_<n>`
- ส่งต่อเฉพาะประเภท `AgentEvent` ที่รู้จักไปยัง listener
- รองรับเครื่องมือที่กำหนดเองที่เป็นของโฮสต์ผ่าน `setCustomTools()` และการจัดการอัตโนมัติของ `host_tool_call` / `host_tool_cancel`
- **ไม่** เปิดเผยเมธอดตัวช่วยสำหรับทุกคำสั่งโปรโตคอล (ตัวอย่างเช่น `set_interrupt_mode` และ `set_session_name` อยู่ในประเภทโปรโตคอลแต่ไม่ได้ถูกห่อเป็นเมธอดที่กำหนดไว้)

ใช้เฟรมโปรโตคอลแบบดิบหากคุณต้องการครอบคลุมพื้นผิวทั้งหมด
