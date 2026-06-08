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

เอกสารนี้เป็นแหล่งข้อมูลอ้างอิงหลักสำหรับวิธีที่เซสชัน coding-agent ถูกแสดง จัดเก็บ ย้ายข้อมูล และสร้างขึ้นใหม่ในขณะรันไทม์

## ขอบเขต

ครอบคลุม:

- รูปแบบ JSONL ของเซสชันและการกำหนดเวอร์ชัน
- อนุกรมวิธานของรายการและความหมายของโครงสร้างต้นไม้ (`id`/`parentId` + ตัวชี้ leaf)
- พฤติกรรมการย้ายข้อมูล/ความเข้ากันได้เมื่อโหลดไฟล์เก่าหรือไฟล์ที่มีรูปแบบไม่ถูกต้อง
- การสร้างบริบทขึ้นใหม่ (`buildSessionContext`)
- การรับประกันการจัดเก็บถาวร พฤติกรรมเมื่อเกิดข้อผิดพลาด การตัดทอน/การแยกเก็บ blob ภายนอก
- การแยกระดับชั้นของการจัดเก็บ (`FileSessionStorage`, `MemorySessionStorage`) และยูทิลิตี้ที่เกี่ยวข้อง

ไม่ครอบคลุมพฤติกรรมการแสดงผล UI ของ `/tree` นอกเหนือจากความหมายที่ส่งผลต่อข้อมูลเซสชัน

## ไฟล์การนำไปใช้

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

`<cwd-encoded>` ได้มาจากไดเรกทอรีทำงานโดยตัดเครื่องหมาย slash นำหน้าออกและแทนที่ `/`, `\\` และ `:` ด้วย `-`

ตำแหน่ง blob store:

```text
~/.xcsh/agent/blobs/<sha256>
```

ไฟล์ breadcrumb ของเทอร์มินัลถูกเขียนภายใต้:

```text
~/.xcsh/agent/terminal-sessions/<terminal-id>
```

เนื้อหา breadcrumb มีสองบรรทัด: cwd ดั้งเดิม ตามด้วยเส้นทางไฟล์เซสชัน `continueRecent()` จะใช้ตัวชี้ที่กำหนดขอบเขตตามเทอร์มินัลนี้ก่อนแล้วจึงค้นหา mtime ล่าสุด

## รูปแบบไฟล์

ไฟล์เซสชันเป็น JSONL: หนึ่งออบเจ็กต์ JSON ต่อหนึ่งบรรทัด

- บรรทัดที่ 1 เป็นส่วนหัวของเซสชันเสมอ (`type: "session"`)
- บรรทัดที่เหลือเป็นค่า `SessionEntry`
- รายการเป็นแบบ append-only ในขณะรันไทม์; การนำทาง branch จะย้ายตัวชี้ (`leafId`) แทนที่จะแก้ไขรายการที่มีอยู่

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

- `version` เป็นค่าเสริมในไฟล์ v1; การไม่มีค่าหมายถึง v1
- `parentSession` เป็นสตริงลำดับสืบทอดแบบทึบ โค้ดปัจจุบันเขียนเป็น session id หรือเส้นทางเซสชันขึ้นอยู่กับลำดับขั้นตอน (`fork`, `forkFrom`, `createBranchedSession` หรือ `newSession({ parentSession })` แบบชัดเจน) ถือว่าเป็นเมทาดาตา ไม่ใช่ foreign key ที่มีชนิดข้อมูลกำหนด

### ฐานของรายการ (`SessionEntryBase`)

รายการที่ไม่ใช่ส่วนหัวทั้งหมดประกอบด้วย:

```json
{
  "type": "...",
  "id": "8-char-id",
  "parentId": "previous-or-branch-parent",
  "timestamp": "2026-02-16T10:20:30.000Z"
}
```

`parentId` สามารถเป็น `null` สำหรับรายการรูท (การเพิ่มครั้งแรก หรือหลังจาก `resetLeaf()`)

## อนุกรมวิธานของรายการ

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

`role` เป็นค่าเสริม; หากไม่มีจะถือว่าเป็น `default` ในการสร้างบริบทขึ้นใหม่

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

หากแยก branch จากรูท (`branchFromId === null`) ค่า `fromId` จะเป็นสตริงตัวอักษร `"root"`

### `custom`

การจัดเก็บสถานะของส่วนขยาย; ถูกละเว้นโดย `buildSessionContext`

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

ข้อความที่จัดหาโดยส่วนขยายซึ่งมีส่วนร่วมในบริบท LLM

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

ใช้เมื่อส่วนหัว `version` ไม่มีค่าหรือ `< 2`:

- เพิ่ม `id` และ `parentId` ให้กับรายการที่ไม่ใช่ส่วนหัวแต่ละรายการ
- สร้างห่วงโซ่ parent แบบเส้นตรงขึ้นใหม่โดยใช้ลำดับของไฟล์
- ย้ายข้อมูลฟิลด์ compaction `firstKeptEntryIndex` -> `firstKeptEntryId` เมื่อมีอยู่
- ตั้งค่าส่วนหัว `version = 2`

### v2 -> v3

ใช้เมื่อส่วนหัว `version < 3`:

- สำหรับรายการ `message`: เขียนใหม่ `message.role === "hookMessage"` แบบเก่าเป็น `"custom"`
- ตั้งค่าส่วนหัว `version = 3`

### ทริกเกอร์การย้ายข้อมูลและการจัดเก็บถาวร

- การย้ายข้อมูลทำงานระหว่างการโหลดเซสชัน (`setSessionFile`)
- หากมีการย้ายข้อมูลใดๆ ทำงาน ไฟล์ทั้งหมดจะถูกเขียนใหม่ลงดิสก์ทันที
- การย้ายข้อมูลจะแก้ไขรายการในหน่วยความจำก่อน จากนั้นจึงจัดเก็บ JSONL ที่เขียนใหม่

## พฤติกรรมการโหลดและความเข้ากันได้

พฤติกรรมของ `loadEntriesFromFile(path)`:

- ไฟล์ที่หายไป (`ENOENT`) -> คืนค่า `[]`
- บรรทัดที่แยกวิเคราะห์ไม่ได้จะถูกจัดการโดย JSONL parser แบบผ่อนปรน (`parseJsonlLenient`)
- หากรายการที่แยกวิเคราะห์ได้รายการแรกไม่ใช่ส่วนหัวเซสชันที่ถูกต้อง (`type !== "session"` หรือไม่มีสตริง `id`) -> คืนค่า `[]`

พฤติกรรมของ `SessionManager.setSessionFile()`:

- `[]` จากตัวโหลดจะถูกถือว่าเป็นเซสชันว่าง/ไม่มีอยู่ และถูกแทนที่ด้วยไฟล์เซสชันที่เริ่มต้นใหม่ที่เส้นทางนั้น
- ไฟล์ที่ถูกต้องจะถูกโหลด ย้ายข้อมูลหากจำเป็น แก้ไข blob refs จากนั้นทำดัชนี

## ความหมายของต้นไม้และ Leaf

โมเดลพื้นฐานเป็นต้นไม้แบบ append-only + ตัวชี้ leaf ที่เปลี่ยนแปลงได้:

- ทุกเมธอด append จะสร้างรายการใหม่เพียงหนึ่งรายการที่มี `parentId` เป็น `leafId` ปัจจุบัน
- รายการใหม่จะกลายเป็น `leafId` ใหม่
- `branch(entryId)` ย้ายเฉพาะ `leafId`; รายการที่มีอยู่ยังคงไม่เปลี่ยนแปลง
- `resetLeaf()` ตั้งค่า `leafId = null`; การ append ถัดไปจะสร้างรายการรูทใหม่ (`parentId: null`)
- `branchWithSummary()` ตั้งค่า leaf เป็นเป้าหมาย branch และเพิ่มรายการ `branch_summary`

`getEntries()` คืนค่ารายการที่ไม่ใช่ส่วนหัวทั้งหมดตามลำดับการแทรก รายการที่มีอยู่จะไม่ถูกลบในการทำงานปกติ; การเขียนใหม่จะรักษาประวัติเชิงตรรกะในขณะที่อัปเดตการแสดงผล (การย้ายข้อมูล การย้าย ตัวช่วยการเขียนใหม่แบบกำหนดเป้าหมาย)

## การสร้างบริบทขึ้นใหม่ (`buildSessionContext`)

`buildSessionContext(entries, leafId, byId?)` กำหนดสิ่งที่ถูกส่งไปยังโมเดล

อัลกอริทึม:

1. กำหนด leaf:
   - `leafId === null` -> คืนค่าบริบทว่าง
   - `leafId` ที่ระบุชัดเจน -> ใช้รายการนั้นหากพบ
   - มิฉะนั้น fallback ไปยังรายการสุดท้าย
2. เดินตามห่วงโซ่ `parentId` จาก leaf ไปยังรูทแล้วกลับลำดับเป็นเส้นทางรูท->leaf
3. สรุปสถานะรันไทม์ตลอดเส้นทาง:
   - `thinkingLevel` จาก `thinking_level_change` ล่าสุด (ค่าเริ่มต้น `"off"`)
   - แผนที่โมเดลจากรายการ `model_change` (`role ?? "default"`)
   - `models.default` สำรองจาก provider/model ของข้อความ assistant หากไม่มีการเปลี่ยนโมเดลอย่างชัดเจน
   - `injectedTtsrRules` ที่ไม่ซ้ำจากรายการ `ttsr_injection` ทั้งหมด
   - mode/modeData จาก `mode_change` ล่าสุด (โหมดเริ่มต้น `"none"`)
4. สร้างรายการข้อความ:
   - รายการ `message` ส่งผ่านโดยตรง
   - รายการ `custom_message` กลายเป็น `custom` AgentMessages ผ่าน `createCustomMessage`
   - รายการ `branch_summary` กลายเป็น `branchSummary` AgentMessages ผ่าน `createBranchSummaryMessage`
   - หากมี `compaction` อยู่บนเส้นทาง:
     - ส่งสรุป compaction ก่อน (`createCompactionSummaryMessage`)
     - ส่งรายการเส้นทางเริ่มจาก `firstKeptEntryId` จนถึงขอบเขต compaction
     - ส่งรายการหลังขอบเขต compaction

รายการ `custom` และ `session_init` ไม่ได้ส่งบริบทโมเดลโดยตรง

## การรับประกันการจัดเก็บถาวรและโมเดลข้อผิดพลาด

### การจัดเก็บถาวร vs ในหน่วยความจำ

- `SessionManager.create/open/continueRecent/forkFrom` -> โหมดจัดเก็บถาวร (`persist = true`)
- `SessionManager.inMemory` -> โหมดไม่จัดเก็บถาวร (`persist = false`) กับ `MemorySessionStorage`

### ไปป์ไลน์การเขียน

การเขียนถูกจัดลำดับผ่านห่วงโซ่ promise ภายใน (`#persistChain`) และ `NdjsonFileWriter`

- `append*` อัปเดตสถานะในหน่วยความจำทันที
- การจัดเก็บถาวรถูกเลื่อนออกไปจนกว่าจะมีข้อความ assistant อย่างน้อยหนึ่งรายการ
  - ก่อน assistant แรก: รายการถูกเก็บไว้ในหน่วยความจำ; ไม่มีการเพิ่มลงไฟล์
  - เมื่อมี assistant แรก: เซสชันในหน่วยความจำทั้งหมดถูกเขียนลงไฟล์
  - หลังจากนั้น: รายการใหม่จะเพิ่มแบบ incremental

เหตุผลในโค้ด: หลีกเลี่ยงการจัดเก็บถาวรเซสชันที่ไม่เคยสร้างการตอบกลับจาก assistant

### การดำเนินการด้านความทนทาน

- `flush()` เขียน writer ออกและเรียก `fsync()`
- การเขียนใหม่ทั้งหมดแบบ atomic (`#rewriteFile`) เขียนลงไฟล์ชั่วคราว flush+fsync ปิด จากนั้นเปลี่ยนชื่อทับเป้าหมาย
- ใช้สำหรับการย้ายข้อมูล `setSessionName` `rewriteEntries` การดำเนินการย้าย และการเขียนใหม่ tool-call arg

### พฤติกรรมข้อผิดพลาด

- ข้อผิดพลาดการจัดเก็บถาวรถูกล็อค (`#persistError`) และถูกโยนซ้ำในการดำเนินการถัดไป
- ข้อผิดพลาดแรกจะถูกบันทึกหนึ่งครั้งพร้อมบริบทไฟล์เซสชัน
- การปิด writer เป็นแบบ best-effort แต่จะส่งต่อข้อผิดพลาดที่มีความหมายรายการแรก

## การควบคุมขนาดข้อมูลและการแยกเก็บ Blob ภายนอก

ก่อนจัดเก็บรายการอย่างถาวร:

- สตริงขนาดใหญ่จะถูกตัดทอนเป็น `MAX_PERSIST_CHARS` (500,000 อักขระ) พร้อมหมายเหตุ:
  - `"[Session persistence truncated large content]"`
- ฟิลด์ชั่วคราว `partialJson` และ `jsonlEvents` จะถูกลบออก
- หากออบเจ็กต์มีทั้ง `content` และ `lineCount` จำนวนบรรทัดจะถูกคำนวณใหม่หลังการตัดทอน
- บล็อกรูปภาพในอาร์เรย์ `content` ที่มีความยาว base64 >= 1024 จะถูกแยกเก็บเป็น blob refs:
  - จัดเก็บเป็น `blob:sha256:<hash>`
  - ไบต์ดิบถูกเขียนลง blob store (`BlobStore.put`)

เมื่อโหลด blob refs จะถูกแก้ไขกลับเป็น base64 สำหรับบล็อกรูปภาพของ message/custom_message

## การแยกระดับชั้นของการจัดเก็บ

อินเทอร์เฟซ `SessionStorage` จัดหาการดำเนินการระบบไฟล์ทั้งหมดที่ `SessionManager` ใช้:

- sync: `ensureDirSync`, `existsSync`, `writeTextSync`, `statSync`, `listFilesSync`
- async: `exists`, `readText`, `readTextPrefix`, `writeText`, `rename`, `unlink`, `openWriter`

การนำไปใช้:

- `FileSessionStorage`: ระบบไฟล์จริง (Bun + node fs)
- `MemorySessionStorage`: การนำไปใช้ในหน่วยความจำแบบ map-backed สำหรับการทดสอบ/เซสชันที่ไม่จัดเก็บถาวร

`SessionStorageWriter` เปิดเผย `writeLine`, `flush`, `fsync`, `close`, `getError`

## ยูทิลิตี้การค้นหาเซสชัน

กำหนดไว้ใน `session-manager.ts`:

- `getRecentSessions(sessionDir, limit)` -> เมทาดาตาน้ำหนักเบาสำหรับ UI/ตัวเลือกเซสชัน
- `findMostRecentSession(sessionDir)` -> ใหม่สุดตาม mtime
- `list(cwd, sessionDir?)` -> เซสชันในขอบเขตโปรเจกต์เดียว
- `listAll()` -> เซสชันในทุกขอบเขตโปรเจกต์ภายใต้ `~/.xcsh/agent/sessions`

การดึงเมทาดาตาอ่านเฉพาะส่วนนำหน้า (`readTextPrefix(..., 4096)`) เมื่อเป็นไปได้

## ที่เกี่ยวข้องแต่แยกกัน: การจัดเก็บประวัติ Prompt

`HistoryStorage` (`history-storage.ts`) เป็นระบบย่อย SQLite แยกต่างหากสำหรับการเรียกคืน/ค้นหา prompt ไม่ใช่การเล่นซ้ำเซสชัน

- DB: `~/.xcsh/agent/history.db`
- ตาราง: `history(id, prompt, created_at, cwd)`
- ดัชนี FTS5: `history_fts` พร้อมการซิงค์ที่ดูแลโดยทริกเกอร์
- กำจัดซ้ำของ prompt ที่เหมือนกันติดต่อกันโดยใช้แคช last-prompt ในหน่วยความจำ
- การแทรกแบบ async (`setImmediate`) เพื่อให้การจับ prompt ไม่บล็อกการทำงานของเทิร์น

ใช้ไฟล์เซสชันสำหรับกราฟการสนทนา/การเล่นซ้ำสถานะ; ใช้ `HistoryStorage` สำหรับ UX ประวัติ prompt
