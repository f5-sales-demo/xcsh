---
title: โมเดลการจัดเก็บเซสชันและรายการ
description: >-
  โมเดลการจัดเก็บเซสชันแบบ append-only พร้อมประเภทรายการ การคงอยู่ของข้อมูล
  และการย้ายข้ามรูปแบบต่างๆ
sidebar:
  order: 1
  label: โมเดลการจัดเก็บและรายการ
i18n:
  sourceHash: 42fe17549e00
  translator: machine
---

# โมเดลการจัดเก็บเซสชันและรายการ

เอกสารนี้เป็นแหล่งข้อมูลที่เชื่อถือได้สำหรับวิธีการแสดง จัดเก็บ ย้าย และสร้างเซสชัน coding-agent ขึ้นมาใหม่ในขณะรันไทม์

## ขอบเขต

ครอบคลุม:

- รูปแบบ JSONL ของเซสชันและการกำหนดเวอร์ชัน
- อนุกรมวิธานรายการและความหมายของโครงสร้างต้นไม้ (`id`/`parentId` + ตัวชี้ใบไม้)
- พฤติกรรมการย้าย/ความเข้ากันได้เมื่อโหลดไฟล์เก่าหรือไฟล์ที่มีรูปแบบผิดพลาด
- การสร้างบริบทขึ้นมาใหม่ (`buildSessionContext`)
- การรับประกันการคงอยู่ พฤติกรรมเมื่อเกิดความล้มเหลว การตัดทอน/การแยกเก็บ blob ภายนอก
- นามธรรมของการจัดเก็บ (`FileSessionStorage`, `MemorySessionStorage`) และยูทิลิตี้ที่เกี่ยวข้อง

ไม่ครอบคลุมพฤติกรรมการแสดงผล UI `/tree` นอกเหนือจากความหมายที่ส่งผลต่อข้อมูลเซสชัน

## ไฟล์การนำไปใช้งาน

- [`src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`src/session/messages.ts`](../../packages/coding-agent/src/session/messages.ts)
- [`src/session/session-storage.ts`](../../packages/coding-agent/src/session/session-storage.ts)
- [`src/session/history-storage.ts`](../../packages/coding-agent/src/session/history-storage.ts)
- [`src/session/blob-store.ts`](../../packages/coding-agent/src/session/blob-store.ts)

## โครงสร้างไฟล์บนดิสก์

ตำแหน่งไฟล์เซสชันเริ่มต้น:

```text
~/.xcsh/agent/sessions/--<cwd-encoded>--/<timestamp>_<sessionId>.jsonl
```

`<cwd-encoded>` ได้มาจากไดเรกทอรีการทำงานโดยตัดเครื่องหมายทับนำหน้าออกและแทนที่ `/`, `\\`, และ `:` ด้วย `-`

ตำแหน่ง blob store:

```text
~/.xcsh/agent/blobs/<sha256>
```

ไฟล์ breadcrumb ของเทอร์มินัลจะถูกเขียนไว้ที่:

```text
~/.xcsh/agent/terminal-sessions/<terminal-id>
```

เนื้อหา breadcrumb มีสองบรรทัด: cwd เดิม จากนั้นเป็นเส้นทางไฟล์เซสชัน `continueRecent()` จะให้ความสำคัญกับตัวชี้ขอบเขตเทอร์มินัลนี้ก่อนการสแกน mtime ล่าสุด

## รูปแบบไฟล์

ไฟล์เซสชันเป็น JSONL: หนึ่งออบเจกต์ JSON ต่อหนึ่งบรรทัด

- บรรทัดที่ 1 จะเป็น session header เสมอ (`type: "session"`)
- บรรทัดที่เหลือเป็นค่า `SessionEntry`
- รายการเป็นแบบ append-only ในขณะรันไทม์ การนำทางสาขาจะย้ายตัวชี้ (`leafId`) แทนที่จะแก้ไขรายการที่มีอยู่

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

- `version` เป็นตัวเลือกในไฟล์ v1 หากไม่มีหมายความว่าเป็น v1
- `parentSession` เป็นสตริงสายวงศ์ที่ไม่โปร่งใส โค้ดปัจจุบันเขียนทั้ง session id หรือเส้นทางเซสชันขึ้นอยู่กับกระบวนการ (`fork`, `forkFrom`, `createBranchedSession`, หรือ `newSession({ parentSession })` ที่ระบุชัดเจน) ถือเป็นข้อมูล metadata ไม่ใช่ foreign key ที่มีประเภทกำหนด

### ฐาน Entry (`SessionEntryBase`)

รายการที่ไม่ใช่ header ทั้งหมดรวมถึง:

```json
{
  "type": "...",
  "id": "8-char-id",
  "parentId": "previous-or-branch-parent",
  "timestamp": "2026-02-16T10:20:30.000Z"
}
```

`parentId` สามารถเป็น `null` สำหรับรายการรากได้ (การ append ครั้งแรก หรือหลังจาก `resetLeaf()`)

## อนุกรมวิธานรายการ

`SessionEntry` คือ union ของ:

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

`role` เป็นตัวเลือก หากไม่มีจะถูกถือว่าเป็น `default` ในการสร้างบริบทขึ้นมาใหม่

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

การคงอยู่ของสถานะส่วนขยาย ถูกละเว้นโดย `buildSessionContext`

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

ข้อความที่ส่วนขยายจัดเตรียมซึ่งเข้าร่วมในบริบท LLM

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

`label: undefined` จะล้าง label สำหรับ `targetId`

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

## การกำหนดเวอร์ชันและการย้าย

เวอร์ชันเซสชันปัจจุบัน: `3`

### v1 -> v2

ใช้เมื่อ header `version` ขาดหายหรือ `< 2`:

- เพิ่ม `id` และ `parentId` ให้กับแต่ละรายการที่ไม่ใช่ header
- สร้างห่วงโซ่ parent เชิงเส้นขึ้นใหม่โดยใช้ลำดับไฟล์
- ย้ายฟิลด์ compaction `firstKeptEntryIndex` -> `firstKeptEntryId` เมื่อมีอยู่
- กำหนด header `version = 2`

### v2 -> v3

ใช้เมื่อ header `version < 3`:

- สำหรับรายการ `message`: เขียน `message.role === "hookMessage"` แบบเดิมใหม่เป็น `"custom"`
- กำหนด header `version = 3`

### การเรียกใช้การย้ายและการคงอยู่

- การย้ายจะทำงานระหว่างการโหลดเซสชัน (`setSessionFile`)
- หากมีการย้ายใดๆ เกิดขึ้น ไฟล์ทั้งหมดจะถูกเขียนใหม่ลงดิสก์ทันที
- การย้ายจะแก้ไขรายการในหน่วยความจำก่อน จากนั้นจึงคงไว้ซึ่ง JSONL ที่เขียนใหม่

## พฤติกรรมการโหลดและความเข้ากันได้

พฤติกรรมของ `loadEntriesFromFile(path)`:

- ไม่พบไฟล์ (`ENOENT`) -> คืนค่า `[]`
- บรรทัดที่ไม่สามารถแยกวิเคราะห์ได้จะถูกจัดการโดย lenient JSONL parser (`parseJsonlLenient`)
- หากรายการที่แยกวิเคราะห์ครั้งแรกไม่ใช่ session header ที่ถูกต้อง (`type !== "session"` หรือ `id` สตริงหายไป) -> คืนค่า `[]`

พฤติกรรมของ `SessionManager.setSessionFile()`:

- `[]` จาก loader ถูกถือว่าเป็นเซสชันว่างเปล่า/ไม่มีอยู่และถูกแทนที่ด้วยไฟล์เซสชันที่เริ่มต้นใหม่ในเส้นทางนั้น
- ไฟล์ที่ถูกต้องจะถูกโหลด ย้ายหากจำเป็น แก้ไข blob refs จากนั้นจึงจัดทำดัชนี

## ความหมายของต้นไม้และใบไม้

โมเดลพื้นฐานเป็นต้นไม้แบบ append-only + ตัวชี้ใบไม้ที่เปลี่ยนแปลงได้:

- ทุกวิธี append จะสร้างรายการใหม่หนึ่งรายการซึ่ง `parentId` คือ `leafId` ปัจจุบัน
- รายการใหม่จะกลายเป็น `leafId` ใหม่
- `branch(entryId)` จะย้ายเฉพาะ `leafId` เท่านั้น รายการที่มีอยู่จะไม่เปลี่ยนแปลง
- `resetLeaf()` กำหนด `leafId = null` การ append ครั้งถัดไปจะสร้างรายการรากใหม่ (`parentId: null`)
- `branchWithSummary()` กำหนด leaf ไปยังเป้าหมายสาขาและ append รายการ `branch_summary`

`getEntries()` คืนค่ารายการที่ไม่ใช่ header ทั้งหมดตามลำดับการแทรก รายการที่มีอยู่จะไม่ถูกลบในการดำเนินการปกติ การเขียนใหม่จะรักษาประวัติทางตรรกะไว้ในขณะที่อัปเดตการแสดงแทน (การย้าย การย้ายตำแหน่ง ผู้ช่วยเขียนใหม่แบบกำหนดเป้าหมาย)

## การสร้างบริบทขึ้นมาใหม่ (`buildSessionContext`)

`buildSessionContext(entries, leafId, byId?)` แก้ไขสิ่งที่ส่งไปยังโมเดล

อัลกอริทึม:

1. กำหนด leaf:
   - `leafId === null` -> คืนค่าบริบทว่าง
   - `leafId` ที่ระบุชัดเจน -> ใช้รายการนั้นหากพบ
   - มิฉะนั้นให้ fallback ไปยังรายการสุดท้าย
2. เดิน `parentId` chain จาก leaf ไปยัง root และย้อนกลับเป็นเส้นทาง root->leaf
3. ดึงสถานะรันไทม์ตลอดเส้นทาง:
   - `thinkingLevel` จาก `thinking_level_change` ล่าสุด (ค่าเริ่มต้น `"off"`)
   - แผนที่โมเดลจากรายการ `model_change` (`role ?? "default"`)
   - fallback `models.default` จาก provider/model ของข้อความ assistant หากไม่มีการเปลี่ยนโมเดลอย่างชัดเจน
   - `injectedTtsrRules` ที่ไม่ซ้ำกันจากรายการ `ttsr_injection` ทั้งหมด
   - mode/modeData จาก `mode_change` ล่าสุด (mode เริ่มต้น `"none"`)
4. สร้างรายการข้อความ:
   - รายการ `message` จะผ่านไปโดยตรง
   - รายการ `custom_message` จะกลายเป็น `custom` AgentMessages ผ่าน `createCustomMessage`
   - รายการ `branch_summary` จะกลายเป็น `branchSummary` AgentMessages ผ่าน `createBranchSummaryMessage`
   - หากมี `compaction` อยู่บนเส้นทาง:
     - ส่งออก compaction summary ก่อน (`createCompactionSummaryMessage`)
     - ส่งออกรายการเส้นทางที่เริ่มต้นที่ `firstKeptEntryId` ไปจนถึงขอบเขต compaction
     - ส่งออกรายการหลังขอบเขต compaction

รายการ `custom` และ `session_init` จะไม่แทรกบริบทโมเดลโดยตรง

## การรับประกันการคงอยู่และโมเดลความล้มเหลว

### การคงอยู่เทียบกับในหน่วยความจำ

- `SessionManager.create/open/continueRecent/forkFrom` -> โหมดคงอยู่ (`persist = true`)
- `SessionManager.inMemory` -> โหมดไม่คงอยู่ (`persist = false`) พร้อม `MemorySessionStorage`

### ไปป์ไลน์การเขียน

การเขียนจะถูกดำเนินการตามลำดับผ่าน promise chain ภายใน (`#persistChain`) และ `NdjsonFileWriter`

- `append*` อัปเดตสถานะในหน่วยความจำทันที
- การคงอยู่จะถูกเลื่อนออกไปจนกว่าจะมีข้อความ assistant อย่างน้อยหนึ่งข้อความ
  - ก่อนข้อความ assistant แรก: รายการจะถูกเก็บไว้ในหน่วยความจำ ไม่มีการ append ไฟล์เกิดขึ้น
  - เมื่อมี assistant แรกแล้ว: เซสชันในหน่วยความจำทั้งหมดจะถูกส่งออกไปยังไฟล์
  - หลังจากนั้น: รายการใหม่จะถูก append แบบเพิ่มทีละน้อย

เหตุผลในโค้ด: หลีกเลี่ยงการคงเซสชันที่ไม่เคยสร้างการตอบสนอง assistant

### การดำเนินการด้านความทนทาน

- `flush()` ส่งออก writer และเรียก `fsync()`
- การเขียนใหม่แบบ atomic เต็มรูปแบบ (`#rewriteFile`) เขียนไปยังไฟล์ชั่วคราว flush+fsync ปิด จากนั้น rename ทับเป้าหมาย
- ใช้สำหรับการย้าย `setSessionName` `rewriteEntries` การดำเนินการย้าย และการเขียน tool-call arg ใหม่

### พฤติกรรมเมื่อเกิดข้อผิดพลาด

- ข้อผิดพลาดการคงอยู่จะถูกบันทึกไว้ (`#persistError`) และ rethrow ในการดำเนินการถัดไป
- ข้อผิดพลาดแรกจะถูก log ครั้งเดียวพร้อมบริบทไฟล์เซสชัน
- การปิด writer จะใช้ความพยายามอย่างดีที่สุดแต่จะส่งต่อข้อผิดพลาดที่มีความหมายแรก

## การควบคุมขนาดข้อมูลและการแยกเก็บ Blob ภายนอก

ก่อนการคงรายการ:

- สตริงขนาดใหญ่จะถูกตัดทอนให้เหลือ `MAX_PERSIST_CHARS` (500,000 chars) พร้อมประกาศ:
  - `"[Session persistence truncated large content]"`
- ฟิลด์ชั่วคราว `partialJson` และ `jsonlEvents` จะถูกลบออก
- หากออบเจกต์มีทั้ง `content` และ `lineCount` จำนวนบรรทัดจะถูกคำนวณใหม่หลังการตัดทอน
- บล็อกรูปภาพใน `content` arrays ที่มีความยาว base64 >= 1024 จะถูกแยกเก็บภายนอกเป็น blob refs:
  - จัดเก็บเป็น `blob:sha256:<hash>`
  - เขียน raw bytes ไปยัง blob store (`BlobStore.put`)

เมื่อโหลด blob refs จะถูกแก้ไขกลับเป็น base64 สำหรับบล็อกรูปภาพ message/custom_message

## นามธรรมของการจัดเก็บ

อินเทอร์เฟซ `SessionStorage` ให้การดำเนินการระบบไฟล์ทั้งหมดที่ `SessionManager` ใช้:

- sync: `ensureDirSync`, `existsSync`, `writeTextSync`, `statSync`, `listFilesSync`
- async: `exists`, `readText`, `readTextPrefix`, `writeText`, `rename`, `unlink`, `openWriter`

การนำไปใช้งาน:

- `FileSessionStorage`: ระบบไฟล์จริง (Bun + node fs)
- `MemorySessionStorage`: การนำไปใช้งานในหน่วยความจำแบบ map สำหรับการทดสอบ/เซสชันที่ไม่คงอยู่

`SessionStorageWriter` เปิดเผย `writeLine`, `flush`, `fsync`, `close`, `getError`

## ยูทิลิตี้การค้นหาเซสชัน

กำหนดไว้ใน `session-manager.ts`:

- `getRecentSessions(sessionDir, limit)` -> metadata แบบเบาสำหรับ UI/session picker
- `findMostRecentSession(sessionDir)` -> ใหม่ที่สุดตาม mtime
- `list(cwd, sessionDir?)` -> เซสชันในขอบเขตโปรเจกต์หนึ่ง
- `listAll()` -> เซสชันในทุกขอบเขตโปรเจกต์ภายใต้ `~/.xcsh/agent/sessions`

การดึง metadata จะอ่านเฉพาะส่วนนำหน้า (`readTextPrefix(..., 4096)`) เมื่อเป็นไปได้

## ที่เกี่ยวข้องแต่แตกต่าง: การจัดเก็บประวัติ Prompt

`HistoryStorage` (`history-storage.ts`) เป็นระบบย่อย SQLite แยกต่างหากสำหรับการเรียกคืน/ค้นหา prompt ไม่ใช่การ replay เซสชัน

- DB: `~/.xcsh/agent/history.db`
- Table: `history(id, prompt, created_at, cwd)`
- FTS5 index: `history_fts` พร้อม trigger-maintained sync
- ลบ prompt ที่เหมือนกันติดต่อกันโดยใช้ in-memory last-prompt cache
- การแทรกแบบ async (`setImmediate`) เพื่อให้การจับ prompt ไม่บล็อกการดำเนินการ turn

ใช้ไฟล์เซสชันสำหรับ conversation graph/state replay ใช้ `HistoryStorage` สำหรับ UX ประวัติ prompt
