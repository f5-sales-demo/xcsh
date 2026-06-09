---
title: การจัดเก็บเซสชันและโมเดลรายการ
description: >-
  โมเดลการจัดเก็บเซสชันแบบ append-only พร้อมประเภทรายการ การคงอยู่ของข้อมูล
  และการย้ายข้อมูลระหว่างรูปแบบต่างๆ
sidebar:
  order: 1
  label: การจัดเก็บและโมเดลรายการ
i18n:
  sourceHash: 42fe17549e00
  translator: machine
---

# การจัดเก็บเซสชันและโมเดลรายการ

เอกสารนี้เป็นแหล่งข้อมูลอ้างอิงหลักสำหรับวิธีที่เซสชันของ coding-agent ถูกแสดง จัดเก็บ ย้ายข้อมูล และสร้างขึ้นใหม่ในขณะรันไทม์

## ขอบเขต

ครอบคลุม:

- รูปแบบ JSONL ของเซสชันและการกำหนดเวอร์ชัน
- อนุกรมวิธานของรายการและความหมายของโครงสร้างต้นไม้ (`id`/`parentId` + leaf pointer)
- พฤติกรรมการย้ายข้อมูล/ความเข้ากันได้เมื่อโหลดไฟล์เก่าหรือไฟล์ที่ผิดรูปแบบ
- การสร้างบริบทขึ้นใหม่ (`buildSessionContext`)
- การรับประกันการคงอยู่ของข้อมูล พฤติกรรมเมื่อเกิดข้อผิดพลาด การตัดทอน/การจัดเก็บ blob ภายนอก
- การแยกส่วนของการจัดเก็บ (`FileSessionStorage`, `MemorySessionStorage`) และยูทิลิตี้ที่เกี่ยวข้อง

ไม่ครอบคลุมพฤติกรรมการแสดงผล UI ของ `/tree` นอกเหนือจากความหมายที่ส่งผลต่อข้อมูลเซสชัน

## ไฟล์การใช้งาน

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

`<cwd-encoded>` ถูกสร้างจากไดเรกทอรีทำงานโดยการตัดเครื่องหมาย slash นำหน้าและแทนที่ `/`, `\\`, และ `:` ด้วย `-`

ตำแหน่ง blob store:

```text
~/.xcsh/agent/blobs/<sha256>
```

ไฟล์ breadcrumb ของเทอร์มินัลจะถูกเขียนภายใต้:

```text
~/.xcsh/agent/terminal-sessions/<terminal-id>
```

เนื้อหา breadcrumb ประกอบด้วยสองบรรทัด: cwd ดั้งเดิม ตามด้วยพาธของไฟล์เซสชัน `continueRecent()` จะใช้ตัวชี้ที่กำหนดขอบเขตตามเทอร์มินัลนี้ก่อนที่จะสแกนหา mtime ล่าสุด

## รูปแบบไฟล์

ไฟล์เซสชันเป็น JSONL: หนึ่ง JSON object ต่อหนึ่งบรรทัด

- บรรทัดที่ 1 จะเป็น session header เสมอ (`type: "session"`)
- บรรทัดที่เหลือเป็นค่า `SessionEntry`
- รายการเป็นแบบ append-only ในขณะรันไทม์ การนำทางสาขาจะเลื่อนตัวชี้ (`leafId`) แทนที่จะแก้ไขรายการที่มีอยู่

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

- `version` เป็นค่าที่ไม่จำเป็นในไฟล์ v1; การไม่มีค่าหมายถึง v1
- `parentSession` เป็นสตริงสายวงศ์แบบ opaque โค้ดปัจจุบันจะเขียน session id หรือ session path ขึ้นอยู่กับกระแสการทำงาน (`fork`, `forkFrom`, `createBranchedSession`, หรือ `newSession({ parentSession })` แบบชัดเจน) ให้ถือเป็นข้อมูลเมตา ไม่ใช่ foreign key ที่มีประเภทกำหนด

### ฐานรายการ (`SessionEntryBase`)

รายการที่ไม่ใช่ส่วนหัวทั้งหมดจะมี:

```json
{
  "type": "...",
  "id": "8-char-id",
  "parentId": "previous-or-branch-parent",
  "timestamp": "2026-02-16T10:20:30.000Z"
}
```

`parentId` สามารถเป็น `null` สำหรับรายการราก (การ append ครั้งแรก หรือหลังจาก `resetLeaf()`)

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

`role` เป็นค่าที่ไม่จำเป็น; การไม่มีค่าจะถูกถือว่าเป็น `default` ในการสร้างบริบทขึ้นใหม่

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

หากแยกสาขาจากราก (`branchFromId === null`), `fromId` จะเป็นสตริงตรงตัว `"root"`

### `custom`

การคงอยู่ของสถานะส่วนขยาย; ถูกละเว้นโดย `buildSessionContext`

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

ข้อความที่จัดเตรียมโดยส่วนขยายซึ่งเข้าร่วมในบริบท LLM

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

## การกำหนดเวอร์ชันและการย้ายข้อมูล

เวอร์ชันเซสชันปัจจุบัน: `3`

### v1 -> v2

ถูกใช้เมื่อ `version` ของส่วนหัวหายไปหรือ `< 2`:

- เพิ่ม `id` และ `parentId` ให้กับแต่ละรายการที่ไม่ใช่ส่วนหัว
- สร้างห่วงโซ่ parent แบบเชิงเส้นขึ้นใหม่โดยใช้ลำดับไฟล์
- ย้ายข้อมูลฟิลด์ compaction จาก `firstKeptEntryIndex` -> `firstKeptEntryId` เมื่อมีอยู่
- ตั้งค่า `version = 2` ของส่วนหัว

### v2 -> v3

ถูกใช้เมื่อ `version` ของส่วนหัว `< 3`:

- สำหรับรายการ `message`: เขียนใหม่จาก `message.role === "hookMessage"` แบบเก่าเป็น `"custom"`
- ตั้งค่า `version = 3` ของส่วนหัว

### ทริกเกอร์การย้ายข้อมูลและการคงอยู่

- การย้ายข้อมูลจะทำงานระหว่างการโหลดเซสชัน (`setSessionFile`)
- หากมีการย้ายข้อมูลใดๆ ทำงาน ไฟล์ทั้งหมดจะถูกเขียนใหม่ลงดิสก์ทันที
- การย้ายข้อมูลจะแก้ไขรายการในหน่วยความจำก่อน จากนั้นจึงคงอยู่ JSONL ที่เขียนใหม่

## พฤติกรรมการโหลดและความเข้ากันได้

พฤติกรรมของ `loadEntriesFromFile(path)`:

- ไฟล์ที่หายไป (`ENOENT`) -> คืนค่า `[]`
- บรรทัดที่แยกวิเคราะห์ไม่ได้จะถูกจัดการโดย JSONL parser แบบผ่อนปรน (`parseJsonlLenient`)
- หากรายการที่แยกวิเคราะห์ได้แรกไม่ใช่ session header ที่ถูกต้อง (`type !== "session"` หรือขาดสตริง `id`) -> คืนค่า `[]`

พฤติกรรมของ `SessionManager.setSessionFile()`:

- `[]` จากตัวโหลดจะถูกถือว่าเป็นเซสชันว่าง/ไม่มีอยู่ และถูกแทนที่ด้วยไฟล์เซสชันใหม่ที่เริ่มต้นที่พาธนั้น
- ไฟล์ที่ถูกต้องจะถูกโหลด ย้ายข้อมูลหากจำเป็น แก้ไข blob refs จากนั้นสร้างดัชนี

## ความหมายของต้นไม้และ Leaf

โมเดลพื้นฐานคือต้นไม้แบบ append-only + ตัวชี้ leaf ที่เปลี่ยนแปลงได้:

- ทุกเมธอด append จะสร้างรายการใหม่เพียงหนึ่งรายการที่ `parentId` เป็น `leafId` ปัจจุบัน
- รายการใหม่จะกลายเป็น `leafId` ใหม่
- `branch(entryId)` จะเลื่อนเฉพาะ `leafId`; รายการที่มีอยู่จะไม่เปลี่ยนแปลง
- `resetLeaf()` จะตั้งค่า `leafId = null`; การ append ครั้งถัดไปจะสร้างรายการรากใหม่ (`parentId: null`)
- `branchWithSummary()` จะตั้งค่า leaf เป็นเป้าหมายสาขาและ append รายการ `branch_summary`

`getEntries()` จะคืนค่ารายการที่ไม่ใช่ส่วนหัวทั้งหมดตามลำดับการแทรก รายการที่มีอยู่จะไม่ถูกลบในการทำงานปกติ; การเขียนใหม่จะรักษาประวัติเชิงตรรกะในขณะที่อัปเดตการแสดงผล (การย้ายข้อมูล การย้าย ตัวช่วยเขียนใหม่แบบเจาะจง)

## การสร้างบริบทขึ้นใหม่ (`buildSessionContext`)

`buildSessionContext(entries, leafId, byId?)` จะแก้ไขสิ่งที่ถูกส่งไปยังโมเดล

อัลกอริทึม:

1. กำหนด leaf:
   - `leafId === null` -> คืนค่าบริบทว่าง
   - `leafId` ที่ระบุชัดเจน -> ใช้รายการนั้นหากพบ
   - มิฉะนั้นใช้รายการสุดท้ายเป็นค่าสำรอง
2. เดินตามห่วงโซ่ `parentId` จาก leaf ไปยัง root และกลับลำดับเป็นพาธ root->leaf
3. สร้างสถานะรันไทม์ตามพาธ:
   - `thinkingLevel` จาก `thinking_level_change` ล่าสุด (ค่าเริ่มต้น `"off"`)
   - แผนที่โมเดลจากรายการ `model_change` (`role ?? "default"`)
   - `models.default` สำรองจาก provider/model ของข้อความ assistant หากไม่มีการเปลี่ยนโมเดลอย่างชัดเจน
   - `injectedTtsrRules` ที่ไม่ซ้ำกันจากรายการ `ttsr_injection` ทั้งหมด
   - mode/modeData จาก `mode_change` ล่าสุด (mode เริ่มต้น `"none"`)
4. สร้างรายการข้อความ:
   - รายการ `message` จะส่งผ่านตรง
   - รายการ `custom_message` จะกลายเป็น AgentMessages แบบ `custom` ผ่าน `createCustomMessage`
   - รายการ `branch_summary` จะกลายเป็น AgentMessages แบบ `branchSummary` ผ่าน `createBranchSummaryMessage`
   - หากมี `compaction` อยู่บนพาธ:
     - ส่งสรุป compaction ก่อน (`createCompactionSummaryMessage`)
     - ส่งรายการพาธเริ่มจาก `firstKeptEntryId` จนถึงขอบเขต compaction
     - ส่งรายการหลังขอบเขต compaction

รายการ `custom` และ `session_init` จะไม่ฉีดบริบทโมเดลโดยตรง

## การรับประกันการคงอยู่และโมเดลข้อผิดพลาด

### การคงอยู่ vs ในหน่วยความจำ

- `SessionManager.create/open/continueRecent/forkFrom` -> โหมดคงอยู่ (`persist = true`)
- `SessionManager.inMemory` -> โหมดไม่คงอยู่ (`persist = false`) กับ `MemorySessionStorage`

### ไปป์ไลน์การเขียน

การเขียนจะถูกจัดลำดับผ่าน promise chain ภายใน (`#persistChain`) และ `NdjsonFileWriter`

- `append*` จะอัปเดตสถานะในหน่วยความจำทันที
- การคงอยู่จะถูกเลื่อนออกไปจนกว่าจะมีข้อความ assistant อย่างน้อยหนึ่งรายการ
  - ก่อน assistant แรก: รายการจะถูกเก็บในหน่วยความจำ; ไม่มีการ append ไฟล์เกิดขึ้น
  - เมื่อ assistant แรกมีอยู่: เซสชันทั้งหมดในหน่วยความจำจะถูก flush ลงไฟล์
  - หลังจากนั้น: รายการใหม่จะ append แบบเพิ่มทีละรายการ

เหตุผลในโค้ด: หลีกเลี่ยงการคงอยู่ของเซสชันที่ไม่เคยสร้างการตอบกลับจาก assistant

### การดำเนินการด้านความทนทาน

- `flush()` จะ flush writer และเรียก `fsync()`
- การเขียนใหม่ทั้งไฟล์แบบ atomic (`#rewriteFile`) จะเขียนไปยังไฟล์ชั่วคราว, flush+fsync, ปิด จากนั้นเปลี่ยนชื่อทับเป้าหมาย
- ใช้สำหรับการย้ายข้อมูล, `setSessionName`, `rewriteEntries`, การดำเนินการย้าย และการเขียนใหม่ tool-call args

### พฤติกรรมข้อผิดพลาด

- ข้อผิดพลาดในการคงอยู่จะถูกยึดไว้ (`#persistError`) และโยนซ้ำในการดำเนินการถัดไป
- ข้อผิดพลาดแรกจะถูกบันทึกหนึ่งครั้งพร้อมบริบทไฟล์เซสชัน
- การปิด writer เป็นแบบ best-effort แต่จะส่งต่อข้อผิดพลาดที่มีความหมายแรก

## การควบคุมขนาดข้อมูลและการจัดเก็บ Blob ภายนอก

ก่อนการคงอยู่ของรายการ:

- สตริงขนาดใหญ่จะถูกตัดทอนเป็น `MAX_PERSIST_CHARS` (500,000 ตัวอักษร) พร้อมข้อความแจ้ง:
  - `"[Session persistence truncated large content]"`
- ฟิลด์ชั่วคราว `partialJson` และ `jsonlEvents` จะถูกลบ
- หาก object มีทั้ง `content` และ `lineCount` จำนวนบรรทัดจะถูกคำนวณใหม่หลังการตัดทอน
- บล็อกรูปภาพในอาร์เรย์ `content` ที่มีความยาว base64 >= 1024 จะถูกจัดเก็บภายนอกเป็น blob refs:
  - จัดเก็บเป็น `blob:sha256:<hash>`
  - ไบต์ดิบเขียนไปยัง blob store (`BlobStore.put`)

เมื่อโหลด blob refs จะถูกแก้ไขกลับเป็น base64 สำหรับบล็อกรูปภาพ message/custom_message

## การแยกส่วนการจัดเก็บ

อินเทอร์เฟซ `SessionStorage` จัดเตรียมการดำเนินการระบบไฟล์ทั้งหมดที่ `SessionManager` ใช้:

- sync: `ensureDirSync`, `existsSync`, `writeTextSync`, `statSync`, `listFilesSync`
- async: `exists`, `readText`, `readTextPrefix`, `writeText`, `rename`, `unlink`, `openWriter`

การใช้งาน:

- `FileSessionStorage`: ระบบไฟล์จริง (Bun + node fs)
- `MemorySessionStorage`: การใช้งานในหน่วยความจำแบบ map-backed สำหรับการทดสอบ/เซสชันที่ไม่คงอยู่

`SessionStorageWriter` เปิดเผย `writeLine`, `flush`, `fsync`, `close`, `getError`

## ยูทิลิตี้การค้นหาเซสชัน

กำหนดใน `session-manager.ts`:

- `getRecentSessions(sessionDir, limit)` -> ข้อมูลเมตาแบบเบาสำหรับ UI/ตัวเลือกเซสชัน
- `findMostRecentSession(sessionDir)` -> ใหม่สุดตาม mtime
- `list(cwd, sessionDir?)` -> เซสชันในขอบเขตโปรเจกต์เดียว
- `listAll()` -> เซสชันข้ามขอบเขตโปรเจกต์ทั้งหมดภายใต้ `~/.xcsh/agent/sessions`

การดึงข้อมูลเมตาจะอ่านเฉพาะส่วนนำ (`readTextPrefix(..., 4096)`) เมื่อเป็นไปได้

## เกี่ยวข้องแต่แยกต่างหาก: การจัดเก็บประวัติพรอมต์

`HistoryStorage` (`history-storage.ts`) เป็นระบบย่อย SQLite แยกต่างหากสำหรับการเรียกคืน/ค้นหาพรอมต์ ไม่ใช่สำหรับการเล่นซ้ำเซสชัน

- ฐานข้อมูล: `~/.xcsh/agent/history.db`
- ตาราง: `history(id, prompt, created_at, cwd)`
- ดัชนี FTS5: `history_fts` พร้อมการซิงค์ที่ดูแลด้วย trigger
- ขจัดพรอมต์ที่เหมือนกันติดต่อกันโดยใช้แคช last-prompt ในหน่วยความจำ
- การแทรกแบบ async (`setImmediate`) เพื่อไม่ให้การจับพรอมต์บล็อกการทำงานของรอบ

ใช้ไฟล์เซสชันสำหรับการเล่นซ้ำกราฟ/สถานะการสนทนา; ใช้ `HistoryStorage` สำหรับ UX ประวัติพรอมต์
