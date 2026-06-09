---
title: เอกสารอ้างอิงโปรโตคอล RPC
description: เอกสารอ้างอิงโปรโตคอล JSON-RPC สำหรับการสื่อสารระหว่างโปรเซสของส่วนประกอบ xcsh
sidebar:
  order: 5
  label: โปรโตคอล RPC
i18n:
  sourceHash: b4a3ddaf08ab
  translator: machine
---

# เอกสารอ้างอิงโปรโตคอล RPC

โหมด RPC เรียกใช้ coding agent ในรูปแบบโปรโตคอล JSON คั่นด้วยบรรทัดใหม่ผ่าน stdio

- **stdin**: คำสั่ง (`RpcCommand`) และการตอบกลับ UI ของส่วนขยาย
- **stdout**: การตอบกลับคำสั่ง (`RpcResponse`), อีเวนต์ session/agent, คำร้องขอ UI ของส่วนขยาย

การใช้งานหลัก:

- `src/modes/rpc/rpc-mode.ts`
- `src/modes/rpc/rpc-types.ts`
- `src/session/agent-session.ts`
- `packages/agent/src/agent.ts`
- `packages/agent/src/agent-loop.ts`

## การเริ่มต้น

```bash
xcsh --mode rpc [regular CLI options]
```

หมายเหตุพฤติกรรม:

- อาร์กิวเมนต์ CLI แบบ `@file` จะถูกปฏิเสธในโหมด RPC
- โหมด RPC ปิดการสร้างชื่อเซสชันอัตโนมัติโดยค่าเริ่มต้น เพื่อหลีกเลี่ยงการเรียกโมเดลเพิ่มเติม
- โหมด RPC รีเซ็ตการตั้งค่าที่เปลี่ยนแปลงเวิร์กโฟลว์ `todo.*`, `task.*` และ `async.*` กลับเป็นค่าเริ่มต้นในตัวแทนที่จะสืบทอดการแก้ไขของผู้ใช้
- โปรเซสอ่าน stdin เป็น JSONL (`readJsonl(Bun.stdin.stream())`)
- เมื่อ stdin ปิด โปรเซสจะออกด้วยรหัส `0`
- การตอบกลับ/อีเวนต์จะถูกเขียนเป็นหนึ่งออบเจกต์ JSON ต่อบรรทัด

## การขนส่งและการจัดเฟรม

แต่ละเฟรมคือออบเจกต์ JSON เดียวตามด้วย `\n`

ไม่มีโครงสร้างห่อหุ้มนอกเหนือจากรูปร่างของออบเจกต์เอง

### หมวดหมู่เฟรมขาออก (stdout)

1. `RpcResponse` (`{ type: "response", ... }`)
2. ออบเจกต์ `AgentSessionEvent` (`agent_start`, `message_update` เป็นต้น)
3. `RpcExtensionUIRequest` (`{ type: "extension_ui_request", ... }`)
4. ข้อผิดพลาดของส่วนขยาย (`{ type: "extension_error", extensionPath, event, error }`)

### หมวดหมู่เฟรมขาเข้า (stdin)

1. `RpcCommand`
2. `RpcExtensionUIResponse` (`{ type: "extension_ui_response", ... }`)

## การเชื่อมโยงคำร้องขอ/การตอบกลับ

คำสั่งทั้งหมดรับ `id?: string` ที่เป็นตัวเลือก

- หากระบุไว้ การตอบกลับคำสั่งปกติจะส่ง `id` เดิมกลับมา
- `RpcClient` ใช้สิ่งนี้ในการแก้ไขคำร้องขอที่ค้างอยู่

พฤติกรรมขอบเขตที่สำคัญจากรันไทม์:

- การตอบกลับคำสั่งที่ไม่รู้จักจะถูกส่งออกพร้อม `id: undefined` (แม้ว่าคำร้องขอจะมี `id`)
- ข้อยกเว้นจากการแยกวิเคราะห์/ตัวจัดการในลูปอินพุตจะส่งออก `command: "parse"` พร้อม `id: undefined`
- `prompt` และ `abort_and_prompt` ส่งคืนความสำเร็จทันที จากนั้นอาจส่งการตอบกลับข้อผิดพลาดในภายหลังพร้อม **id เดิม** หากการจัดกำหนดการ prompt แบบอะซิงโครนัสล้มเหลว

## สคีมาคำสั่ง (มาตรฐาน)

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

เพย์โหลดข้อมูลเฉพาะสำหรับแต่ละคำสั่งและถูกกำหนดใน `rpc-types.ts`

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

แทนที่สถานะ todo ในหน่วยความจำสำหรับเซสชันปัจจุบันและส่งคืนรายการเฟสที่ปรับให้เป็นมาตรฐาน:

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

สิ่งนี้มีประโยชน์สำหรับโฮสต์ที่ต้องการกำหนดแผนล่วงหน้าก่อน prompt แรก

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

เครื่องมือเหล่านี้จะถูกเพิ่มลงในรีจิสทรีเครื่องมือของเซสชันที่ใช้งานอยู่ก่อนการเรียกโมเดลครั้งถัดไป
การส่ง `set_host_tools` ซ้ำจะแทนที่ชุดที่เป็นของโฮสต์ก่อนหน้า

## สคีมาสตรีมอีเวนต์

โหมด RPC ส่งต่อออบเจกต์ `AgentSessionEvent` จาก `AgentSession.subscribe(...)`

ประเภทอีเวนต์ทั่วไป:

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

`message_update` รวมเดลตาสตรีมมิ่งใน `assistantMessageEvent` (เดลตาของข้อความ/การคิด/การเรียกเครื่องมือ)

## การทำงานพร้อมกันและลำดับของ Prompt/คิว

นี่คือพฤติกรรมการทำงานที่สำคัญที่สุด

### การตอบรับทันทีเทียบกับการเสร็จสิ้น

`prompt` และ `abort_and_prompt` จะ **ได้รับการตอบรับทันที**:

```json
{ "id": "req_1", "type": "response", "command": "prompt", "success": true }
```

ซึ่งหมายความว่า:

- การยอมรับคำสั่ง != การทำงานเสร็จสิ้น
- การเสร็จสิ้นขั้นสุดท้ายสังเกตได้ผ่าน `agent_end`

### ขณะสตรีมมิ่ง

`AgentSession.prompt()` ต้องการ `streamingBehavior` ระหว่างการสตรีมที่กำลังทำงาน:

- `"steer"` => ข้อความ steering ที่จัดคิว (เส้นทางการขัดจังหวะ)
- `"followUp"` => ข้อความ follow-up ที่จัดคิว (เส้นทางหลังจบเทิร์น)

หากไม่ระบุระหว่างการสตรีม prompt จะล้มเหลว

### ค่าเริ่มต้นของคิว

จากสคีมาการตั้งค่า coding-agent (`packages/coding-agent/src/config/settings-schema.ts`):

- `steeringMode`: `"one-at-a-time"`
- `followUpMode`: `"one-at-a-time"`
- `interruptMode`: `"wait"`

### ความหมายของโหมด

- `set_steering_mode` / `set_follow_up_mode`
  - `"one-at-a-time"`: ดึงข้อความที่จัดคิวออกทีละหนึ่งต่อเทิร์น
  - `"all"`: ดึงคิวทั้งหมดออกพร้อมกัน
- `set_interrupt_mode`
  - `"immediate"`: การทำงานเครื่องมือตรวจสอบ steering ระหว่างการเรียกเครื่องมือ; steering ที่ค้างอยู่สามารถยกเลิกการเรียกเครื่องมือที่เหลือในเทิร์นได้
  - `"wait"`: เลื่อน steering จนกว่าเทิร์นจะเสร็จสิ้น

## โปรโตคอลย่อย UI ของส่วนขยาย

ส่วนขยายในโหมด RPC ใช้เฟรม UI แบบคำร้องขอ/การตอบกลับ

### คำร้องขอขาออก

เมธอดของ `RpcExtensionUIRequest` (`type: "extension_ui_request"`):

- `select`, `confirm`, `input`, `editor`
- `notify`, `setStatus`, `setWidget`, `setTitle`, `set_editor_text`

หมายเหตุรันไทม์:

- การสร้างชื่อเซสชันอัตโนมัติถูกปิดในโหมด RPC และคำร้องขอ UI `setTitle`
  ก็ถูกระงับโดยค่าเริ่มต้นเช่นกัน เนื่องจากโฮสต์ส่วนใหญ่ไม่มีพื้นที่ชื่อเทอร์มินัล
  ที่มีความหมาย ตั้งค่า `PI_RPC_EMIT_TITLE=1` เพื่อเปิดใช้งานอีเวนต์ UI อีกครั้ง

ตัวอย่าง:

```json
{ "type": "extension_ui_request", "id": "123", "method": "confirm", "title": "Confirm", "message": "Continue?", "timeout": 30000 }
```

### การตอบกลับขาเข้า

`RpcExtensionUIResponse` (`type: "extension_ui_response"`):

- `{ type: "extension_ui_response", id: string, value: string }`
- `{ type: "extension_ui_response", id: string, confirmed: boolean }`
- `{ type: "extension_ui_response", id: string, cancelled: true }`

หากไดอะล็อกมีการหมดเวลา โหมด RPC จะแก้ไขเป็นค่าเริ่มต้นเมื่อการหมดเวลา/การยกเลิกเกิดขึ้น

## โปรโตคอลย่อยเครื่องมือโฮสต์

โฮสต์ RPC สามารถเปิดเผยเครื่องมือที่กำหนดเองให้กับ agent โดยส่ง `set_host_tools` จากนั้น
ให้บริการคำร้องขอการทำงานผ่านการขนส่งเดียวกัน

### คำร้องขอขาออก

เมื่อ agent ต้องการให้โฮสต์ทำงานเครื่องมือหนึ่ง โหมด RPC จะส่งออก:

```json
{
  "type": "host_tool_call",
  "id": "host_1",
  "toolCallId": "toolu_123",
  "toolName": "echo_host",
  "arguments": { "message": "hello" }
}
```

หากการทำงานเครื่องมือถูกยกเลิกในภายหลัง โหมด RPC จะส่งออก:

```json
{
  "type": "host_tool_cancel",
  "id": "host_cancel_1",
  "targetId": "host_1"
}
```

### การอัปเดตและการเสร็จสิ้นขาเข้า

โฮสต์สามารถสตรีมความคืบหน้าได้ตามต้องการ:

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

ตั้งค่า `isError: true` บน `host_tool_result` เพื่อแสดงเนื้อหาที่ส่งคืนเป็นข้อผิดพลาดของเครื่องมือ

## รูปแบบข้อผิดพลาดและความสามารถในการกู้คืน

### ความล้มเหลวระดับคำสั่ง

ความล้มเหลวคือ `success: false` พร้อมสตริง `error`

```json
{ "id": "req_2", "type": "response", "command": "set_model", "success": false, "error": "Model not found: provider/model" }
```

### ความคาดหวังในการกู้คืน

- ความล้มเหลวของคำสั่งส่วนใหญ่สามารถกู้คืนได้; โปรเซสยังคงทำงาน
- JSONL ที่ผิดรูปแบบ / ข้อยกเว้นของลูปการแยกวิเคราะห์จะส่งการตอบกลับข้อผิดพลาด `parse` และอ่านบรรทัดถัดไปต่อ
- `set_session_name` ที่ว่างเปล่าจะถูกปฏิเสธ (`Session name cannot be empty`)
- การตอบกลับ UI ของส่วนขยายที่มี `id` ที่ไม่รู้จักจะถูกละเว้น
- เงื่อนไขการยุติโปรเซสคือการปิด stdin หรือการปิดที่ถูกทริกเกอร์โดยส่วนขยายอย่างชัดเจน

## ขั้นตอนคำสั่งแบบกระชับ

### 1) Prompt และสตรีม

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

### 2) Prompt ระหว่างสตรีมมิ่งพร้อมนโยบายคิวที่ระบุชัดเจน

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

### 4) การส่งกลับ UI ของส่วนขยาย

stdout:

```json
{ "type": "extension_ui_request", "id": "ui_7", "method": "input", "title": "Branch name", "placeholder": "feature/..." }
```

stdin:

```json
{ "type": "extension_ui_response", "id": "ui_7", "value": "feature/rpc-host" }
```

## หมายเหตุเกี่ยวกับตัวช่วย `RpcClient`

`src/modes/rpc/rpc-client.ts` เป็นตัวห่อหุ้มอำนวยความสะดวก ไม่ใช่คำจำกัดความของโปรโตคอล

ลักษณะของตัวช่วยปัจจุบัน:

- สร้างโปรเซส `bun <cliPath> --mode rpc`
- เชื่อมโยงการตอบกลับด้วย id ที่สร้างขึ้นในรูปแบบ `req_<n>`
- ส่งต่อเฉพาะประเภท `AgentEvent` ที่รู้จักไปยัง listener
- รองรับเครื่องมือที่กำหนดเองของโฮสต์ผ่าน `setCustomTools()` และการจัดการ `host_tool_call` / `host_tool_cancel` โดยอัตโนมัติ
- **ไม่ได้** เปิดเผยเมธอดตัวช่วยสำหรับทุกคำสั่งโปรโตคอล (ตัวอย่างเช่น `set_interrupt_mode` และ `set_session_name` อยู่ในประเภทโปรโตคอลแต่ไม่ได้ถูกห่อหุ้มเป็นเมธอดเฉพาะ)

ใช้เฟรมโปรโตคอลดิบหากคุณต้องการครอบคลุมพื้นที่ทั้งหมด
