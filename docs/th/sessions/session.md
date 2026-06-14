---
title: โมเดลการจัดเก็บข้อมูลเซสชันและรายการ
description: >-
  โมเดลการจัดเก็บข้อมูลเซสชันแบบ append-only พร้อมประเภทรายการ
  การคงอยู่ของข้อมูล และการโยกย้ายระหว่างรูปแบบต่างๆ
sidebar:
  order: 1
  label: โมเดลการจัดเก็บและรายการ
i18n:
  sourceHash: 42fe17549e00
  translator: machine
---

# โมเดลการจัดเก็บข้อมูลเซสชันและรายการ

เอกสารนี้เป็นแหล่งข้อมูลหลักสำหรับวิธีที่เซสชันของ coding-agent ถูกแสดง จัดเก็บ โยกย้าย และสร้างใหม่ขณะรันไทม์

## ขอบเขต

ครอบคลุม:

- รูปแบบ JSONL และการกำหนดเวอร์ชันของเซสชัน
- อนุกรมวิธานรายการและความหมายของต้นไม้ (`id`/`parentId` + leaf pointer)
- พฤติกรรมการโยกย้าย/ความเข้ากันได้เมื่อโหลดไฟล์เก่าหรือไฟล์ที่มีรูปแบบผิดพลาด
- การสร้างบริบทใหม่ (`buildSessionContext`)
- การรับประกันความคงอยู่ พฤติกรรมเมื่อเกิดความล้มเหลว การตัดทอน/การแยกเก็บ blob
- การแยกย่อยการจัดเก็บ (`FileSessionStorage`, `MemorySessionStorage`) และยูทิลิตีที่เกี่ยวข้อง

ไม่ครอบคลุมพฤติกรรมการเรนเดอร์ UI ของ `/tree` เกินกว่าความหมายที่ส่งผลต่อข้อมูลเซสชัน

## ไฟล์การนำไปใช้งาน

- [`src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`src/session/messages.ts`](../../packages/coding-agent/src/session/messages.ts)
- [`src/session/session-storage.ts`](../../packages/coding-agent/src/session/session-storage.ts)
- [`src/session/history-storage.ts`](../../packages/coding-agent/src/session/history-storage.ts)
- [`src/session/blob-store.ts`](../../packages/coding-agent/src/session/blob-store.ts)

## โครงสร้างบนดิสก์

ตำแหน่งไฟล์เซสชันเริ่มต้น:

```text
~/.xcsh/agent/sessions/--<cwd-encoded>--/<timestamp>_<sessionId>.jsonl
```

`<cwd-encoded>` ถูกสร้างจากไดเรกทอรีทำงานโดยการตัดเครื่องหมายทับนำหน้าออก และแทนที่ `/`, `\\`, และ `:` ด้วย `-`

ตำแหน่ง blob store:

```text
~/.xcsh/agent/blobs/<sha256>
```

ไฟล์ breadcrumb ของเทอร์มินัลถูกเขียนภายใต้:

```text
~/.xcsh/agent/terminal-sessions/<terminal-id>
```

เนื้อหา breadcrumb มีสองบรรทัด ได้แก่ cwd ต้นฉบับ และเส้นทางไฟล์เซสชัน `continueRecent()` ให้ความสำคัญกับ pointer ที่กำหนดขอบเขตเทอร์มินัลนี้ก่อนการสแกน mtime ล่าสุด

## รูปแบบไฟล์

ไฟล์เซสชันเป็น JSONL: หนึ่งออบเจกต์ JSON ต่อบรรทัด

- บรรทัดที่ 1 เป็น session header เสมอ (`type: "session"`)
- บรรทัดที่เหลือเป็นค่า `SessionEntry`
- รายการเป็นแบบ append-only ขณะรันไทม์ การนำทางสาขาเลื่อน pointer (`leafId`) แทนการแก้ไขรายการที่มีอยู่

### Header (`SessionHeader`)

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

- `version` เป็นตัวเลือกในไฟล์ v1 การไม่มีค่าหมายถึง v1
- `parentSession` เป็น string สายสืบทอดแบบ opaque โค้ดปัจจุบันเขียนทั้ง session id หรือเส้นทางเซสชันขึ้นอยู่กับ flow (`fork`, `forkFrom`, `createBranchedSession`, หรือ explicit `newSession({ parentSession })`) ให้ถือเป็น metadata ไม่ใช่ foreign key แบบมีประเภท

### Entry Base (`SessionEntryBase`)

รายการที่ไม่ใช่ header ทั้งหมดประกอบด้วย:

```json
{
  "type": "...",
  "id": "8-char-id",
  "parentId": "previous-or-branch-parent",
  "timestamp": "2026-02-16T10:20:30.000Z"
}
```

`parentId` อาจเป็น `null` สำหรับรายการ root (การ append ครั้งแรก หรือหลัง `resetLeaf()`)

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

`role` เป็นตัวเลือก การไม่มีค่าถูกถือเป็น `default` ในการสร้างบริบทใหม่

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

หากแตกสาขาจาก root (`branchFromId === null`) `fromId` คือ string ตามตัวอักษร `"root"`

### `custom`

การคงอยู่ของสถานะ extension ถูกละเว้นโดย `buildSessionContext`

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

ข้อความที่ extension จัดเตรียมซึ่งมีส่วนร่วมในบริบท LLM

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

`label: undefined` ล้าง label สำหรับ `targetId`

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

## การกำหนดเวอร์ชันและการโยกย้าย

เวอร์ชันเซสชันปัจจุบัน: `3`

### v1 -> v2

ใช้เมื่อ header `version` หายไปหรือ `< 2`:

- เพิ่ม `id` และ `parentId` ให้กับแต่ละรายการที่ไม่ใช่ header
- สร้าง parent chain เชิงเส้นใหม่โดยใช้ลำดับไฟล์
- โยกย้ายฟิลด์ compaction `firstKeptEntryIndex` -> `firstKeptEntryId` เมื่อมีอยู่
- ตั้งค่า header `version = 2`

### v2 -> v3

ใช้เมื่อ header `version < 3`:

- สำหรับรายการ `message`: เขียน `message.role === "hookMessage"` แบบ legacy ใหม่เป็น `"custom"`
- ตั้งค่า header `version = 3`

### ทริกเกอร์การโยกย้ายและการคงอยู่

- การโยกย้ายทำงานระหว่างการโหลดเซสชัน (`setSessionFile`)
- หากมีการโยกย้ายใดๆ เกิดขึ้น ไฟล์ทั้งหมดจะถูกเขียนใหม่ลงดิสก์ทันที
- การโยกย้ายแก้ไขรายการในหน่วยความจำก่อน จากนั้นจึงคงอยู่โดยการเขียน JSONL ใหม่

## พฤติกรรมการโหลดและความเข้ากันได้

พฤติกรรมของ `loadEntriesFromFile(path)`:

- ไฟล์หายไป (`ENOENT`) -> คืนค่า `[]`
- บรรทัดที่แยกวิเคราะห์ไม่ได้จะถูกจัดการโดย lenient JSONL parser (`parseJsonlLenient`)
- หากรายการแรกที่แยกวิเคราะห์ได้ไม่ใช่ session header ที่ถูกต้อง (`type !== "session"` หรือไม่มี string `id`) -> คืนค่า `[]`

พฤติกรรมของ `SessionManager.setSessionFile()`:

- `[]` จาก loader ถูกถือว่าเป็นเซสชันที่ว่างเปล่า/ไม่มีอยู่ และถูกแทนที่ด้วยไฟล์เซสชันที่เริ่มต้นใหม่ที่เส้นทางนั้น
- ไฟล์ที่ถูกต้องจะถูกโหลด โยกย้ายหากจำเป็น แก้ไข blob refs จากนั้นจึงสร้างดัชนี

## ความหมายของต้นไม้และ Leaf

โมเดลพื้นฐานคือต้นไม้แบบ append-only + mutable leaf pointer:

- ทุกเมธอด append จะสร้างรายการใหม่หนึ่งรายการที่มี `parentId` เป็น `leafId` ปัจจุบัน
- รายการใหม่จะกลายเป็น `leafId` ใหม่
- `branch(entryId)` เลื่อนเฉพาะ `leafId` เท่านั้น รายการที่มีอยู่ไม่เปลี่ยนแปลง
- `resetLeaf()` ตั้งค่า `leafId = null` การ append ครั้งถัดไปจะสร้างรายการ root ใหม่ (`parentId: null`)
- `branchWithSummary()` ตั้งค่า leaf เป็นเป้าหมายสาขา และ append รายการ `branch_summary`

`getEntries()` คืนค่ารายการที่ไม่ใช่ header ทั้งหมดตามลำดับการแทรก รายการที่มีอยู่จะไม่ถูกลบในการทำงานปกติ การเขียนใหม่จะคงประวัติเชิงตรรกะไว้ในขณะที่อัปเดตการแสดง (การโยกย้าย, การย้าย, ตัวช่วยการเขียนใหม่แบบกำหนดเป้าหมาย)

## การสร้างบริบทใหม่ (`buildSessionContext`)

`buildSessionContext(entries, leafId, byId?)` แก้ไขสิ่งที่จะส่งไปยังโมเดล

อัลกอริทึม:

1. กำหนด leaf:
   - `leafId === null` -> คืนค่าบริบทว่าง
   - `leafId` ที่ระบุชัดเจน -> ใช้รายการนั้นหากพบ
   - มิฉะนั้นใช้รายการสุดท้ายเป็นทางเลือก
2. เดิน parent chain `parentId` จาก leaf ไปยัง root และย้อนกลับเป็นเส้นทาง root->leaf
3. ดึงสถานะรันไทม์ตามเส้นทาง:
   - `thinkingLevel` จาก `thinking_level_change` ล่าสุด (ค่าเริ่มต้น `"off"`)
   - map โมเดลจากรายการ `model_change` (`role ?? "default"`)
   - `models.default` สำรองจาก provider/model ของข้อความ assistant หากไม่มีการเปลี่ยนโมเดลอย่างชัดเจน
   - `injectedTtsrRules` ที่ไม่ซ้ำกันจากรายการ `ttsr_injection` ทั้งหมด
   - mode/modeData จาก `mode_change` ล่าสุด (mode เริ่มต้น `"none"`)
4. สร้างรายการข้อความ:
   - รายการ `message` ส่งผ่านโดยตรง
   - รายการ `custom_message` กลายเป็น AgentMessage แบบ `custom` ผ่าน `createCustomMessage`
   - รายการ `branch_summary` กลายเป็น AgentMessage แบบ `branchSummary` ผ่าน `createBranchSummaryMessage`
   - หากมี `compaction` อยู่บนเส้นทาง:
     - ส่งออก compaction summary ก่อน (`createCompactionSummaryMessage`)
     - ส่งออกรายการเส้นทางเริ่มต้นที่ `firstKeptEntryId` จนถึงขอบเขต compaction
     - ส่งออกรายการหลังขอบเขต compaction

รายการ `custom` และ `session_init` ไม่ inject บริบทโมเดลโดยตรง

## การรับประกันความคงอยู่และโมเดลความล้มเหลว

### Persist เทียบกับในหน่วยความจำ

- `SessionManager.create/open/continueRecent/forkFrom` -> โหมด persistent (`persist = true`)
- `SessionManager.inMemory` -> โหมด non-persistent (`persist = false`) ด้วย `MemorySessionStorage`

### Pipeline การเขียน

การเขียนถูกจัดลำดับผ่าน promise chain ภายใน (`#persistChain`) และ `NdjsonFileWriter`

- `append*` อัปเดตสถานะในหน่วยความจำทันที
- การคงอยู่จะถูกเลื่อนออกไปจนกว่าจะมีข้อความ assistant อย่างน้อยหนึ่งข้อความ
  - ก่อน assistant แรก: รายการถูกเก็บไว้ในหน่วยความจำ ไม่มีการ append ไฟล์เกิดขึ้น
  - เมื่อมี assistant แรก: เซสชันในหน่วยความจำทั้งหมดถูก flush ลงไฟล์
  - หลังจากนั้น: รายการใหม่ถูก append ทีละรายการ

เหตุผลในโค้ด: หลีกเลี่ยงการคงอยู่ของเซสชันที่ไม่เคยสร้างการตอบสนองจาก assistant

### การดำเนินการด้านความทนทาน

- `flush()` flush writer และเรียก `fsync()`
- การเขียนทับทั้งหมดแบบ atomic (`#rewriteFile`) เขียนลงไฟล์ชั่วคราว flush+fsync ปิด แล้ว rename ทับเป้าหมาย
- ใช้สำหรับการโยกย้าย, `setSessionName`, `rewriteEntries`, การย้าย และการเขียนอาร์กิวเมนต์ tool-call ใหม่

### พฤติกรรมข้อผิดพลาด

- ข้อผิดพลาดการคงอยู่ถูกล็อก (`#persistError`) และโยนใหม่ในการดำเนินการถัดไป
- ข้อผิดพลาดแรกถูกบันทึกครั้งเดียวพร้อมบริบทไฟล์เซสชัน
- การปิด writer เป็นแบบ best-effort แต่ส่งต่อข้อผิดพลาดที่มีความหมายแรก

## การควบคุมขนาดข้อมูลและการแยกเก็บ Blob

ก่อนการคงอยู่ของรายการ:

- String ขนาดใหญ่ถูกตัดทอนเป็น `MAX_PERSIST_CHARS` (500,000 ตัวอักษร) พร้อมการแจ้งเตือน:
  - `"[Session persistence truncated large content]"`
- ฟิลด์ชั่วคราว `partialJson` และ `jsonlEvents` ถูกลบออก
- หากออบเจกต์มีทั้ง `content` และ `lineCount` จำนวนบรรทัดจะถูกคำนวณใหม่หลังการตัดทอน
- image block ใน `content` array ที่มีความยาว base64 >= 1024 จะถูกแยกเก็บเป็น blob ref:
  - จัดเก็บเป็น `blob:sha256:<hash>`
  - ไบต์ดิบเขียนลง blob store (`BlobStore.put`)

เมื่อโหลด blob ref จะถูกแก้ไขกลับเป็น base64 สำหรับ image block ของ message/custom_message

## การแยกย่อยการจัดเก็บ

อินเทอร์เฟซ `SessionStorage` จัดเตรียมการดำเนินการ filesystem ทั้งหมดที่ใช้โดย `SessionManager`:

- แบบ sync: `ensureDirSync`, `existsSync`, `writeTextSync`, `statSync`, `listFilesSync`
- แบบ async: `exists`, `readText`, `readTextPrefix`, `writeText`, `rename`, `unlink`, `openWriter`

การนำไปใช้งาน:

- `FileSessionStorage`: filesystem จริง (Bun + node fs)
- `MemorySessionStorage`: การนำไปใช้งานในหน่วยความจำที่สำรองด้วย map สำหรับการทดสอบ/เซสชัน non-persistent

`SessionStorageWriter` เปิดเผย `writeLine`, `flush`, `fsync`, `close`, `getError`

## ยูทิลิตีค้นพบเซสชัน

กำหนดใน `session-manager.ts`:

- `getRecentSessions(sessionDir, limit)` -> metadata ขนาดเบาสำหรับ UI/session picker
- `findMostRecentSession(sessionDir)` -> ใหม่สุดตาม mtime
- `list(cwd, sessionDir?)` -> เซสชันในขอบเขตโปรเจกต์หนึ่ง
- `listAll()` -> เซสชันในทุกขอบเขตโปรเจกต์ภายใต้ `~/.xcsh/agent/sessions`

การดึง metadata อ่านเฉพาะ prefix (`readTextPrefix(..., 4096)`) เมื่อเป็นไปได้

## ที่เกี่ยวข้องแต่แตกต่าง: การจัดเก็บประวัติ Prompt

`HistoryStorage` (`history-storage.ts`) เป็นระบบย่อย SQLite แยกต่างหากสำหรับการเรียกคืนและค้นหา prompt ไม่ใช่การเล่น session ซ้ำ

- DB: `~/.xcsh/agent/history.db`
- ตาราง: `history(id, prompt, created_at, cwd)`
- ดัชนี FTS5: `history_fts` พร้อม sync ที่ดูแลโดย trigger
- กำจัดรายการซ้ำของ prompt ที่เหมือนกันติดต่อกันโดยใช้แคช last-prompt ในหน่วยความจำ
- การแทรกแบบ async (`setImmediate`) เพื่อให้การบันทึก prompt ไม่บล็อกการดำเนินการของรอบ

ใช้ไฟล์เซสชันสำหรับการเล่นซ้ำกราฟการสนทนา/สถานะ ใช้ `HistoryStorage` สำหรับ UX ประวัติ prompt
