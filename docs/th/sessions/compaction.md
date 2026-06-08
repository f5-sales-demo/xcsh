---
title: Compaction and Branch Summaries
description: >-
  Context window compaction and branch summary generation for long-lived
  sessions.
sidebar:
  order: 5
  label: Compaction
i18n:
  sourceHash: dae425a900d8
  translator: machine
---

# การบีบอัดและสรุปสาขา

การบีบอัด (Compaction) และสรุปสาขา (Branch Summaries) เป็นกลไกสองอย่างที่ช่วยให้เซสชันที่ทำงานยาวนานยังคงใช้งานได้โดยไม่สูญเสียบริบทของงานก่อนหน้า

- **การบีบอัด** เขียนประวัติเก่าใหม่เป็นสรุปบนสาขาปัจจุบัน
- **สรุปสาขา** จับบริบทของสาขาที่ถูกละทิ้งระหว่างการนำทางด้วย `/tree`

ทั้งสองถูกบันทึกเป็นรายการเซสชันและแปลงกลับเป็นข้อความบริบทผู้ใช้เมื่อสร้างอินพุต LLM ขึ้นใหม่

## ไฟล์ implementation หลัก

- `src/session/compaction/compaction.ts`
- `src/session/compaction/branch-summarization.ts`
- `src/session/compaction/pruning.ts`
- `src/session/compaction/utils.ts`
- `src/session/session-manager.ts`
- `src/session/agent-session.ts`
- `src/session/messages.ts`
- `src/extensibility/hooks/types.ts`
- `src/config/settings-schema.ts`

## โมเดลรายการเซสชัน

การบีบอัดและสรุปสาขาเป็นรายการเซสชันระดับ first-class ไม่ใช่ข้อความ assistant/user ธรรมดา

- `CompactionEntry`
  - `type: "compaction"`
  - `summary`, `shortSummary` (ไม่บังคับ)
  - `firstKeptEntryId` (ขอบเขตการบีบอัด)
  - `tokensBefore`
  - `details`, `preserveData`, `fromExtension` (ไม่บังคับ)
- `BranchSummaryEntry`
  - `type: "branch_summary"`
  - `fromId`, `summary`
  - `details`, `fromExtension` (ไม่บังคับ)

เมื่อบริบทถูกสร้างขึ้นใหม่ (`buildSessionContext`):

1. การบีบอัดล่าสุดบนเส้นทางที่ใช้งานอยู่จะถูกแปลงเป็นข้อความ `compactionSummary` หนึ่งรายการ
2. รายการที่เก็บไว้ตั้งแต่ `firstKeptEntryId` จนถึงจุดบีบอัดจะถูกรวมเข้ามาใหม่
3. รายการที่ตามมาบนเส้นทางจะถูกต่อท้าย
4. รายการ `branch_summary` จะถูกแปลงเป็นข้อความ `branchSummary`
5. รายการ `custom_message` จะถูกแปลงเป็นข้อความ `custom`

บทบาทที่กำหนดเองเหล่านั้นจะถูกแปลงเป็นข้อความผู้ใช้ที่ส่งไปยัง LLM ใน `convertToLlm()` โดยใช้เทมเพลตคงที่:

- `prompts/compaction/compaction-summary-context.md`
- `prompts/compaction/branch-summary-context.md`

## ขั้นตอนการบีบอัด

### ทริกเกอร์

การบีบอัดสามารถทำงานได้สามวิธี:

1. **แบบกำหนดเอง**: `/compact [instructions]` เรียก `AgentSession.compact(...)`
2. **การกู้คืนอัตโนมัติจากการล้นบริบท**: หลังจากเกิดข้อผิดพลาดของ assistant ที่ตรงกับการล้นของบริบท
3. **การบีบอัดอัตโนมัติตามเกณฑ์**: หลังจากเทิร์นที่สำเร็จเมื่อบริบทเกินเกณฑ์

### รูปแบบการบีบอัด (แบบภาพ)

```text
Before compaction:

  entry:  0     1     2     3      4     5     6      7      8     9
        ┌─────┬─────┬─────┬──────┬─────┬─────┬──────┬──────┬─────┬──────┐
        │ hdr │ usr │ ass │ tool │ usr │ ass │ tool │ tool │ ass │ tool │
        └─────┴─────┴─────┴──────┴─────┴─────┴──────┴──────┴─────┴──────┘
                └────────┬───────┘ └──────────────┬──────────────┘
               messagesToSummarize            kept messages
                                   ↑
                          firstKeptEntryId (entry 4)

After compaction (new entry appended):

  entry:  0     1     2     3      4     5     6      7      8     9      10
        ┌─────┬─────┬─────┬──────┬─────┬─────┬──────┬──────┬─────┬──────┬─────┐
        │ hdr │ usr │ ass │ tool │ usr │ ass │ tool │ tool │ ass │ tool │ cmp │
        └─────┴─────┴─────┴──────┴─────┴─────┴──────┴──────┴─────┴──────┴─────┘
               └──────────┬──────┘ └──────────────────────┬───────────────────┘
                 not sent to LLM                    sent to LLM
                                                         ↑
                                              starts from firstKeptEntryId

What the LLM sees:

  ┌────────┬─────────┬─────┬─────┬──────┬──────┬─────┬──────┐
  │ system │ summary │ usr │ ass │ tool │ tool │ ass │ tool │
  └────────┴─────────┴─────┴─────┴──────┴──────┴─────┴──────┘
       ↑         ↑      └─────────────────┬────────────────┘
    prompt   from cmp          messages from firstKeptEntryId
```

### การบีบอัดจากการล้นบริบท vs การบีบอัดตามเกณฑ์

เส้นทางอัตโนมัติทั้งสองแตกต่างกันโดยตั้งใจ:

- **การบีบอัดจากการลอง-ซ้ำเมื่อล้น**
  - ทริกเกอร์: ข้อผิดพลาดของ assistant ในโมเดลปัจจุบันถูกตรวจพบว่าเป็นการล้นบริบท
  - ข้อความข้อผิดพลาดของ assistant ที่ล้มเหลวจะถูกลบออกจากสถานะ agent ที่ใช้งานอยู่ก่อนลองใหม่
  - การบีบอัดอัตโนมัติทำงานด้วย `reason: "overflow"` และ `willRetry: true`
  - เมื่อสำเร็จ agent จะทำงานต่อโดยอัตโนมัติ (`agent.continue()`) หลังการบีบอัด

- **การบีบอัดตามเกณฑ์**
  - ทริกเกอร์: `contextTokens > contextWindow - compaction.reserveTokens`
  - ทำงานด้วย `reason: "threshold"` และ `willRetry: false`
  - เมื่อสำเร็จ ถ้า `compaction.autoContinue !== false` จะแทรก prompt สังเคราะห์:
    - `"Continue if you have next steps."`

### การตัดแต่งก่อนบีบอัด

ก่อนการตรวจสอบการบีบอัด อาจมีการตัดแต่งผลลัพธ์ของเครื่องมือ (`pruneToolOutputs`)

นโยบายการตัดแต่งเริ่มต้น:

- ป้องกันโทเค็นผลลัพธ์เครื่องมือล่าสุด `40_000` โทเค็น
- ต้องการการประหยัดรวมโดยประมาณอย่างน้อย `20_000`
- ไม่ตัดแต่งผลลัพธ์เครื่องมือจาก `skill` หรือ `read`

ผลลัพธ์เครื่องมือที่ถูกตัดแต่งจะถูกแทนที่ด้วย:

- `[Output truncated - N tokens]`

หากการตัดแต่งเปลี่ยนรายการ ที่เก็บเซสชันจะถูกเขียนใหม่และสถานะข้อความของ agent จะถูกรีเฟรชก่อนการตัดสินใจบีบอัด

### ตรรกะขอบเขตและจุดตัด

`prepareCompaction()` พิจารณาเฉพาะรายการตั้งแต่รายการบีบอัดล่าสุด (ถ้ามี)

1. ค้นหาดัชนีการบีบอัดก่อนหน้า
2. คำนวณ `boundaryStart = prevCompactionIndex + 1`
3. ปรับ `keepRecentTokens` โดยใช้อัตราส่วนการใช้งานที่วัดได้เมื่อมี
4. เรียก `findCutPoint()` บนหน้าต่างขอบเขต

จุดตัดที่ถูกต้องรวมถึง:

- รายการข้อความที่มีบทบาท: `user`, `assistant`, `bashExecution`, `hookMessage`, `branchSummary`, `compactionSummary`
- รายการ `custom_message`
- รายการ `branch_summary`

กฎเข้มงวด: ไม่ตัดที่ `toolResult`

หากมีรายการเมตาดาต้าที่ไม่ใช่ข้อความอยู่ก่อนจุดตัดทันที (`model_change`, `thinking_level_change`, labels, เป็นต้น) รายการเหล่านั้นจะถูกดึงเข้าไปในพื้นที่ที่เก็บไว้โดยเลื่อนดัชนีตัดถอยหลังจนกว่าจะถึงข้อความหรือขอบเขตการบีบอัด

### การจัดการเทิร์นที่ถูกแบ่ง

หากจุดตัดไม่ได้อยู่ที่จุดเริ่มต้นเทิร์นของผู้ใช้ การบีบอัดจะถือว่าเป็นเทิร์นที่ถูกแบ่ง

การตรวจจับจุดเริ่มต้นเทิร์นถือว่าสิ่งเหล่านี้เป็นขอบเขตเทิร์นของผู้ใช้:

- `message.role === "user"`
- `message.role === "bashExecution"`
- รายการ `custom_message`
- รายการ `branch_summary`

การบีบอัดเทิร์นที่ถูกแบ่งจะสร้างสรุปสองรายการ:

1. สรุปประวัติ (`messagesToSummarize`)
2. สรุปคำนำหน้าเทิร์น (`turnPrefixMessages`)

สรุปสุดท้ายที่จัดเก็บจะถูกรวมเป็น:

```markdown
<history summary>

---

**Turn Context (split turn):**

<turn prefix summary>
```

### การสร้างสรุป

`compact(...)` สร้างสรุปจากข้อความสนทนาที่ถูก serialize:

1. แปลงข้อความผ่าน `convertToLlm()`
2. Serialize ด้วย `serializeConversation()`
3. ห่อด้วย `<conversation>...</conversation>`
4. เพิ่ม `<previous-summary>...</previous-summary>` (ไม่บังคับ)
5. แทรกบริบท hook เป็นรายการ `<additional-context>` (ไม่บังคับ)
6. ดำเนินการ prompt สรุปด้วย `SUMMARIZATION_SYSTEM_PROMPT`

การเลือก prompt:

- การบีบอัดครั้งแรก: `compaction-summary.md`
- การบีบอัดแบบวนซ้ำที่มีสรุปก่อนหน้า: `compaction-update-summary.md`
- รอบที่สองของเทิร์นที่ถูกแบ่ง: `compaction-turn-prefix.md`
- สรุปสั้นสำหรับ UI: `compaction-short-summary.md`

โหมดสรุประยะไกล:

- หากตั้งค่า `compaction.remoteEndpoint` ไว้ การบีบอัดจะ POST:
  - `{ systemPrompt, prompt }`
- คาดหวัง JSON ที่มีอย่างน้อย `{ summary }`

### บริบทการดำเนินการไฟล์ในสรุป

การบีบอัดติดตามกิจกรรมไฟล์สะสมโดยใช้การเรียกเครื่องมือของ assistant:

- `read(path)` → ชุดที่อ่าน
- `write(path)` → ชุดที่แก้ไข
- `edit(path)` → ชุดที่แก้ไข

พฤติกรรมสะสม:

- รวมรายละเอียดการบีบอัดก่อนหน้าเฉพาะเมื่อรายการก่อนหน้าถูกสร้างโดย pi (`fromExtension !== true`)
- ในเทิร์นที่ถูกแบ่ง จะรวมการดำเนินการไฟล์ของคำนำหน้าเทิร์นด้วย
- `readFiles` ไม่รวมไฟล์ที่ถูกแก้ไขด้วย

ข้อความสรุปจะได้รับแท็กไฟล์ต่อท้ายผ่านเทมเพลต prompt:

```xml
<read-files>
...
</read-files>
<modified-files>
...
</modified-files>
```

### การบันทึกและโหลดใหม่

หลังจากสร้างสรุป (หรือสรุปที่ hook จัดหาให้) เซสชัน agent:

1. ต่อท้าย `CompactionEntry` ด้วย `appendCompaction(...)`
2. สร้างบริบทใหม่ผ่าน `buildSessionContext()`
3. แทนที่ข้อความ agent ที่ใช้งานอยู่ด้วยบริบทที่สร้างใหม่
4. ส่งเหตุการณ์ hook `session_compact`

## ขั้นตอนการสรุปสาขา

การสรุปสาขาเชื่อมโยงกับการนำทางแผนผัง ไม่ใช่การล้นโทเค็น

### ทริกเกอร์

ระหว่าง `navigateTree(...)`:

1. คำนวณรายการที่ถูกละทิ้งจากใบเก่าไปยังบรรพบุรุษร่วมโดยใช้ `collectEntriesForBranchSummary(...)`
2. หากผู้เรียกร้องขอสรุป (`options.summarize`) จะสร้างสรุปก่อนสลับใบ
3. หากมีสรุป จะแนบที่เป้าหมายการนำทางโดยใช้ `branchWithSummary(...)`

ในทางปฏิบัติ สิ่งนี้มักถูกขับเคลื่อนโดยขั้นตอน `/tree` เมื่อเปิดใช้งาน `branchSummary.enabled`

### รูปแบบการสลับสาขา (แบบภาพ)

```text
Tree before navigation:

         ┌─ B ─ C ─ D (old leaf, being abandoned)
    A ───┤
         └─ E ─ F (target)

Common ancestor: A
Entries to summarize: B, C, D

After navigation with summary:

         ┌─ B ─ C ─ D ─ [summary of B,C,D]
    A ───┤
         └─ E ─ F (new leaf)
```

### การเตรียมและงบประมาณโทเค็น

`generateBranchSummary(...)` คำนวณงบประมาณเป็น:

- `tokenBudget = model.contextWindow - branchSummary.reserveTokens`

`prepareBranchEntries(...)` จากนั้น:

1. รอบแรก: รวบรวมการดำเนินการไฟล์สะสมจากรายการที่สรุปทั้งหมด รวมถึงรายละเอียด `branch_summary` ก่อนหน้าที่สร้างโดย pi
2. รอบที่สอง: เดินจากใหม่สุด → เก่าสุด เพิ่มข้อความจนกว่าจะถึงงบประมาณโทเค็น
3. ให้ความสำคัญกับการรักษาบริบทล่าสุด
4. อาจยังรวมรายการสรุปขนาดใหญ่ใกล้ขอบงบประมาณเพื่อความต่อเนื่อง

รายการบีบอัดจะถูกรวมเป็นข้อความ (`compactionSummary`) ระหว่างอินพุตการสรุปสาขา

### การสร้างสรุปและการบันทึก

การสรุปสาขา:

1. แปลงและ serialize ข้อความที่เลือก
2. ห่อด้วย `<conversation>`
3. ใช้คำสั่งที่กำหนดเองหากระบุ มิฉะนั้นใช้ `branch-summary.md`
4. เรียกโมเดลสรุปด้วย `SUMMARIZATION_SYSTEM_PROMPT`
5. เพิ่ม `branch-summary-preamble.md` ข้างหน้า
6. ต่อท้ายแท็กการดำเนินการไฟล์

ผลลัพธ์ถูกจัดเก็บเป็น `BranchSummaryEntry` พร้อมรายละเอียดที่ไม่บังคับ (`readFiles`, `modifiedFiles`)

## จุดเชื่อมต่อส่วนขยายและ hook

### `session_before_compact`

hook ก่อนการบีบอัด

สามารถ:

- ยกเลิกการบีบอัด (`{ cancel: true }`)
- จัดหา payload การบีบอัดที่กำหนดเองทั้งหมด (`{ compaction: CompactionResult }`)

### `session.compacting`

hook ปรับแต่ง prompt/บริบทสำหรับการบีบอัดเริ่มต้น

สามารถคืนค่า:

- `prompt` (แทนที่ prompt สรุปพื้นฐาน)
- `context` (บรรทัดบริบทเพิ่มเติมที่แทรกใน `<additional-context>`)
- `preserveData` (จัดเก็บบนรายการบีบอัด)

### `session_compact`

การแจ้งเตือนหลังการบีบอัดพร้อม `compactionEntry` ที่บันทึกแล้วและแฟล็ก `fromExtension`

### `session_before_tree`

ทำงานเมื่อนำทางแผนผังก่อนการสร้างสรุปสาขาเริ่มต้น

สามารถ:

- ยกเลิกการนำทาง
- จัดหา `{ summary: { summary, details } }` ที่กำหนดเองเมื่อผู้ใช้ร้องขอการสรุป

### `session_tree`

เหตุการณ์หลังการนำทางที่เปิดเผยใบใหม่/เก่าและรายการสรุปที่ไม่บังคับ

## พฤติกรรมรันไทม์และความหมายของความล้มเหลว

- การบีบอัดแบบกำหนดเองจะยกเลิกการดำเนินการ agent ปัจจุบันก่อน
- `abortCompaction()` ยกเลิกตัวควบคุมการบีบอัดทั้งแบบกำหนดเองและอัตโนมัติ
- การบีบอัดอัตโนมัติส่งเหตุการณ์เซสชันเริ่มต้น/สิ้นสุดสำหรับการอัปเดต UI/สถานะ
- การบีบอัดอัตโนมัติสามารถลองโมเดลตัวเลือกหลายตัวและลองซ้ำเมื่อเกิดข้อผิดพลาดชั่วคราว
- ข้อผิดพลาดการล้นจะถูกแยกออกจากเส้นทางลองซ้ำทั่วไปเพราะถูกจัดการโดยการบีบอัด
- หากการบีบอัดอัตโนมัติล้มเหลว:
  - เส้นทางการล้นจะแสดง `Context overflow recovery failed: ...`
  - เส้นทางตามเกณฑ์จะแสดง `Auto-compaction failed: ...`
- การสรุปสาขาสามารถถูกยกเลิกผ่านสัญญาณยกเลิก (เช่น Escape) โดยคืนผลลัพธ์การนำทางที่ถูกยกเลิก/หยุด

## การตั้งค่าและค่าเริ่มต้น

จาก `settings-schema.ts`:

- `compaction.enabled` = `true`
- `compaction.reserveTokens` = `16384`
- `compaction.keepRecentTokens` = `20000`
- `compaction.autoContinue` = `true`
- `compaction.remoteEndpoint` = `undefined`
- `branchSummary.enabled` = `false`
- `branchSummary.reserveTokens` = `16384`

ค่าเหล่านี้ถูกใช้ในรันไทม์โดย `AgentSession` และโมดูลการบีบอัด/สรุปสาขา
