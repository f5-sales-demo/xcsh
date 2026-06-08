---
title: Session Storage and Entry Model
description: >-
  Append-only session storage model with entry types, persistence, and migration
  between formats.
sidebar:
  order: 1
  label: Storage & entry model
i18n:
  sourceHash: 42fe17549e00
  translator: machine
---

# การจัดเก็บเซสชันและโมเดลรายการ

เอกสารนี้เป็นแหล่งข้อมูลอ้างอิงหลักสำหรับวิธีการแสดงผล การจัดเก็บ การย้ายข้อมูล และการสร้างเซสชันของ coding-agent ขึ้นใหม่ในขณะรันไทม์

## ขอบเขต

ครอบคลุม:

- รูปแบบ JSONL ของเซสชันและการกำหนดเวอร์ชัน
- อนุกรมวิธานของรายการและความหมายของโครงสร้างต้นไม้ (`id`/`parentId` + leaf pointer)
- พฤติกรรมการย้ายข้อมูล/ความเข้ากันได้เมื่อโหลดไฟล์เก่าหรือไฟล์ที่มีรูปแบบผิดพลาด
- การสร้างบริบทขึ้นใหม่ (`buildSessionContext`)
- การรับประกันการจัดเก็บ พฤติกรรมเมื่อเกิดข้อผิดพลาด การตัดทอน/การแยกข้อมูล blob ออกภายนอก
- การนามธรรมของพื้นที่จัดเก็บ (`FileSessionStorage`, `MemorySessionStorage`) และยูทิลิตี้ที่เกี่ยวข้อง

ไม่ครอบคลุมพฤติกรรมการแสดงผล UI ของ `/tree` นอกเหนือจากความหมายที่มีผลกระทบต่อข้อมูลเซสชัน

## ไฟล์การใช้งาน

- [`src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`src/session/messages.ts`](../../packages/coding-agent/src/session/messages.ts)
- [`src/session/session-storage.ts`](../../packages/coding-agent/src/session/session-storage.ts)
- [`src/session/history-storage.ts`](../../packages/coding-agent/src/session/history-storage.ts)
- [`src/session/blob-store.ts`](../../packages/coding-agent/src/session/blob-store.ts)

## เค้าโครงบนดิสก์

ตำแหน่งไฟล์เซสชันเริ่มต้น:

```text
~/.xcsh/agent/sessions/--<cwd-encoded>--/<timestamp>_<sessionId>.jsonl
```

`<cwd-encoded>` ได้มาจากไดเรกทอรีทำงานโดยการตัดเครื่องหมาย slash นำหน้าออกและแทนที่ `/`, `\\` และ `:` ด้วย `-`

ตำแหน่ง blob store:

```text
~/.xcsh/agent/blobs/<sha256>
```

ไฟล์ breadcrumb ของเทอร์มินัลจะถูกเขียนไว้ที่:

```text
~/.xcsh/agent/terminal-sessions/<terminal-id>
```

เนื้อหา breadcrumb เป็นสองบรรทัด: cwd เดิม ตามด้วยเส้นทางไฟล์เซสชัน `continueRecent()` จะให้ความสำคัญกับตัวชี้ที่กำหนดขอบเขตตามเทอร์มินัลนี้ก่อนการสแกน mtime ล่าสุด

## รูปแบบไฟล์

ไฟล์เซสชันเป็น JSONL: หนึ่ง JSON object ต่อหนึ่งบรรทัด

- บรรทัดที่ 1 เป็นส่วนหัวเซสชันเสมอ (`type: "session"`)
- บรรทัดที่เหลือเป็นค่า `SessionEntry`
- รายการเป็นแบบ append-only ในขณะรันไทม์; การนำทางสาขาจะย้ายตัวชี้ (`leafId`) แทนที่จะแก้ไขรายการที่มีอยู่

### ส่วนหัว (`SessionHeader`)

```json
{
  "type": "session",
  "version": 3,
  "id": "1f9d2a6b9c0d1234",
  "timestamp": "2026-02-16T10:20:30.000Z",
  "cwd": "/work/pi",
  "title": "optional session title",
  "parentSession": "optional lineage marker"
}
```

หมายเหตุ:

- `version` เป็นค่าเลือกได้ในไฟล์ v1; การไม่มีค่าหมายถึง v1
- `parentSession` เป็นสตริงสายสืบทอดแบบ opaque โค้ดปัจจุบันเขียนเป็น session id หรือเส้นทางเซสชันขึ้นอยู่กับโฟลว์ (`fork`, `forkFrom`, `createBranchedSession` หรือ `newSession({ parentSession })` แบบชัดเจน) ถือเป็นข้อมูลเมตาเดตา ไม่ใช่ foreign key แบบมีชนิดข้อมูล

### ฐานรายการ (`SessionEntryBase`)

รายการที่ไม่ใช่ส่วนหัวทั้งหมดประกอบด้วย:

```json
{
  "type": "...",
  "id": "8-char-id",
  "parentId": "previous-or-branch-parent",
  "timestamp": "2026-02-16T10:20:30.000Z"
}
```

`parentId` สามารถเป็น `null` สำหรับรายการรากแรก (การเพิ่มข้อมูลครั้งแรก หรือหลังจาก `resetLeaf()`)

## อนุกรมวิธานรายการ

`SessionEntry` เป็น union ของ:

- `message`
- `thinking_level_change`
- `model_change`
- `compaction`
- `branch_summary`
- `custom`
- `custom_message`
- `label`
- `ttsr_injection`
- `session_init`
- `mode_change`

### `message`

จัดเก็บ `AgentMessage` โดยตรง

```json
{
  "type": "message",
  "id": "a1b2c3d4",
  "parentId": null,
  "timestamp": "2026-02-16T10:21:00.000Z",
  "message": {
    "role": "assistant",
    "provider": "anthropic",
    "model": "claude-sonnet-4-5",
    "content": [{ "type": "text", "text": "Done." }],
    "usage": { "input": 100, "output": 20, "cacheRead": 0, "cacheWrite": 0, "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "total": 0 } },
    "timestamp": 1760000000000
  }
}
```

### `model_change`

```json
{
  "type": "model_change",
  "id": "b1c2d3e4",
  "parentId": "a1b2c3d4",
  "timestamp": "2026-02-16T10:21:30.000Z",
  "model": "openai/gpt-4o",
  "role": "default"
}
```

`role` เป็นค่าเลือกได้; หากไม่มีจะถือว่าเป็น `default` ในการสร้างบริบทขึ้นใหม่

### `thinking_level_change`

```json
{
  "type": "thinking_level_change",
  "id": "c1d2e3f4",
  "parentId": "b1c2d3e4",
  "timestamp": "2026-02-16T10:22:00.000Z",
  "thinkingLevel": "high"
}
```

### `compaction`

```json
{
  "type": "compaction",
  "id": "d1e2f3a4",
  "parentId": "c1d2e3f4",
  "timestamp": "2026-02-16T10:23:00.000Z",
  "summary": "Conversation summary",
  "shortSummary": "Short recap",
  "firstKeptEntryId": "a1b2c3d4",
  "tokensBefore": 42000,
  "details": { "readFiles": ["src/a.ts"] },
  "preserveData": { "hookState": true },
  "fromExtension": false
}
```

### `branch_summary`

```json
{
  "type": "branch_summary",
  "id": "e1f2a3b4",
  "parentId": "a1b2c3d4",
  "timestamp": "2026-02-16T10:24:00.000Z",
  "fromId": "a1b2c3d4",
  "summary": "Summary of abandoned path",
  "details": { "note": "optional" },
  "fromExtension": true
}
```

หากแยกสาขาจากราก (`branchFromId === null`) `fromId` จะเป็นสตริงตัวอักษร `"root"`

### `custom`

การจัดเก็บสถานะของส่วนขยาย; ถูกเพิกเฉยโดย `buildSessionContext`

```json
{
  "type": "custom",
  "id": "f1a2b3c4",
  "parentId": "e1f2a3b4",
  "timestamp": "2026-02-16T10:25:00.000Z",
  "customType": "my-extension",
  "data": { "state": 1 }
}
```

### `custom_message`

ข้อความที่ส่วนขยายจัดเตรียมซึ่งมีส่วนร่วมในบริบท LLM

```json
{
  "type": "custom_message",
  "id": "a2b3c4d5",
  "parentId": "f1a2b3c4",
  "timestamp": "2026-02-16T10:26:00.000Z",
  "customType": "my-extension",
  "content": "Injected context",
  "display": true,
  "details": { "debug": false }
}
```

### `label`

```json
{
  "type": "label",
  "id": "b2c3d4e5",
  "parentId": "a2b3c4d5",
  "timestamp": "2026-02-16T10:27:00.000Z",
  "targetId": "a1b2c3d4",
  "label": "checkpoint"
}
```

`label: undefined` จะล้างป้ายกำกับสำหรับ `targetId`

### `ttsr_injection`

```json
{
  "type": "ttsr_injection",
  "id": "c2d3e4f5",
  "parentId": "b2c3d4e5",
  "timestamp": "2026-02-16T10:28:00.000Z",
  "injectedRules": ["ruleA", "ruleB"]
}
```

### `session_init`

```json
{
  "type": "session_init",
  "id": "d2e3f4a5",
  "parentId": "c2d3e4f5",
  "timestamp": "2026-02-16T10:29:00.000Z",
  "systemPrompt": "...",
  "task": "...",
  "tools": ["read", "edit"],
  "outputSchema": { "type": "object" }
}
```

### `mode_change`

```json
{
  "type": "mode_change",
  "id": "e2f3a4b5",
  "parentId": "d2e3f4a5",
  "timestamp": "2026-02-16T10:30:00.000Z",
  "mode": "plan",
  "data": { "planFile": "/tmp/plan.md" }
}
```

## การกำหนดเวอร์ชันและการย้ายข้อมูล

เวอร์ชันเซสชันปัจจุบัน: `3`

### v1 -> v2

ใช้เมื่อส่วนหัว `version` ไม่มีหรือ `< 2`:

- เพิ่ม `id` และ `parentId` ให้กับรายการที่ไม่ใช่ส่วนหัวแต่ละรายการ
- สร้างสายพาเรนต์แบบเชิงเส้นขึ้นใหม่โดยใช้ลำดับในไฟล์
- ย้ายข้อมูลฟิลด์ compaction `firstKeptEntryIndex` -> `firstKeptEntryId` เมื่อมีอยู่
- ตั้งค่าส่วนหัว `version = 2`

### v2 -> v3

ใช้เมื่อส่วนหัว `version < 3`:

- สำหรับรายการ `message`: เขียนใหม่จาก `message.role === "hookMessage"` แบบเดิมเป็น `"custom"`
- ตั้งค่าส่วนหัว `version = 3`

### ทริกเกอร์การย้ายข้อมูลและการจัดเก็บถาวร

- การย้ายข้อมูลทำงานระหว่างการโหลดเซสชัน (`setSessionFile`)
- หากมีการย้ายข้อมูลใด ๆ ทำงาน ไฟล์ทั้งหมดจะถูกเขียนใหม่ลงดิสก์ทันที
- การย้ายข้อมูลจะแก้ไขรายการในหน่วยความจำก่อน จากนั้นจึงจัดเก็บ JSONL ที่เขียนใหม่อย่างถาวร

## พฤติกรรมการโหลดและความเข้ากันได้

พฤติกรรมของ `loadEntriesFromFile(path)`:

- ไฟล์ที่หายไป (`ENOENT`) -> คืนค่า `[]`
- บรรทัดที่แยกวิเคราะห์ไม่ได้จะถูกจัดการโดยตัวแยกวิเคราะห์ JSONL แบบผ่อนปรน (`parseJsonlLenient`)
- หากรายการแรกที่แยกวิเคราะห์ได้ไม่ใช่ส่วนหัวเซสชันที่ถูกต้อง (`type !== "session"` หรือไม่มีสตริง `id`) -> คืนค่า `[]`

พฤติกรรมของ `SessionManager.setSessionFile()`:

- `[]` จากตัวโหลดจะถือว่าเป็นเซสชันว่าง/ไม่มีอยู่ และจะถูกแทนที่ด้วยไฟล์เซสชันที่เริ่มต้นใหม่ที่เส้นทางนั้น
- ไฟล์ที่ถูกต้องจะถูกโหลด ย้ายข้อมูลหากจำเป็น แก้ไขการอ้างอิง blob จากนั้นจัดทำดัชนี

## ความหมายของโครงสร้างต้นไม้และ Leaf

โมเดลพื้นฐานเป็นต้นไม้แบบ append-only + ตัวชี้ leaf ที่เปลี่ยนแปลงได้:

- ทุกเมธอด append จะสร้างรายการใหม่หนึ่งรายการที่มี `parentId` เป็น `leafId` ปัจจุบัน
- รายการใหม่จะกลายเป็น `leafId` ใหม่
- `branch(entryId)` ย้ายเฉพาะ `leafId`; รายการที่มีอยู่ไม่เปลี่ยนแปลง
- `resetLeaf()` ตั้งค่า `leafId = null`; การ append ครั้งถัดไปจะสร้างรายการรากใหม่ (`parentId: null`)
- `branchWithSummary()` ตั้ง leaf ไปที่เป้าหมายสาขาและเพิ่มรายการ `branch_summary`

`getEntries()` คืนค่ารายการที่ไม่ใช่ส่วนหัวทั้งหมดตามลำดับการแทรก รายการที่มีอยู่จะไม่ถูกลบในการดำเนินงานปกติ; การเขียนใหม่จะรักษาประวัติเชิงตรรกะในขณะที่อัปเดตการแสดงผล (การย้ายข้อมูล การย้าย ตัวช่วยเขียนใหม่แบบเจาะจง)

## การสร้างบริบทขึ้นใหม่ (`buildSessionContext`)

`buildSessionContext(entries, leafId, byId?)` แก้ไขสิ่งที่ถูกส่งไปยังโมเดล

อัลกอริทึม:

1. กำหนด leaf:
   - `leafId === null` -> คืนค่าบริบทว่าง
   - `leafId` ที่ชัดเจน -> ใช้รายการนั้นหากพบ
   - มิฉะนั้นจะ fallback ไปยังรายการสุดท้าย
2. เดินตามสาย `parentId` จาก leaf ไปยัง root และกลับลำดับเป็นเส้นทาง root->leaf
3. อนุมานสถานะรันไทม์ข้ามเส้นทาง:
   - `thinkingLevel` จาก `thinking_level_change` ล่าสุด (ค่าเริ่มต้น `"off"`)
   - แผนที่โมเดลจากรายการ `model_change` (`role ?? "default"`)
   - `models.default` สำรองจาก provider/model ของข้อความ assistant หากไม่มีการเปลี่ยนโมเดลอย่างชัดเจน
   - `injectedTtsrRules` ที่ไม่ซ้ำจากรายการ `ttsr_injection` ทั้งหมด
   - mode/modeData จาก `mode_change` ล่าสุด (โหมดเริ่มต้น `"none"`)
4. สร้างรายการข้อความ:
   - รายการ `message` ส่งผ่านตรง ๆ
   - รายการ `custom_message` กลายเป็น `custom` AgentMessages ผ่าน `createCustomMessage`
   - รายการ `branch_summary` กลายเป็น `branchSummary` AgentMessages ผ่าน `createBranchSummaryMessage`
   - หากมี `compaction` อยู่บนเส้นทาง:
     - ส่งออกสรุป compaction ก่อน (`createCompactionSummaryMessage`)
     - ส่งออกรายการบนเส้นทางเริ่มจาก `firstKeptEntryId` ถึงขอบเขต compaction
     - ส่งออกรายการหลังขอบเขต compaction

รายการ `custom` และ `session_init` ไม่ได้ส่งบริบทโมเดลโดยตรง

## การรับประกันการจัดเก็บถาวรและโมเดลข้อผิดพลาด

### การจัดเก็บถาวร vs ในหน่วยความจำ

- `SessionManager.create/open/continueRecent/forkFrom` -> โหมดจัดเก็บถาวร (`persist = true`)
- `SessionManager.inMemory` -> โหมดไม่จัดเก็บถาวร (`persist = false`) ด้วย `MemorySessionStorage`

### ไปป์ไลน์การเขียน

การเขียนถูกจัดลำดับผ่านสาย promise ภายใน (`#persistChain`) และ `NdjsonFileWriter`

- `append*` อัปเดตสถานะในหน่วยความจำทันที
- การจัดเก็บถาวรจะถูกเลื่อนออกไปจนกว่าจะมีข้อความ assistant อย่างน้อยหนึ่งข้อความ
  - ก่อน assistant แรก: รายการจะถูกเก็บในหน่วยความจำ; ไม่มีการ append ไฟล์เกิดขึ้น
  - เมื่อมี assistant แรก: เซสชันในหน่วยความจำทั้งหมดจะถูก flush ลงไฟล์
  - หลังจากนั้น: รายการใหม่จะ append แบบเพิ่มเติม

เหตุผลในโค้ด: หลีกเลี่ยงการจัดเก็บเซสชันที่ไม่เคยสร้างการตอบสนองจาก assistant

### การดำเนินการด้านความทนทาน

- `flush()` flush ตัวเขียนและเรียก `fsync()`
- การเขียนใหม่ทั้งหมดแบบ atomic (`#rewriteFile`) เขียนไปยังไฟล์ชั่วคราว flush+fsync ปิด จากนั้นเปลี่ยนชื่อทับเป้าหมาย
- ใช้สำหรับการย้ายข้อมูล `setSessionName` `rewriteEntries` การดำเนินการย้าย และการเขียนใหม่ arg ของ tool-call

### พฤติกรรมข้อผิดพลาด

- ข้อผิดพลาดการจัดเก็บถาวรจะถูกล็อก (`#persistError`) และโยนซ้ำในการดำเนินการถัดไป
- ข้อผิดพลาดแรกจะถูกบันทึกล็อกครั้งเดียวพร้อมบริบทไฟล์เซสชัน
- การปิดตัวเขียนเป็นแบบ best-effort แต่จะเผยแพร่ข้อผิดพลาดที่มีความหมายแรก

## การควบคุมขนาดข้อมูลและการแยก Blob ออกภายนอก

ก่อนการจัดเก็บรายการอย่างถาวร:

- สตริงขนาดใหญ่จะถูกตัดทอนเป็น `MAX_PERSIST_CHARS` (500,000 อักขระ) พร้อมข้อความแจ้ง:
  - `"[Session persistence truncated large content]"`
- ฟิลด์ชั่วคราว `partialJson` และ `jsonlEvents` จะถูกลบออก
- หากอ็อบเจกต์มีทั้ง `content` และ `lineCount` จำนวนบรรทัดจะถูกคำนวณใหม่หลังการตัดทอน
- บล็อกรูปภาพในอาร์เรย์ `content` ที่มีความยาว base64 >= 1024 จะถูกแยกออกเป็นการอ้างอิง blob:
  - จัดเก็บเป็น `blob:sha256:<hash>`
  - เขียนไบต์ดิบไปยัง blob store (`BlobStore.put`)

เมื่อโหลด การอ้างอิง blob จะถูกแก้ไขกลับเป็น base64 สำหรับบล็อกรูปภาพ message/custom_message

## การนามธรรมของพื้นที่จัดเก็บ

อินเทอร์เฟซ `SessionStorage` จัดเตรียมการดำเนินการระบบไฟล์ทั้งหมดที่ `SessionManager` ใช้:

- แบบซิงค์: `ensureDirSync`, `existsSync`, `writeTextSync`, `statSync`, `listFilesSync`
- แบบอะซิงค์: `exists`, `readText`, `readTextPrefix`, `writeText`, `rename`, `unlink`, `openWriter`

การใช้งาน:

- `FileSessionStorage`: ระบบไฟล์จริง (Bun + node fs)
- `MemorySessionStorage`: การใช้งานในหน่วยความจำที่สำรองด้วย map สำหรับการทดสอบ/เซสชันที่ไม่จัดเก็บถาวร

`SessionStorageWriter` เปิดเผย `writeLine`, `flush`, `fsync`, `close`, `getError`

## ยูทิลิตี้การค้นหาเซสชัน

กำหนดใน `session-manager.ts`:

- `getRecentSessions(sessionDir, limit)` -> ข้อมูลเมตาเดตาแบบเบาสำหรับ UI/ตัวเลือกเซสชัน
- `findMostRecentSession(sessionDir)` -> ใหม่ที่สุดตาม mtime
- `list(cwd, sessionDir?)` -> เซสชันในขอบเขตโปรเจกต์เดียว
- `listAll()` -> เซสชันข้ามขอบเขตโปรเจกต์ทั้งหมดภายใต้ `~/.xcsh/agent/sessions`

การดึงข้อมูลเมตาเดตาอ่านเฉพาะคำนำหน้า (`readTextPrefix(..., 4096)`) เมื่อเป็นไปได้

## เกี่ยวข้องแต่แยกกัน: Prompt History Storage

`HistoryStorage` (`history-storage.ts`) เป็นระบบย่อย SQLite แยกต่างหากสำหรับการเรียกคืน/ค้นหาพรอมต์ ไม่ใช่การเล่นซ้ำเซสชัน

- DB: `~/.xcsh/agent/history.db`
- ตาราง: `history(id, prompt, created_at, cwd)`
- ดัชนี FTS5: `history_fts` พร้อมการซิงค์ที่ดูแลโดยทริกเกอร์
- ขจัดพรอมต์ที่ซ้ำกันติดต่อกันโดยใช้แคช last-prompt ในหน่วยความจำ
- การแทรกแบบอะซิงค์ (`setImmediate`) เพื่อให้การจับพรอมต์ไม่บล็อกการทำงานของเทิร์น

ใช้ไฟล์เซสชันสำหรับการเล่นซ้ำกราฟ/สถานะการสนทนา; ใช้ `HistoryStorage` สำหรับ UX ของประวัติพรอมต์
